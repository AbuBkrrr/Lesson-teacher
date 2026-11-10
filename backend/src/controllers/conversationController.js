const db = require('../config/db');
const { getStorageProvider } = require('../services/storageProviders');
const { uuidv4 } = require('../utils/referral');
const { checkMessage } = require('../services/contentFlagging');
const { notifyUser, templates } = require('../services/notifications');

// Who else is in this conversation besides the sender — used to decide who
// gets the "new message" notification. A child_tutor conversation's other
// party is the child's own login (not the monitoring parent), matching who
// can actually send/receive messages in it (see canSendInConversation).
async function resolveRecipientUserId(conversation, senderUserId) {
  if (conversation.kind === 'child_tutor') {
    if (senderUserId === conversation.tutor_id) {
      const child = await db.prepare('SELECT user_id FROM children WHERE id = ?').get(conversation.child_id);
      return child?.user_id || null;
    }
    return conversation.tutor_id;
  }
  return senderUserId === conversation.tutor_id ? conversation.parent_id : conversation.tutor_id;
}

function now() {
  return new Date().toISOString();
}

/**
 * POST /api/conversations
 * body: { tutor_id, child_id? }
 *
 * With child_id -> a 'child_tutor' conversation (existing behavior):
 *   only the child or the tutor can call this, gated on a
 *   confirmed/completed booking between that exact tutor and child.
 *   The parent gets automatic read access, never write access.
 *
 * Without child_id -> a 'parent_tutor' conversation: only a parent can
 * initiate this (talking to a tutor directly about logistics, not
 * routed through a child). Gated on any confirmed/completed booking
 * existing between that parent and tutor (any child, or none).
 */
async function getOrCreate(req, res) {
  const { tutor_id, child_id } = req.body || {};
  if (!tutor_id) return res.status(400).json({ error: 'tutor_id is required' });

  if (child_id) {
    return createChildTutorConversation(req, res, tutor_id, child_id);
  }
  return createParentTutorConversation(req, res, tutor_id);
}

async function createChildTutorConversation(req, res, tutor_id, child_id) {
  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND deleted_at IS NULL').get(child_id);
  if (!child) return res.status(404).json({ error: 'Child not found' });

  if (req.user.role === 'child' && child.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your account' });
  }
  if (req.user.role === 'tutor' && req.user.id !== tutor_id) {
    return res.status(403).json({ error: 'Not your account' });
  }
  if (!['child', 'tutor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the child or the tutor can start this conversation' });
  }

  const validRelationship = await db
    .prepare(
      `SELECT id FROM bookings WHERE tutor_id = ? AND child_id = ? AND status IN ('confirmed','completed') AND deleted_at IS NULL LIMIT 1`
    )
    .get(tutor_id, child_id);
  if (!validRelationship) {
    return res.status(403).json({ error: 'A confirmed booking between this tutor and child is required before messaging can start' });
  }

  let conversation = await db.prepare("SELECT * FROM conversations WHERE tutor_id = ? AND child_id = ? AND kind = 'child_tutor'").get(tutor_id, child_id);
  if (!conversation) {
    const id = uuidv4();
    const ts = now();
    await db.prepare(
      "INSERT INTO conversations (id, kind, tutor_id, child_id, parent_id, created_at, updated_at) VALUES (?, 'child_tutor', ?, ?, ?, ?, ?)"
    ).run(id, tutor_id, child_id, child.parent_id, ts, ts);
    conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  }

  res.status(201).json({ conversation });
}

