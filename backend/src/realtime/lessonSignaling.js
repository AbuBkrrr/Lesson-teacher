const db = require('../config/db');
const { getOrCreateRoom, getRoom, createWebRtcTransport } = require('../services/sfu/roomManager');
const { Peer } = require('../services/sfu/roomManager');

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

  const isParticipant = booking.parent_id === user.id || booking.tutor_id === user.id;
  if (!isParticipant) return { ok: false, error: 'Not a participant on this booking' };

  const paid = await db.prepare("SELECT id FROM payments WHERE booking_id = ? AND status = 'successful' LIMIT 1").get(bookingId);
  if (!paid) return { ok: false, error: 'This lesson has not been paid for yet, so the call is not open' };

  const role = booking.tutor_id === user.id ? 'tutor' : 'parent';
  return { ok: true, booking, role };
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
          existingProducers.push({ peerId: otherPeer.userId, role: otherPeer.role, producerId: producer.id, kind: producer.kind });
        }
      }

      ack?.({ ok: true, rtpCapabilities: room.router.rtpCapabilities, role: auth.role, existingProducers });
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

  socket.on('lesson:produce', async ({ bookingId, transportId, kind, rtpParameters }, ack) => {
    try {
      const room = getRoom(bookingId);
      const peer = room?.peers.get(socket.user.id);
      const transport = peer?.transports.get(transportId);
      if (!room || !peer || !transport) return ack?.({ ok: false, error: 'Unknown transport' });

      const producer = await transport.produce({ kind, rtpParameters });
      peer.producers.set(producer.id, producer);

      producer.on('transportclose', () => peer.producers.delete(producer.id));

      socket.to(`lesson:${bookingId}`).emit('lesson:new_producer', {
        peerId: socket.user.id, role: peer.role, producerId: producer.id, kind: producer.kind,
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
