const http = require('http');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const { getApp, signupTutor, signupParent, verifyUser } = require('../helpers');
const { initSocket } = require('../../src/realtime/socket');
const { initWorkers, closeAllWorkers } = require('../../src/services/sfu/workerPool');

const app = getApp();
let httpServer;
let port;

// Valid RTP parameter fixtures lifted from mediasoup's own test suite
// (test-Producer.js / test-Consumer.js) — the exact shape a real
// mediasoup-client Device would derive from a browser's SDP, hand-built
// here so the test can exercise the real mediasoup engine without a
// browser or an actual WebRTC connection.
const AUDIO_RTP_PARAMETERS = {
  mid: 'AUDIO',
  codecs: [{
    mimeType: 'audio/opus', payloadType: 0, clockRate: 48000, channels: 2,
    parameters: { useinbandfec: 1, usedtx: 1 },
  }],
  headerExtensions: [
    { uri: 'urn:ietf:params:rtp-hdrext:sdes:mid', id: 10 },
  ],
  encodings: [{ ssrc: 11111111 }],
  rtcp: { cname: 'audio-1' },
};

const VIDEO_RTP_PARAMETERS = {
  mid: 'VIDEO',
  codecs: [{
    mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, parameters: {},
    rtcpFeedback: [{ type: 'nack' }, { type: 'nack', parameter: 'pli' }, { type: 'goog-remb' }],
  }],
  headerExtensions: [],
  encodings: [{ ssrc: 22222222 }],
  rtcp: { cname: 'video-1' },
};

// A syntactically valid (but not cryptographically real) DTLS fingerprint —
// enough to pass mediasoup's format validation for transport.connect().
// A real browser would send its actual certificate fingerprint here; since
// nothing in this test actually completes an ICE/DTLS handshake, the value
// itself doesn't need to correspond to a real certificate.
const FAKE_DTLS_PARAMETERS = {
  role: 'client',
  fingerprints: [{ algorithm: 'sha-256', value: Array.from({ length: 32 }, () => 'AB').join(':') }],
};

beforeAll(async () => {
  await initWorkers();
  httpServer = http.createServer(app);
  initSocket(httpServer);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  await closeAllWorkers();
});

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function setupConfirmedBooking(opts = {}) {
  const { res: tutorRes } = await signupTutor(app, { email: `sfu_tutor_${Date.now()}_${Math.random()}@example.com` });
  const { res: parentRes } = await signupParent(app, { email: `sfu_parent_${Date.now()}_${Math.random()}@example.com` });
  const tutorToken = tutorRes.body.access_token;
  const parentToken = parentRes.body.access_token;
  const tutorId = tutorRes.body.user.id;
  await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorToken}`).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });
  await verifyUser(tutorId);
  await verifyUser(parentRes.body.user.id);

  const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`)
    .send({ tutor_id: tutorId, subject: 'Mathematics' });
  const bookingId = booking.body.booking.id;
  await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });
  if (opts.pay !== false) {
    const pay = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, method: 'gateway' });
    await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: pay.body.reference });
  }

  return { bookingId, tutorToken, parentToken };
}

