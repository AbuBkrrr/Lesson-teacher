const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const db = require('../config/db');
const { registerLessonHandlers } = require('./lessonSignaling');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' }, // tighten to your actual origins in production
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing auth token'));
      const payload = verifyAccessToken(token);
      socket.user = { id: payload.sub, role: payload.role, school_id: payload.school_id };
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  const touch = (userId) => db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), userId).catch(() => {});

  io.on('connection', (socket) => {
    touch(socket.user.id);
    socket.on('presence_ping', () => touch(socket.user.id));
    socket.on('disconnect', () => touch(socket.user.id));
    // Super Admin sockets sit in a shared room to receive live flagged-message alerts.
    if (socket.user.role === 'super_admin') {
      socket.join('admin_flags');
    }

    /**
     * join_conversation — the client asks to receive live messages for
     * one conversation. We re-check access server-side rather than
     * trusting the client, exactly like the REST endpoints do.
     */
    socket.on('join_conversation', async (conversationId, ack) => {
      try {
        const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
        if (!conversation) return ack?.({ ok: false, error: 'Conversation not found' });

        const allowed =
          socket.user.role === 'super_admin' ||
          (socket.user.role === 'tutor' && conversation.tutor_id === socket.user.id) ||
          (socket.user.role === 'parent' && conversation.parent_id === socket.user.id) ||
          (socket.user.role === 'child' &&
            (await db.prepare('SELECT user_id FROM children WHERE id = ?').get(conversation.child_id))?.user_id === socket.user.id);

        if (!allowed) return ack?.({ ok: false, error: 'Not authorized' });

        socket.join(`conversation:${conversationId}`);
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: 'Failed to join conversation' });
      }
    });

    // Typing indicator: relayed only from sockets that already passed the join_conversation check.
    socket.on('typing', ({ conversationId, typing } = {}) => {
      if (!conversationId || !socket.rooms.has(`conversation:${conversationId}`)) return;
      socket.to(`conversation:${conversationId}`).emit('typing', { conversation_id: conversationId, user_id: socket.user.id, typing: !!typing });
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
    });

    registerLessonHandlers(io, socket);
  });

  return io;
}

module.exports = { initSocket };
