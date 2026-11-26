const db = require('../config/db');
const { getOrCreateRoom, getRoom, createWebRtcTransport } = require('../services/sfu/roomManager');
const { Peer } = require('../services/sfu/roomManager');
const { uuidv4 } = require('../utils/referral');

const MAX_STROKES = 5000;
const MAX_POINTS = 2000;
const MAX_CHAT = 1000;
const CHAT_HISTORY = 200;
const WB_TOOLS = ['pen', 'highlighter', 'eraser'];

/**
 * A lesson video call is scoped to one booking, and only the tutor and
 * parent on that booking may join it — same trust model as the existing
 * conversation sockets, re-checked server-side rather than trusted from
 * the client. Only a confirmed, paid booking can host a live call.
 */
async function authorizeBooking(bookingId, user) {
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND deleted_at IS NULL').get(bookingId);
  if (!booking) return { ok: false, error: 'Booking not found' };
  if (booking.status !== 'confirmed') return { ok: false, error: 'This lesson is not confirmed, so the call is not open' };

  let isChild = false;
  if (user.role === 'child' && booking.child_id) {
    const child = await db.prepare('SELECT user_id FROM children WHERE id = ?').get(booking.child_id);
    isChild = !!child && child.user_id === user.id;
  }
  const isParticipant = booking.parent_id === user.id || booking.tutor_id === user.id || isChild;
  if (!isParticipant) return { ok: false, error: 'Not a participant on this booking' };

  const paid = await db.prepare("SELECT id FROM payments WHERE booking_id = ? AND status = 'successful' LIMIT 1").get(bookingId);
  if (!paid) return { ok: false, error: 'This lesson has not been paid for yet, so the call is not open' };

  const role = booking.tutor_id === user.id ? 'tutor' : isChild ? 'student' : 'parent';
  return { ok: true, booking, role };
}