async function createParentTutorConversation(req, res, tutor_id) {
  if (!['parent','adult_student'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only a parent can start a direct conversation with a tutor' });
  }

  const tutor = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'tutor' AND deleted_at IS NULL").get(tutor_id);
  if (!tutor) return res.status(404).json({ error: 'Tutor not found' });

  const validRelationship = await db
    .prepare(
      `SELECT id FROM bookings WHERE tutor_id = ? AND parent_id = ? AND status IN ('confirmed','completed') AND deleted_at IS NULL LIMIT 1`
    )
    .get(tutor_id, req.user.id);
  if (!validRelationship) {
    return res.status(403).json({ error: 'A confirmed booking with this tutor is required before messaging can start' });
  }

  let conversation = await db.prepare("SELECT * FROM conversations WHERE tutor_id = ? AND parent_id = ? AND kind = 'parent_tutor'").get(tutor_id, req.user.id);
  if (!conversation) {
    const id = uuidv4();
    const ts = now();
    await db.prepare(
      "INSERT INTO conversations (id, kind, tutor_id, child_id, parent_id, created_at, updated_at) VALUES (?, 'parent_tutor', ?, NULL, ?, ?, ?)"
    ).run(id, tutor_id, req.user.id, ts, ts);
    conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  }

  res.status(201).json({ conversation });
}

async function canAccessConversation(user, conversation) {
  if (user.role === 'super_admin') return true;
  if (user.role === 'tutor') return conversation.tutor_id === user.id;
  if (user.role === 'parent' || user.role === 'adult_student') return conversation.parent_id === user.id; // read access to child_tutor, full access to parent_tutor
  if (user.role === 'child') {
    if (conversation.kind !== 'child_tutor') return false;
    const child = await db.prepare('SELECT user_id FROM children WHERE id = ?').get(conversation.child_id);
    return child?.user_id === user.id;
  }
  return false;
}

function canSendInConversation(user, conversation) {
  if (conversation.kind === 'parent_tutor') return ['parent', 'adult_student', 'tutor'].includes(user.role);
  return ['child', 'tutor'].includes(user.role); // child_tutor: parent is always read-only, by design
}

async function upsertRead(conversationId, userId, ts) {
  await db.prepare(
    `INSERT INTO conversation_reads (conversation_id, user_id, last_read_at) VALUES (?, ?, ?)
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at`
  ).run(conversationId, userId, ts);
}


const EDIT_WINDOW_MS = 15 * 60 * 1000;
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_MIME = /^(image\/(png|jpe?g|gif|webp)|audio\/|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+))/;
const DISAPPEAR_CHOICES = [0, 3600, 86400, 604800]; // off, 1h, 24h, 7d

/** Adds reactions + reply preview to a batch of raw rows, then applies viewer masking. */
async function enrichAll(rows, viewer, conversation) {
  if (!rows.length) return [];
  const ids = rows.map((m) => m.id);
  const ph = (a) => a.map(() => '?').join(',');
  const reactions = await db.prepare(`SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (${ph(ids)})`).all(...ids);
  const replyIds = [...new Set(rows.map((m) => m.reply_to_id).filter(Boolean))];
  const replyRows = replyIds.length
    ? await db.prepare(`SELECT id, content, sender_id, deleted_at, attachment_name FROM messages WHERE id IN (${ph(replyIds)})`).all(...replyIds)
    : [];
  const replyById = Object.fromEntries(replyRows.map((r) => [r.id, r]));
  return rows.map((m) => {
    const v = viewMessage(m, viewer, conversation);
    v.reactions = reactions.filter((r) => r.message_id === m.id).map((r) => ({ user_id: r.user_id, emoji: r.emoji }));
    const r = m.reply_to_id ? replyById[m.reply_to_id] : null;
    v.reply_to = r ? { id: r.id, sender_id: r.sender_id, content: r.deleted_at ? '' : (r.content || r.attachment_name || 'Attachment').slice(0, 100), deleted: !!r.deleted_at } : null;
    if (v.deleted && !(viewer.role === 'super_admin' || (viewer.role === 'parent' && conversation.kind === 'child_tutor'))) {
      v.attachment_url = null; v.attachment_name = null; v.attachment_type = null; v.attachment_size = null; v.reply_to = null;
    }
    return v;
  });
}
const enrichOne = async (row, viewer, conversation) => (await enrichAll([row], viewer, conversation))[0];