describe('SFU signaling (real mediasoup engine, real socket.io transport)', () => {
  it('rejects joining a room for a booking that is not confirmed yet', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: `sfu_pending_tutor_${Date.now()}@example.com` });
    const { res: parentRes } = await signupParent(app, { email: `sfu_pending_parent_${Date.now()}@example.com` });
    await verifyUser(parentRes.body.user.id);
    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentRes.body.access_token}`)
      .send({ tutor_id: tutorRes.body.user.id, subject: 'Mathematics' });

    const socket = await connectSocket(parentRes.body.access_token);
    const result = await emitAck(socket, 'lesson:join', booking.body.booking.id);
    expect(result.ok).toBe(false);
    socket.disconnect();
  });

  it('rejects joining a confirmed but unpaid lesson', async () => {
    const { bookingId, parentToken } = await setupConfirmedBooking({ pay: false });
    const socket = await connectSocket(parentToken);
    const result = await emitAck(socket, 'lesson:join', bookingId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not been paid/i);
    socket.disconnect();
  });

  it('rejects a socket whose user is not a participant on the booking', async () => {
    const { bookingId } = await setupConfirmedBooking();
    const { res: intruderRes } = await signupParent(app, { email: `sfu_intruder_${Date.now()}@example.com` });

    const socket = await connectSocket(intruderRes.body.access_token);
    const result = await emitAck(socket, 'lesson:join', bookingId);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a participant/i);
    socket.disconnect();
  });

  it('runs the full call lifecycle over the real mediasoup engine: join -> transports -> produce -> cross-peer notify -> consume -> resume -> leave', async () => {
    const { bookingId, tutorToken, parentToken } = await setupConfirmedBooking();

    const parentSocket = await connectSocket(parentToken);
    const tutorSocket = await connectSocket(tutorToken);

    // Both join; each gets back real RTP capabilities from an actual mediasoup Router.
    const parentJoin = await emitAck(parentSocket, 'lesson:join', bookingId);
    expect(parentJoin.ok).toBe(true);
    expect(parentJoin.role).toBe('parent');
    expect(parentJoin.rtpCapabilities.codecs.some((c) => c.mimeType === 'audio/opus')).toBe(true);
    expect(parentJoin.rtpCapabilities.codecs.some((c) => c.mimeType === 'video/VP8')).toBe(true);
    expect(parentJoin.existingProducers).toEqual([]);

    const tutorJoin = await emitAck(tutorSocket, 'lesson:join', bookingId);
    expect(tutorJoin.ok).toBe(true);
    expect(tutorJoin.role).toBe('tutor');

    // Parent creates a real send transport — the ICE/DTLS parameters come
    // straight from a live mediasoup WebRtcTransport, not a stub.
    const sendTransport = await emitAck(parentSocket, 'lesson:create_transport', { bookingId, direction: 'send' });
    expect(sendTransport.ok).toBe(true);
    expect(sendTransport.params.iceParameters.usernameFragment).toBeTruthy();
    expect(sendTransport.params.dtlsParameters.fingerprints.length).toBeGreaterThan(0);

    const connectResult = await emitAck(parentSocket, 'lesson:connect_transport', {
      bookingId, transportId: sendTransport.params.id, dtlsParameters: FAKE_DTLS_PARAMETERS,
    });
    expect(connectResult.ok).toBe(true);

    // Produce real audio and video producers on the real router. The
    // cross-peer notification can arrive before this ack does, so the
    // listener must be registered first — otherwise it's a genuine race,
    // not a hypothetical one (confirmed while debugging this test).
    const newProducerEventPromise = new Promise((resolve) => tutorSocket.once('lesson:new_producer', resolve));
    const audioProduce = await emitAck(parentSocket, 'lesson:produce', {
      bookingId, transportId: sendTransport.params.id, kind: 'audio', rtpParameters: AUDIO_RTP_PARAMETERS,
    });
    expect(audioProduce.ok).toBe(true);
    expect(audioProduce.id).toBeTruthy();

    // The tutor, already in the room, should hear about it in real time.
    const newProducerEvent = await newProducerEventPromise;
    expect(newProducerEvent.producerId).toBe(audioProduce.id);
    expect(newProducerEvent.kind).toBe('audio');
    expect(newProducerEvent.role).toBe('parent');

    const videoProduce = await emitAck(parentSocket, 'lesson:produce', {
      bookingId, transportId: sendTransport.params.id, kind: 'video', rtpParameters: VIDEO_RTP_PARAMETERS,
    });
    expect(videoProduce.ok).toBe(true);

    // A second connection for the tutor (another tab, or a reconnect)
    // should immediately see both existing producers, and the original
    // connection should be told it's been superseded rather than left to
    // silently stop working.
    const replacedPromise = new Promise((resolve) => tutorSocket.once('lesson:replaced', resolve));
    const tutorSocket2 = await connectSocket(tutorToken);
    const lateJoin = await emitAck(tutorSocket2, 'lesson:join', bookingId);
    expect(lateJoin.existingProducers).toHaveLength(2);
    expect(lateJoin.existingProducers.map((p) => p.kind).sort()).toEqual(['audio', 'video']);
    await replacedPromise;

    // tutorSocket2 is now the tutor's live connection; tutorSocket has been
    // superseded, so everything from here on uses tutorSocket2 instead.
    const recvTransport = await emitAck(tutorSocket2, 'lesson:create_transport', { bookingId, direction: 'recv' });
    expect(recvTransport.ok).toBe(true);
    await emitAck(tutorSocket2, 'lesson:connect_transport', {
      bookingId, transportId: recvTransport.params.id, dtlsParameters: FAKE_DTLS_PARAMETERS,
    });

    const consume = await emitAck(tutorSocket2, 'lesson:consume', {
      bookingId, transportId: recvTransport.params.id, producerId: audioProduce.id, rtpCapabilities: tutorJoin.rtpCapabilities,
    });
    expect(consume.ok).toBe(true);
    expect(consume.params.producerId).toBe(audioProduce.id);
    expect(consume.params.kind).toBe('audio');

    const resume = await emitAck(tutorSocket2, 'lesson:resume_consumer', { bookingId, consumerId: consume.params.id });
    expect(resume.ok).toBe(true);

    // Parent leaves — the tutor should be told, and the parent's producers
    // (and their consumer of them) should be cleaned up server-side.
    const peerLeftPromise = new Promise((resolve) => tutorSocket2.once('lesson:peer_left', resolve));
    await emitAck(parentSocket, 'lesson:leave', bookingId);
    const peerLeft = await peerLeftPromise;
    expect(peerLeft.peerId).toBeTruthy();

    parentSocket.disconnect();
    tutorSocket.disconnect();
    tutorSocket2.disconnect();
  });

  it('cleans up a peer and closes the room on abrupt disconnect (no explicit lesson:leave)', async () => {
    const { bookingId, tutorToken, parentToken } = await setupConfirmedBooking();
    const parentSocket = await connectSocket(parentToken);
    const tutorSocket = await connectSocket(tutorToken);

    await emitAck(parentSocket, 'lesson:join', bookingId);
    await emitAck(tutorSocket, 'lesson:join', bookingId);

    const peerLeftPromise = new Promise((resolve) => tutorSocket.once('lesson:peer_left', resolve));
    parentSocket.disconnect(); // simulates a dropped connection / closed tab, not a clean leave
    await peerLeftPromise;

    tutorSocket.disconnect();
  });

  it('a superseded connection disconnecting later must not tear down the peer that replaced it', async () => {
    // This is a regression test for a real bug found while building this
    // feature: two connections from the same user (e.g. a second tab)
    // shared one userId-keyed peer slot, so the second join silently
    // destroyed the first connection's media state, and — worse — if the
    // first (now-stale) connection later disconnected, its cleanup logic
    // deleted the *second* connection's peer instead, since both looked
    // up room state by the same userId.
    const { bookingId, tutorToken, parentToken } = await setupConfirmedBooking();
    const parentSocket = await connectSocket(parentToken);
    const tutorSocketOld = await connectSocket(tutorToken);
    await emitAck(parentSocket, 'lesson:join', bookingId);
    await emitAck(tutorSocketOld, 'lesson:join', bookingId);

    const tutorSocketNew = await connectSocket(tutorToken);
    await emitAck(tutorSocketNew, 'lesson:join', bookingId); // supersedes tutorSocketOld

    // If the old connection's disconnect wrongly tears down the new peer,
    // the parent will see a spurious peer_left here. It shouldn't.
    let sawPeerLeft = false;
    parentSocket.once('lesson:peer_left', () => { sawPeerLeft = true; });

    tutorSocketOld.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 300)); // give any (incorrect) cleanup a chance to fire
    expect(sawPeerLeft).toBe(false);

    // The new connection should still be fully functional afterward.
    const transport = await emitAck(tutorSocketNew, 'lesson:create_transport', { bookingId, direction: 'send' });
    expect(transport.ok).toBe(true);

    parentSocket.disconnect();
    tutorSocketNew.disconnect();
  });

  it('screen share: a second video producer is tagged as screen, announced to the room, and can be stopped', async () => {
    const { bookingId, tutorToken, parentToken } = await setupConfirmedBooking();
    const tutor = await connectSocket(tutorToken);
    const parent = await connectSocket(parentToken);
    await emitAck(parent, 'lesson:join', bookingId);
    await emitAck(tutor, 'lesson:join', bookingId);
    const t = await emitAck(tutor, 'lesson:create_transport', { bookingId, direction: 'send' });
    await emitAck(tutor, 'lesson:connect_transport', { bookingId, transportId: t.params.id, dtlsParameters: FAKE_DTLS_PARAMETERS });

    const announced = new Promise((resolve) => parent.once('lesson:new_producer', resolve));
    const screen = await emitAck(tutor, 'lesson:produce', { bookingId, transportId: t.params.id, kind: 'video', rtpParameters: VIDEO_RTP_PARAMETERS, source: 'screen' });
    expect(screen.ok).toBe(true);
    expect((await announced).source).toBe('screen');

    const again = await emitAck(tutor, 'lesson:produce', { bookingId, transportId: t.params.id, kind: 'video', rtpParameters: { ...VIDEO_RTP_PARAMETERS, mid: 'V2', encodings: [{ ssrc: 33333333 }] }, source: 'screen' });
    expect(again.ok).toBe(false);

    // A late joiner learns the share's source too.
    const parent2 = await connectSocket(parentToken);
    const rejoin = await emitAck(parent2, 'lesson:join', bookingId);
    expect(rejoin.existingProducers.find((p) => p.producerId === screen.id).source).toBe('screen');

    const closed = new Promise((resolve) => parent2.once('lesson:producer_closed', resolve));
    const stop = await emitAck(tutor, 'lesson:close_producer', { bookingId, producerId: screen.id });
    expect(stop.ok).toBe(true);
    expect((await closed).source).toBe('screen');

    tutor.disconnect(); parent.disconnect(); parent2.disconnect();
  });

  it('whiteboard strokes are validated, broadcast, undone, cleared only by the tutor, and saved when the room closes', async () => {
    const { bookingId, tutorToken, parentToken } = await setupConfirmedBooking();
    const tutor = await connectSocket(tutorToken);
    const parent = await connectSocket(parentToken);
    await emitAck(tutor, 'lesson:join', bookingId);
    await emitAck(parent, 'lesson:join', bookingId);

    const bad = await emitAck(parent, 'lesson:wb_stroke', { bookingId, stroke: { points: [[2, 2]] } });
    expect(bad.ok).toBe(false);

    const received = new Promise((resolve) => tutor.once('lesson:wb_stroke', resolve));
    const ok = await emitAck(parent, 'lesson:wb_stroke', { bookingId, stroke: { id: 's1', color: '#ff0000', width: 4, points: [[0.1, 0.1], [0.5, 0.5]] } });
    expect(ok.ok).toBe(true);
    expect((await received).points).toEqual([[0.1, 0.1], [0.5, 0.5]]);
    await emitAck(tutor, 'lesson:wb_stroke', { bookingId, stroke: { id: 's2', points: [[0.2, 0.2]] } });

    const undo = await emitAck(parent, 'lesson:wb_undo', { bookingId });
    expect(undo.id).toBe('s1'); // only removes the parent's own stroke

    const notAllowed = await emitAck(parent, 'lesson:wb_clear', { bookingId });
    expect(notAllowed.ok).toBe(false);

    tutor.disconnect(); parent.disconnect();
    await new Promise((r) => setTimeout(r, 400)); // room closes and saves

    const tutorAgain = await connectSocket(tutorToken);
    const join = await emitAck(tutorAgain, 'lesson:join', bookingId);
    expect(join.whiteboard.map((s) => s.id)).toEqual(['s2']);
    const cleared = await emitAck(tutorAgain, 'lesson:wb_clear', { bookingId });
    expect(cleared.ok).toBe(true);
    tutorAgain.disconnect();
  });

  it('in-call chat is broadcast, stored, returned to late joiners and readable by the parent afterwards', async () => {
    const { bookingId, tutorToken, parentToken } = await setupConfirmedBooking();
    const tutor = await connectSocket(tutorToken);
    const parent = await connectSocket(parentToken);
    await emitAck(tutor, 'lesson:join', bookingId);
    await emitAck(parent, 'lesson:join', bookingId);

    const empty = await emitAck(tutor, 'lesson:chat', { bookingId, text: '   ' });
    expect(empty.ok).toBe(false);
    const got = new Promise((resolve) => parent.once('lesson:chat', resolve));
    const sent = await emitAck(tutor, 'lesson:chat', { bookingId, text: 'Open page 12 please' });
    expect(sent.ok).toBe(true);
    expect((await got)).toMatchObject({ body: 'Open page 12 please', sender_role: 'tutor' });

    parent.disconnect();
    const parent2 = await connectSocket(parentToken);
    const join = await emitAck(parent2, 'lesson:join', bookingId);
    expect(join.chat.map((m) => m.body)).toEqual(['Open page 12 please']);

    const log = await request(app).get(`/api/bookings/${bookingId}/call-chat`).set('Authorization', `Bearer ${parentToken}`);
    expect(log.status).toBe(200);
    expect(log.body.messages[0].body).toBe('Open page 12 please');
    const { res: stranger } = await signupParent(app, { email: `sfu_chat_stranger_${Date.now()}@example.com` });
    const denied = await request(app).get(`/api/bookings/${bookingId}/call-chat`).set('Authorization', `Bearer ${stranger.body.access_token}`);
    expect(denied.status).toBe(403);

    tutor.disconnect(); parent2.disconnect();
  });

  it('the child on the booking can join the call as a student', async () => {
    const { res: tutorRes } = await signupTutor(app, { email: `sfu_ct_${Date.now()}@example.com` });
    const { res: parentRes } = await signupParent(app, { email: `sfu_cp_${Date.now()}@example.com` });
    const tutorToken = tutorRes.body.access_token;
    const parentToken = parentRes.body.access_token;
    await request(app).put('/api/tutors/me').set('Authorization', `Bearer ${tutorToken}`).send({ hourly_rate: 4000, currency: 'NGN', subjects: [] });
    await verifyUser(tutorRes.body.user.id);
    await verifyUser(parentRes.body.user.id);
    const child = (await request(app).post('/api/children').set('Authorization', `Bearer ${parentToken}`).send({ full_name: 'Call Kid' })).body.child;
    const invite = await request(app).post(`/api/children/${child.id}/invite`).set('Authorization', `Bearer ${parentToken}`);
    const kid = await request(app).post('/api/auth/child/redeem-invite').send({ code: invite.body.code, username: `callkid${Date.now()}`, password: 'KidPass1234' });
    expect(kid.status).toBe(201);

    const booking = await request(app).post('/api/bookings').set('Authorization', `Bearer ${parentToken}`).send({ tutor_id: tutorRes.body.user.id, child_id: child.id, subject: 'Maths' });
    const bookingId = booking.body.booking.id;
    await request(app).patch(`/api/bookings/${bookingId}/status`).set('Authorization', `Bearer ${tutorToken}`).send({ status: 'confirmed' });
    const pay = await request(app).post('/api/payments/initialize').set('Authorization', `Bearer ${parentToken}`).send({ booking_id: bookingId, method: 'gateway' });
    await request(app).post('/api/payments/mock/complete').set('Authorization', `Bearer ${parentToken}`).send({ reference: pay.body.reference });

    const kidSocket = await connectSocket(kid.body.access_token);
    const join = await emitAck(kidSocket, 'lesson:join', bookingId);
    expect(join.ok).toBe(true);
    expect(join.role).toBe('student');
    kidSocket.disconnect();
  });
});