/** Validates and normalises a whiteboard stroke from a client. Returns null if invalid. */
function cleanStroke(raw, userId) {
  if (!raw || typeof raw !== 'object') return null;
  const tool = WB_TOOLS.includes(raw.tool) ? raw.tool : 'pen';
  const color = typeof raw.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.color) ? raw.color : '#1f2937';
  const width = Math.min(Math.max(Number(raw.width) || 3, 1), 40);
  if (!Array.isArray(raw.points) || raw.points.length < 1 || raw.points.length > MAX_POINTS) return null;
  const points = [];
  for (const pt of raw.points) {
    if (!Array.isArray(pt) || pt.length < 2) return null;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
    points.push([Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
  }
  const id = typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : uuidv4();
  return { id, tool, color, width, points, by: userId };
}

async function loadWhiteboard(room) {
  if (room.whiteboardLoaded) return;
  const row = await db.prepare('SELECT strokes FROM lesson_whiteboards WHERE booking_id = ?').get(room.id);
  try { room.whiteboard = row ? JSON.parse(row.strokes) : []; } catch { room.whiteboard = []; }
  room.whiteboardLoaded = true;
  room.onClose = saveWhiteboard;
}

async function saveWhiteboard(room) {
  if (!room.whiteboardDirty) return;
  const ts = new Date().toISOString();
  await db.prepare(
    `INSERT INTO lesson_whiteboards (booking_id, strokes, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (booking_id) DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = EXCLUDED.updated_at`
  ).run(room.id, JSON.stringify(room.whiteboard), ts);
  room.whiteboardDirty = false;
}

async function chatHistory(bookingId) {
  const rows = await db.prepare(
    `SELECT m.id, m.sender_id, m.sender_role, m.body, m.created_at, u.full_name AS sender_name
       FROM lesson_call_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.booking_id = ? ORDER BY m.created_at DESC LIMIT ?`
  ).all(bookingId, CHAT_HISTORY);
  return rows.reverse();
}

function registerLessonHandlers(io, socket) {
  const roomsJoined = new Set(); // bookingIds this socket has joined, for disconnect cleanup

  async function leaveRoom(bookingId, { notify = true } = {}) {
    const room = getRoom(bookingId);
    if (!room) return;
    const peer = room.peers.get(socket.user.id);
    // The socketId check matters: if this user opened a second connection
    // (another tab, or a reconnect) that superseded this one, the room's
    // peers.get(userId) now belongs to that *other* connection. Without
    // this check, this socket's own disconnect/leave would tear down
    // media state it doesn't own.
    if (!peer || peer.socketId !== socket.id) return;

    peer.close();
    room.peers.delete(socket.user.id);
    socket.leave(`lesson:${bookingId}`);
    roomsJoined.delete(bookingId);

    if (notify) socket.to(`lesson:${bookingId}`).emit('lesson:peer_left', { peerId: socket.user.id });

    if (room.isEmpty()) await room.close();
  }

  socket.on('lesson:join', async (bookingId, ack) => {
    try {
      const auth = await authorizeBooking(bookingId, socket.user);
      if (!auth.ok) return ack?.({ ok: false, error: auth.error });

      const room = await getOrCreateRoom(bookingId);

      // A second connection for the same user (another tab, or a
      // reconnect that raced ahead of the old socket's disconnect event)
      // supersedes the old one. Close the old peer's media state and tell
      // that socket directly — it can no longer assume anything it does
      // in this room will take effect, and its own cleanup must not touch
      // whatever peer entry exists here after this point.
      const stale = room.peers.get(socket.user.id);
      if (stale) {
        room.peers.delete(socket.user.id);
        stale.close();
        const staleSocket = io.sockets.sockets.get(stale.socketId);
        if (staleSocket) {
          staleSocket.leave(`lesson:${bookingId}`);
          staleSocket.emit('lesson:replaced', { bookingId });
        }
      }

      const peer = new Peer(socket.user.id, socket.id, auth.role);
      room.peers.set(socket.user.id, peer);
      socket.join(`lesson:${bookingId}`);
      roomsJoined.add(bookingId);

      // Tell the joining peer about everyone already producing media, so
      // they can immediately start consuming without waiting on a race.
      const existingProducers = [];
      for (const otherPeer of room.peers.values()) {
        if (otherPeer.userId === socket.user.id) continue;
        for (const producer of otherPeer.producers.values()) {
          existingProducers.push({
            peerId: otherPeer.userId, role: otherPeer.role, producerId: producer.id, kind: producer.kind,
            source: producer.appData?.source || (producer.kind === 'audio' ? 'mic' : 'camera'),
          });
        }
      }

      await loadWhiteboard(room);
      const participants = [...room.peers.values()].map((p) => ({ peerId: p.userId, role: p.role }));
      socket.to(`lesson:${bookingId}`).emit('lesson:peer_joined', { peerId: socket.user.id, role: auth.role });

      ack?.({
        ok: true, rtpCapabilities: room.router.rtpCapabilities, role: auth.role, existingProducers,
        participants, whiteboard: room.whiteboard, chat: await chatHistory(bookingId),
      });
    } catch (err) {
      console.error('[sfu] lesson:join failed', err);
      ack?.({ ok: false, error: 'Failed to join the lesson room' });
    }
  });

  socket.on('lesson:create_transport', async ({ bookingId, direction }, ack) => {
    try {
      const room = getRoom(bookingId);
      const peer = room?.peers.get(socket.user.id);
      if (!room || !peer) return ack?.({ ok: false, error: 'Join the room before creating a transport' });

      const transport = await createWebRtcTransport(room.router);
      transport.appData = { direction };
      peer.transports.set(transport.id, transport);

      transport.on('dtlsstatechange', (state) => {
        if (state === 'closed') transport.close();
      });

      ack?.({
        ok: true,
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    } catch (err) {
      console.error('[sfu] create_transport failed', err);
      ack?.({ ok: false, error: 'Failed to create transport' });
    }
  });

  socket.on('lesson:connect_transport', async ({ bookingId, transportId, dtlsParameters }, ack) => {
    try {
      const peer = getRoom(bookingId)?.peers.get(socket.user.id);
      const transport = peer?.transports.get(transportId);
      if (!transport) return ack?.({ ok: false, error: 'Unknown transport' });

      await transport.connect({ dtlsParameters });
      ack?.({ ok: true });
    } catch (err) {
      console.error('[sfu] connect_transport failed', err);
      ack?.({ ok: false, error: 'Failed to connect transport' });
    }
  });

  socket.on('lesson:produce', async ({ bookingId, transportId, kind, rtpParameters, source }, ack) => {
    try {
      const room = getRoom(bookingId);
      const peer = room?.peers.get(socket.user.id);
      const transport = peer?.transports.get(transportId);
      if (!room || !peer || !transport) return ack?.({ ok: false, error: 'Unknown transport' });

      // `source` tells the other side whether a video track is the camera or a
      // screen share, so it can lay them out differently.
      const src = kind === 'audio' ? 'mic' : (source === 'screen' ? 'screen' : 'camera');
      if (src === 'screen') {
        for (const existing of peer.producers.values()) {
          if (existing.appData?.source === 'screen') return ack?.({ ok: false, error: 'You are already sharing your screen' });
        }
      }
      const producer = await transport.produce({ kind, rtpParameters, appData: { source: src } });
      peer.producers.set(producer.id, producer);

      producer.on('transportclose', () => peer.producers.delete(producer.id));

      socket.to(`lesson:${bookingId}`).emit('lesson:new_producer', {
        peerId: socket.user.id, role: peer.role, producerId: producer.id, kind: producer.kind, source: src,
      });

      ack?.({ ok: true, id: producer.id });
    } catch (err) {
      console.error('[sfu] produce failed', err);
      ack?.({ ok: false, error: 'Failed to produce media' });
    }
  });

  socket.on('lesson:consume', async ({ bookingId, transportId, producerId, rtpCapabilities }, ack) => {
    try {
      const room = getRoom(bookingId);
      const peer = room?.peers.get(socket.user.id);
      const transport = peer?.transports.get(transportId);
      if (!room || !peer || !transport) return ack?.({ ok: false, error: 'Unknown transport' });

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        return ack?.({ ok: false, error: 'Incompatible media capabilities' });
      }

      // Consumers start paused — mediasoup requires the client to have the
      // <video>/<audio> element wired up and ready before flowing media,
      // signaled back via lesson:resume_consumer.
      const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
      peer.consumers.set(consumer.id, consumer);
      consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
      consumer.on('producerclose', () => {
        peer.consumers.delete(consumer.id);
        socket.emit('lesson:consumer_closed', { consumerId: consumer.id });
      });

      ack?.({
        ok: true,
        params: {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        },
      });
    } catch (err) {
      console.error('[sfu] consume failed', err);
      ack?.({ ok: false, error: 'Failed to consume media' });
    }
  });

  socket.on('lesson:resume_consumer', async ({ bookingId, consumerId }, ack) => {
    try {
      const peer = getRoom(bookingId)?.peers.get(socket.user.id);
      const consumer = peer?.consumers.get(consumerId);
      if (!consumer) return ack?.({ ok: false, error: 'Unknown consumer' });

      await consumer.resume();
      ack?.({ ok: true });
    } catch (err) {
      console.error('[sfu] resume_consumer failed', err);
      ack?.({ ok: false, error: 'Failed to resume consumer' });
    }
  });

  /** Stops one of this peer's own tracks (used to end a screen share). */
  socket.on('lesson:close_producer', ({ bookingId, producerId }, ack) => {
    const peer = getRoom(bookingId)?.peers.get(socket.user.id);
    const producer = peer?.producers.get(producerId);
    if (!producer) return ack?.({ ok: false, error: 'Unknown producer' });
    producer.close(); // consumers on the other side get 'producerclose' -> lesson:consumer_closed
    peer.producers.delete(producerId);
    socket.to(`lesson:${bookingId}`).emit('lesson:producer_closed', { peerId: socket.user.id, producerId, source: producer.appData?.source });
    ack?.({ ok: true });
  });

  // ---- Shared whiteboard ------------------------------------------------
  socket.on('lesson:wb_stroke', ({ bookingId, stroke } = {}, ack) => {
    const room = getRoom(bookingId);
    if (!room?.peers.get(socket.user.id)) return ack?.({ ok: false, error: 'Join the lesson first' });
    const clean = cleanStroke(stroke, socket.user.id);
    if (!clean) return ack?.({ ok: false, error: 'Invalid stroke' });
    if (room.whiteboard.length >= MAX_STROKES) return ack?.({ ok: false, error: 'The whiteboard is full — clear it to keep drawing' });
    room.whiteboard.push(clean);
    room.whiteboardDirty = true;
    socket.to(`lesson:${bookingId}`).emit('lesson:wb_stroke', clean);
    ack?.({ ok: true, id: clean.id });
  });

  socket.on('lesson:wb_undo', ({ bookingId } = {}, ack) => {
    const room = getRoom(bookingId);
    if (!room?.peers.get(socket.user.id)) return ack?.({ ok: false, error: 'Join the lesson first' });
    for (let i = room.whiteboard.length - 1; i >= 0; i--) {
      if (room.whiteboard[i].by === socket.user.id) {
        const [removed] = room.whiteboard.splice(i, 1);
        room.whiteboardDirty = true;
        io.to(`lesson:${bookingId}`).emit('lesson:wb_remove', { id: removed.id });
        return ack?.({ ok: true, id: removed.id });
      }
    }
    ack?.({ ok: true, id: null });
  });

  socket.on('lesson:wb_clear', ({ bookingId } = {}, ack) => {
    const room = getRoom(bookingId);
    const peer = room?.peers.get(socket.user.id);
    if (!peer) return ack?.({ ok: false, error: 'Join the lesson first' });
    if (peer.role !== 'tutor') return ack?.({ ok: false, error: 'Only the tutor can clear the whiteboard' });
    room.whiteboard = [];
    room.whiteboardDirty = true;
    io.to(`lesson:${bookingId}`).emit('lesson:wb_cleared', { by: socket.user.id });
    ack?.({ ok: true });
  });

  // ---- In-call chat (stored, so parents can review it later) -------------
  socket.on('lesson:chat', async ({ bookingId, text } = {}, ack) => {
    try {
      const peer = getRoom(bookingId)?.peers.get(socket.user.id);
      if (!peer) return ack?.({ ok: false, error: 'Join the lesson first' });
      const body = typeof text === 'string' ? text.trim() : '';
      if (!body) return ack?.({ ok: false, error: 'Message is empty' });
      if (body.length > MAX_CHAT) return ack?.({ ok: false, error: `Messages are limited to ${MAX_CHAT} characters` });
      const msg = {
        id: uuidv4(), booking_id: bookingId, sender_id: socket.user.id, sender_role: peer.role,
        sender_name: socket.user.full_name || null, body, created_at: new Date().toISOString(),
      };
      await db.prepare('INSERT INTO lesson_call_messages (id, booking_id, sender_id, sender_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(msg.id, bookingId, msg.sender_id, msg.sender_role, body, msg.created_at);
      if (!msg.sender_name) {
        const u = await db.prepare('SELECT full_name FROM users WHERE id = ?').get(socket.user.id);
        msg.sender_name = u?.full_name || null;
      }
      io.to(`lesson:${bookingId}`).emit('lesson:chat', msg);
      ack?.({ ok: true, message: msg });
    } catch (err) {
      console.error('[sfu] lesson:chat failed', err);
      ack?.({ ok: false, error: 'Message could not be sent' });
    }
  });

  socket.on('lesson:leave', async (bookingId, ack) => {
    await leaveRoom(bookingId);
    ack?.({ ok: true });
  });

  socket.on('disconnect', async () => {
    for (const bookingId of [...roomsJoined]) {
      await leaveRoom(bookingId, { notify: true });
    }
  });
}

module.exports = { registerLessonHandlers };