/** Participants never see deleted text or edit history; admins and a monitoring parent (child_tutor) do. */
function viewMessage(msg, viewer, conversation) {
  const privileged = viewer.role === 'super_admin' || (viewer.role === 'parent' && conversation.kind === 'child_tutor');
  const { original_content, ...rest } = msg;
  const out = { ...rest, edited: !!msg.edited_at, deleted: !!msg.deleted_at };
  if (msg.deleted_at && !privileged) out.content = '';
  if (privileged && original_content) out.original_content = original_content;
  return out;
}

/**
 * GET /api/conversations/:id/messages
 * Viewing a thread marks it read for the viewer (standard chat-app
 * behavior), and the response includes the *other* participant's own
 * last_read_at so the UI can show a "Seen" marker — read-only observers
 * (a monitoring parent, a super_admin) get their own read stamped too,
 * but are never the "other party" used for anyone else's receipt.
 */
async function listMessages(req, res) {
  const { id } = req.params;
  const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  if (!(await canAccessConversation(req.user, conversation))) return res.status(403).json({ error: 'Not authorized to view this conversation' });

  // ?after=<ISO> returns only newer messages (delta sync for offline-first clients).
  const after = typeof req.query.after === 'string' && !Number.isNaN(Date.parse(req.query.after)) ? req.query.after : null;
  const nowIso = now();
  const messages = after
    ? await db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND (expires_at IS NULL OR expires_at > ?) AND (created_at > ? OR edited_at > ? OR deleted_at > ?) ORDER BY created_at ASC').all(id, nowIso, after, after, after)
    : await db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC').all(id, nowIso);

  const ts = now();
  if (canSendInConversation(req.user, conversation)) {
    await upsertRead(id, req.user.id, ts);
    const io = req.app.get('io');
    if (io) io.to(`conversation:${id}`).emit('conversation_read', { conversation_id: id, user_id: req.user.id, read_at: ts });
  }

  let otherReadAt = null;
  const otherUserId = await resolveRecipientUserId(conversation, req.user.id);
  if (otherUserId) {
    const row = await db.prepare('SELECT last_read_at FROM conversation_reads WHERE conversation_id = ? AND user_id = ?').get(id, otherUserId);
    otherReadAt = row?.last_read_at || null;
  }

  res.json({ conversation, messages: await enrichAll(messages, req.user, conversation), other_read_at: otherReadAt });
}

/** POST /api/conversations/:id/read — explicit mark-as-read, for a client that doesn't want listMessages' implicit one (e.g. a push-driven unread badge clear) */
async function markRead(req, res) {
  const { id } = req.params;
  const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  if (!(await canAccessConversation(req.user, conversation))) return res.status(403).json({ error: 'Not authorized for this conversation' });

  const readAt = now();
  await upsertRead(id, req.user.id, readAt);
  const io = req.app.get('io');
  if (io) io.to(`conversation:${id}`).emit('conversation_read', { conversation_id: id, user_id: req.user.id, read_at: readAt });
  res.json({ ok: true });
}

/** GET /api/conversations/unread-count — total unread messages across every conversation this user participates in (for a nav badge) */
async function unreadCount(req, res) {
  if (!['tutor', 'child', 'parent', 'adult_student'].includes(req.user.role)) {
    return res.json({ unread: 0 });
  }

  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.sender_id != ?
       AND (
         (c.tutor_id = ? AND c.kind IN ('child_tutor', 'parent_tutor'))
         OR (c.parent_id = ? AND c.kind = 'parent_tutor')
         OR (c.child_id IN (SELECT id FROM children WHERE user_id = ?) AND c.kind = 'child_tutor')
       )
       AND m.created_at > COALESCE(
         (SELECT last_read_at FROM conversation_reads cr WHERE cr.conversation_id = c.id AND cr.user_id = ?),
         '1970-01-01T00:00:00.000Z'
       )`
  ).get(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

  res.json({ unread: Number(row.count) });
}

/** POST /api/conversations/:id/messages  body: { content } */
async function sendMessage(req, res) {
  const { id } = req.params;
  const file = req.file || null;
  const content = typeof req.body?.content === 'string' ? req.body.content : (file ? '' : undefined);
  const clientId = typeof req.body?.client_id === 'string' && req.body.client_id.length <= 64 ? req.body.client_id : null;
  const replyToId = typeof req.body?.reply_to_id === 'string' ? req.body.reply_to_id : null;
  const dropFile = () => { try { if (file?.path) require('fs').unlinkSync(file.path); } catch { /* best effort */ } };
  if (typeof content !== 'string' || (!content.trim() && !file)) { dropFile(); return res.status(400).json({ error: 'content is required' }); }
  if (content.length > 5000) { dropFile(); return res.status(400).json({ error: 'Message is too long (max 5000 characters)' }); }
  if (file && (!ATTACHMENT_MIME.test(file.mimetype || '') || file.size > MAX_ATTACHMENT_BYTES)) {
    dropFile();
    return res.status(400).json({ error: 'Attachments must be an image, PDF, document, text or audio file up to 10 MB' });
  }

  const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  if (!(await canAccessConversation(req.user, conversation))) { dropFile(); return res.status(403).json({ error: 'Not authorized to message in this conversation' }); }
  if (!canSendInConversation(req.user, conversation)) {
    dropFile();
    return res.status(403).json({ error: 'This role cannot send messages in this type of conversation' });
  }
  if (replyToId) {
    const target = await db.prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?').get(replyToId, id);
    if (!target) { dropFile(); return res.status(400).json({ error: 'Reply target not found in this conversation' }); }
  }

  // The grooming-pattern flagging exists to protect a minor in a
  // child<->tutor conversation. It doesn't apply to an adult-to-adult
  // parent_tutor conversation — that's a category error, not a
  // safety measure, if applied there.
  const flagReason = conversation.kind === 'child_tutor' ? checkMessage(content) : null;

  if (clientId) {
    const dup = await db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND sender_id = ? AND client_id = ?').get(id, req.user.id, clientId);
    if (dup) return res.status(200).json({ message: dup, duplicate: true });
  }

  const messageId = uuidv4();
  const ts = now();
  const expiresAt = conversation.disappear_after_seconds ? new Date(Date.now() + conversation.disappear_after_seconds * 1000).toISOString() : null;
  let att = { url: null, name: null, type: null, size: null };
  if (file) {
    const { fileUrl } = await getStorageProvider().describeUploadedFile(req, file);
    att = { url: fileUrl, name: String(file.originalname || 'file').slice(0, 200), type: file.mimetype, size: file.size };
  }

  try {
    await db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, sender_role, content, flagged, flag_reason, created_at, client_id,
                             reply_to_id, attachment_url, attachment_name, attachment_type, attachment_size, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(messageId, id, req.user.id, req.user.role, content.trim(), flagReason ? 1 : 0, flagReason, ts, clientId,
      replyToId, att.url, att.name, att.type, att.size, expiresAt);
  } catch (err) {
    if (err.code === '23505' && clientId) {
      const dup = await db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND sender_id = ? AND client_id = ?').get(id, req.user.id, clientId);
      if (dup) return res.status(200).json({ message: dup, duplicate: true });
    }
    throw err;
  }

  await db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(ts, id);

  const message = await db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);

  const io = req.app.get('io');
  if (io) io.to(`conversation:${id}`).emit('new_message', await enrichOne(message, { role: 'tutor' }, conversation));
  if (flagReason && io) io.to('admin_flags').emit('flagged_message', { conversation, message });

  const recipientId = await resolveRecipientUserId(conversation, req.user.id);
  if (recipientId) {
    const [recipientUser, senderUser] = await Promise.all([
      db.prepare('SELECT * FROM users WHERE id = ?').get(recipientId),
      db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id),
    ]);
    if (recipientUser) await notifyUser(recipientUser, templates.newMessage(senderUser.full_name));
  }

  res.status(201).json({ message: await enrichOne(message, req.user, conversation) });
}

// Appended to each myConversations query as `${UNREAD_SELECT(paramIndexPlaceholder)}` —
// counts the caller's own unread messages in that conversation (everything
// from the other party since the caller's own last_read_at).
const UNREAD_SUBQUERY = `(
  SELECT COUNT(*) FROM messages m
  WHERE m.conversation_id = c.id AND m.sender_id != ?
    AND m.created_at > COALESCE(
      (SELECT last_read_at FROM conversation_reads cr WHERE cr.conversation_id = c.id AND cr.user_id = ?),
      '1970-01-01T00:00:00.000Z'
    )
) AS unread_count`;


async function loadOwnMessage(req, res) {
  const { id, messageId } = req.params;
  const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conversation) { res.status(404).json({ error: 'Conversation not found' }); return null; }
  if (!(await canAccessConversation(req.user, conversation)) || !canSendInConversation(req.user, conversation)) {
    res.status(403).json({ error: 'Not authorized' }); return null;
  }
  const msg = await db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, id);
  if (!msg) { res.status(404).json({ error: 'Message not found' }); return null; }
  if (msg.sender_id !== req.user.id) { res.status(403).json({ error: 'You can only change your own messages' }); return null; }
  if (msg.deleted_at) { res.status(409).json({ error: 'Message was deleted' }); return null; }
  return { conversation, msg };
}

/** PATCH /api/conversations/:id/messages/:messageId — edit own message within 15 minutes */
async function editMessage(req, res) {
  const { content } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'content is required' });
  if (content.length > 5000) return res.status(400).json({ error: 'Message is too long (max 5000 characters)' });
  const found = await loadOwnMessage(req, res);
  if (!found) return;
  const { conversation, msg } = found;
  if (Date.now() - Date.parse(msg.created_at) > EDIT_WINDOW_MS) return res.status(403).json({ error: 'Messages can only be edited within 15 minutes' });
  const text = content.trim();
  if (text === msg.content) return res.json({ message: await enrichOne(msg, req.user, conversation) });
  const flagReason = conversation.kind === 'child_tutor' ? checkMessage(text) : null;
  await db.prepare(
    'UPDATE messages SET content = ?, edited_at = ?, original_content = COALESCE(original_content, ?), flagged = ?, flag_reason = ? WHERE id = ?'
  ).run(text, now(), msg.content, (flagReason || msg.flagged) ? 1 : 0, flagReason || msg.flag_reason, msg.id);
  const updated = await db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  const io = req.app.get('io');
  if (io) io.to(`conversation:${conversation.id}`).emit('message_updated', await enrichOne(updated, { role: 'tutor' }, conversation));
  res.json({ message: await enrichOne(updated, req.user, conversation) });
}

/** DELETE /api/conversations/:id/messages/:messageId — delete for everyone (soft; kept for safety review) */
async function deleteMessage(req, res) {
  const found = await loadOwnMessage(req, res);
  if (!found) return;
  const { conversation, msg } = found;
  await db.prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run(now(), msg.id);
  const updated = await db.prepare('SELECT * FROM messages WHERE id = ?').get(msg.id);
  const io = req.app.get('io');
  if (io) io.to(`conversation:${conversation.id}`).emit('message_updated', await enrichOne(updated, { role: 'tutor' }, conversation));
  res.json({ message: await enrichOne(updated, req.user, conversation) });
}


/** PUT /api/conversations/:id/messages/:messageId/reaction  body: { emoji } (null/'' removes yours) */
async function reactToMessage(req, res) {
  const { id, messageId } = req.params;
  const emoji = req.body?.emoji || null;
  if (emoji && !REACTION_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Unsupported reaction' });
  const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  if (!(await canAccessConversation(req.user, conversation)) || !canSendInConversation(req.user, conversation)) return res.status(403).json({ error: 'Not authorized' });
  const msg = await db.prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND deleted_at IS NULL').get(messageId, id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (!emoji) await db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(messageId, req.user.id);
  else {
    await db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?').run(messageId, req.user.id);
    await db.prepare('INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(messageId, req.user.id, emoji, now());
  }
  const updated = await enrichOne(msg, { role: 'tutor' }, conversation);
  const io = req.app.get('io');
  if (io) io.to(`conversation:${id}`).emit('message_updated', updated);
  res.json({ message: await enrichOne(msg, req.user, conversation) });
}

/** PATCH /api/conversations/:id/settings  body: { disappear_after_seconds } — adult conversations only */
async function updateSettings(req, res) {
  const { id } = req.params;
  const secs = Number(req.body?.disappear_after_seconds);
  if (!DISAPPEAR_CHOICES.includes(secs)) return res.status(400).json({ error: `disappear_after_seconds must be one of ${DISAPPEAR_CHOICES.join(', ')}` });
  const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  if (!(await canAccessConversation(req.user, conversation)) || !canSendInConversation(req.user, conversation)) return res.status(403).json({ error: 'Not authorized' });
  if (conversation.kind === 'child_tutor') return res.status(403).json({ error: 'Disappearing messages are not available in conversations with a child, so a parent can always review them' });
  await db.prepare('UPDATE conversations SET disappear_after_seconds = ? WHERE id = ?').run(secs || null, id);
  const io = req.app.get('io');
  if (io) io.to(`conversation:${id}`).emit('conversation_settings', { conversation_id: id, disappear_after_seconds: secs || null });
  res.json({ conversation: { ...conversation, disappear_after_seconds: secs || null } });
}

/** GET /api/conversations/:id/presence — whether the other participant is online (heartbeat within 60 s) */
async function presence(req, res) {
  const conversation = await db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  if (!(await canAccessConversation(req.user, conversation)) || !canSendInConversation(req.user, conversation)) return res.status(403).json({ error: 'Not authorized' });
  const otherId = await resolveRecipientUserId(conversation, req.user.id);
  const row = otherId ? await db.prepare('SELECT last_seen_at FROM users WHERE id = ?').get(otherId) : null;
  const last = row?.last_seen_at || null;
  res.json({ online: !!last && Date.now() - Date.parse(last) < 60000, last_seen_at: last });
}

/** Removes expired disappearing messages (called on a timer from server.js). */
async function purgeExpiredMessages() {
  return db.prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now());
}


/** GET /api/conversations/export — the caller's own conversations and messages as a downloadable JSON backup */
async function exportChats(req, res) {
  const u = req.user;
  let convs;
  if (u.role === 'tutor') convs = await db.prepare('SELECT * FROM conversations WHERE tutor_id = ?').all(u.id);
  else if (u.role === 'child') convs = await db.prepare("SELECT c.* FROM conversations c JOIN children ch ON ch.id = c.child_id WHERE ch.user_id = ? AND c.kind = 'child_tutor'").all(u.id);
  else if (['parent', 'adult_student'].includes(u.role)) convs = await db.prepare("SELECT * FROM conversations WHERE parent_id = ? AND kind = 'parent_tutor'").all(u.id);
  else return res.status(403).json({ error: 'Not available for this role' });
  const nowIso = now();
  const out = [];
  for (const c of convs) {
    const rows = await db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC').all(c.id, nowIso);
    const msgs = (await enrichAll(rows, u, c)).map(({ flagged, flag_reason, ...m }) => m);
    out.push({ conversation: c, messages: msgs });
  }
  res.setHeader('Content-Disposition', 'attachment; filename="lesson-teacher-chats.json"');
  res.json({ exported_at: nowIso, user_id: u.id, conversations: out });
}

/** GET /api/conversations/mine — for tutor, child, or parent: their own conversation list */
async function myConversations(req, res) {
  let rows;
  if (req.user.role === 'tutor') {
    rows = await db
      .prepare(
        `SELECT c.*, ch.full_name AS child_name, p.full_name AS parent_name, ${UNREAD_SUBQUERY}
         FROM conversations c
         LEFT JOIN children ch ON ch.id = c.child_id
         JOIN users p ON p.id = c.parent_id
         WHERE c.tutor_id = ? ORDER BY c.updated_at DESC`
      )
      .all(req.user.id, req.user.id, req.user.id);
  } else if (req.user.role === 'child') {
    const child = await db.prepare('SELECT id FROM children WHERE user_id = ?').get(req.user.id);
    rows = child
      ? await db
          .prepare(`SELECT c.*, u.full_name AS tutor_name, ${UNREAD_SUBQUERY} FROM conversations c JOIN users u ON u.id = c.tutor_id WHERE c.child_id = ? AND c.kind = 'child_tutor' ORDER BY c.updated_at DESC`)
          .all(req.user.id, req.user.id, child.id)
      : [];
  } else if (['parent','adult_student'].includes(req.user.role)) {
    // Only the parent's OWN direct conversations with tutors — not the
    // child_tutor ones, which live under /monitor instead, kept
    // separate so "my conversations" never accidentally reads like a
    // send-enabled inbox for a child's conversation.
    rows = await db
      .prepare(`SELECT c.*, u.full_name AS tutor_name, ${UNREAD_SUBQUERY} FROM conversations c JOIN users u ON u.id = c.tutor_id WHERE c.parent_id = ? AND c.kind = 'parent_tutor' ORDER BY c.updated_at DESC`)
      .all(req.user.id, req.user.id, req.user.id);
  } else {
    return res.status(403).json({ error: 'Not available for this role' });
  }
  const lastByConv = {};
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const lasts = await db.prepare(
      `SELECT DISTINCT ON (conversation_id) conversation_id, content, sender_id, created_at, deleted_at, attachment_name FROM messages WHERE (expires_at IS NULL OR expires_at > '${now()}') AND conversation_id IN (${ids.map(() => '?').join(',')}) ORDER BY conversation_id, created_at DESC`
    ).all(...ids);
    for (const m of lasts) lastByConv[m.conversation_id] = m;
  }
  rows = rows.map((r) => {
    const m = lastByConv[r.id];
    return { ...r, unread_count: Number(r.unread_count), last_message: m ? { content: m.deleted_at ? 'Message deleted' : String(m.content || (m.attachment_name ? `📎 ${m.attachment_name}` : '')).slice(0, 80), mine: m.sender_id === req.user.id, created_at: m.created_at } : null };
  });
  res.json({ conversations: rows });
}

/**
 * GET /api/conversations/monitor  (parent) — every child_tutor
 * conversation involving any of this parent's children, flagged
 * messages surfaced first. Read-only by design.
 */
async function monitor(req, res) {
  const conversations = (await db
    .prepare(
      `SELECT c.*, ch.full_name AS child_name, u.full_name AS tutor_name,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.flagged = 1) AS flagged_count,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       JOIN children ch ON ch.id = c.child_id
       JOIN users u ON u.id = c.tutor_id
       WHERE c.parent_id = ? AND c.kind = 'child_tutor'
       ORDER BY flagged_count DESC, c.updated_at DESC`
    )
    .all(req.user.id)).map((c) => ({ ...c, flagged_count: Number(c.flagged_count), message_count: Number(c.message_count) }));

  res.json({ conversations });
}

module.exports = { getOrCreate, listMessages, sendMessage, editMessage, deleteMessage, reactToMessage, updateSettings, exportChats, presence, purgeExpiredMessages, myConversations, monitor, markRead, unreadCount };
