import React, { useEffect, useRef, useState } from 'react';
import { conversations, assetUrl } from '../api/client';
import { getSocket } from '../realtime/socket';
import { useAuth } from '../contexts/AuthContext';
import { enqueueMessage, outboxFor, discardMessage, retryMessage } from '../offline/outbox';

export function dayLabel(iso) {
  const d = new Date(iso); const t = new Date();
  if (d.toDateString() === t.toDateString()) return 'Today';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const DISAPPEAR = [[0, 'Off'], [3600, '1 hour'], [86400, '24 hours'], [604800, '7 days']];
const withinEditWindow = (m) => Date.now() - Date.parse(m.created_at) < 15 * 60 * 1000;
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function lastSeenText(p) {
  if (!p) return ' ';
  if (p.online) return 'online';
  if (!p.last_seen_at) return ' ';
  const d = new Date(p.last_seen_at);
  return `last seen ${dayLabel(p.last_seen_at).toLowerCase()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function Attachment({ m }) {
  if (!m.attachment_url) return null;
  const url = assetUrl(m.attachment_url);
  if ((m.attachment_type || '').startsWith('image/')) {
    return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.attachment_name} style={{ maxWidth: 240, maxHeight: 240, borderRadius: 10, display: 'block', marginBottom: m.content ? 6 : 0 }} /></a>;
  }
  if ((m.attachment_type || '').startsWith('audio/')) {
    return <audio controls src={url} style={{ maxWidth: 240, display: 'block', marginBottom: m.content ? 6 : 0 }} />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit', display: 'block', marginBottom: m.content ? 6 : 0 }}>
      {'📎'} {m.attachment_name} <small>({fmtSize(m.attachment_size || 0)})</small>
    </a>
  );
}

export default function ChatThread({ conversationId, otherPartyLabel = 'Them' }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [otherReadAt, setOtherReadAt] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState([]); // queued on this device, not yet on the server
  const [typingUser, setTypingUser] = useState(false);
  const [editing, setEditing] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [presence, setPresence] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [, setClock] = useState(0); // ticks so disappearing messages vanish live
  const [uploading, setUploading] = useState(false);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(0);
  const lastTs = useRef(null);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const merge = (incoming) => setMessages((prev) => {
      const byId = new Map(incoming.map((m) => [m.id, m]));
      const updated = prev.map((m) => byId.get(m.id) || m); // edits/deletes/reactions replace in place
      const seen = new Set(prev.map((m) => m.id));
      const add = incoming.filter((m) => !seen.has(m.id));
      return add.length ? [...updated, ...add] : updated;
    });
    const track = (list) => { const last = list[list.length - 1]; if (last) lastTs.current = last.created_at; };

    conversations.messages(conversationId).then((d) => {
      if (cancelled) return;
      setMessages(d.messages);
      track(d.messages);
      setConversation(d.conversation);
      setOtherReadAt(d.other_read_at);
    }).catch((e) => setError(e.message));
    outboxFor(conversationId).then((p) => { if (!cancelled) setPending(p); });

    const socket = getSocket();
    socket.emit('join_conversation', conversationId);
    const onNewMessage = (msg) => {
      if (msg.conversation_id !== conversationId) return;
      merge([msg]);
      track([msg]);
      if (msg.client_id) setPending((p) => p.filter((x) => x.client_id !== msg.client_id));
    };
    const onRead = (e) => { if (e.conversation_id === conversationId && e.user_id !== user?.id) setOtherReadAt(e.read_at); };
    const onReconnect = () => {
      socket.emit('join_conversation', conversationId);
      if (lastTs.current) conversations.messagesAfter(conversationId, lastTs.current).then((d) => { if (!cancelled) { merge(d.messages); track(d.messages); setOtherReadAt(d.other_read_at); } }).catch(() => {});
    };
    const onSent = (e) => {
      const m = e.detail.message;
      if (m && m.conversation_id === conversationId) { merge([m]); track([m]); }
      setPending((p) => p.filter((x) => x.client_id !== e.detail.client_id));
    };
    const onFailed = (e) => setPending((p) => p.map((x) => (x.client_id === e.detail.client_id ? { ...x, error: e.detail.error } : x)));
    const onTyping = (e) => {
      if (e.conversation_id !== conversationId || e.user_id === user?.id) return;
      setTypingUser(!!e.typing);
      clearTimeout(typingTimer.current);
      if (e.typing) typingTimer.current = setTimeout(() => setTypingUser(false), 4000);
    };
    const onUpdated = (m) => { if (m.conversation_id === conversationId) merge([m]); };
    const onSettings = (e) => { if (e.conversation_id === conversationId) setConversation((c) => (c ? { ...c, disappear_after_seconds: e.disappear_after_seconds } : c)); };
    socket.on('message_updated', onUpdated);
    socket.on('conversation_settings', onSettings);
    socket.on('typing', onTyping);
    socket.on('new_message', onNewMessage);
    socket.on('conversation_read', onRead);
    socket.io.on('reconnect', onReconnect);
    window.addEventListener('lt:outbox-sent', onSent);
    window.addEventListener('lt:outbox-failed', onFailed);

    const loadPresence = () => conversations.presence(conversationId).then((p) => { if (!cancelled) setPresence(p); }).catch(() => {});
    loadPresence();
    const presenceTimer = setInterval(loadPresence, 30000);
    const clockTimer = setInterval(() => setClock((c) => c + 1), 30000);

    return () => {
      cancelled = true;
      clearInterval(presenceTimer);
      clearInterval(clockTimer);
      socket.emit('leave_conversation', conversationId);
      socket.off('message_updated', onUpdated);
      socket.off('conversation_settings', onSettings);
      socket.off('typing', onTyping);
      clearTimeout(typingTimer.current);
      socket.off('new_message', onNewMessage);
      socket.off('conversation_read', onRead);
      socket.io.off('reconnect', onReconnect);
      window.removeEventListener('lt:outbox-sent', onSent);
      window.removeEventListener('lt:outbox-failed', onFailed);
    };
  }, [conversationId, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, pending.length]);

  const canSend = conversation
    ? conversation.kind === 'parent_tutor'
      ? ['parent', 'tutor', 'adult_student'].includes(user?.role)
      : ['child', 'tutor'].includes(user?.role) // child_tutor: parent is always read-only
    : false;

  // Messages whose disappear timer has passed drop out of view even before the server purges them.
  const visible = messages.filter((m) => !m.expires_at || Date.parse(m.expires_at) > Date.now());

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (editing) {
      try {
        const r = await conversations.editMessage(conversationId, editing.id, text);
        setMessages((prev) => prev.map((m) => (m.id === r.message.id ? r.message : m)));
        setEditing(null); setDraft('');
      } catch (err) { setError(err.message); }
      return;
    }
    setDraft('');
    setError(null);
    getSocket().emit('typing', { conversationId, typing: false });
    lastTypingSent.current = 0;
    const m = await enqueueMessage(conversationId, text, replyTo?.id || null);
    setReplyTo(null);
    setPending((p) => [...p, m]);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const r = await conversations.sendAttachment(conversationId, file, draft.trim(), replyTo?.id || null);
      setMessages((prev) => (prev.some((m) => m.id === r.message.id) ? prev : [...prev, r.message]));
      setDraft(''); setReplyTo(null);
    } catch (err) { setError(err.message); }
    setUploading(false);
  }

  async function handleDelete(m) {
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      const r = await conversations.deleteMessage(conversationId, m.id);
      setMessages((prev) => prev.map((x) => (x.id === r.message.id ? r.message : x)));
    } catch (err) { setError(err.message); }
  }

  async function react(m, emoji) {
    setMenuFor(null);
    const mine = m.reactions?.find((r) => r.user_id === user?.id);
    try {
      const r = await conversations.react(conversationId, m.id, mine?.emoji === emoji ? null : emoji);
      setMessages((prev) => prev.map((x) => (x.id === r.message.id ? r.message : x)));
    } catch (err) { setError(err.message); }
  }

  async function changeDisappear(secs) {
    try {
      const r = await conversations.setDisappear(conversationId, secs);
      setConversation(r.conversation);
    } catch (err) { setError(err.message); }
  }

  function reactionSummary(m) {
    const counts = {};
    (m.reactions || []).forEach((r) => { counts[r.emoji] = (counts[r.emoji] || 0) + 1; });
    return Object.entries(counts);
  }

  return (
    <div className="lt-card lt-chat-thread">
      {error && <div className="lt-error-banner">{error}</div>}
      <div className="lt-chat-status" aria-live="polite" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{typingUser ? `${otherPartyLabel} is typing…` : lastSeenText(presence)}</span>
        {canSend && conversation?.kind === 'parent_tutor' && (
          <label style={{ fontSize: '0.75rem', color: 'var(--lt-muted)' }}>
            {'⏳'} Disappearing{' '}
            <select aria-label="Disappearing messages" value={conversation.disappear_after_seconds || 0} onChange={(e) => changeDisappear(Number(e.target.value))}>
              {DISAPPEAR.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4 }}>
        {visible.map((m, i) => {
          const mine = m.sender_id === user?.id;
          const seen = mine && otherReadAt && otherReadAt >= m.created_at;
          const day = new Date(m.created_at).toDateString();
          const newDay = i === 0 || day !== new Date(visible[i - 1].created_at).toDateString();
          const reacts = reactionSummary(m);
          return (
            <React.Fragment key={m.id}>
              {newDay && <div className="lt-day-sep">{dayLabel(m.created_at)}</div>}
              <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                <div
                  style={{
                    background: mine ? 'var(--lt-primary)' : 'var(--lt-bg)',
                    color: mine ? '#fff' : 'var(--lt-ink)',
                    borderRadius: 14,
                    padding: '8px 14px',
                    border: m.flagged ? '2px solid var(--lt-danger-fg)' : 'none',
                  }}
                >
                  {m.reply_to && !m.deleted && (
                    <div style={{ borderLeft: '3px solid rgba(127,127,127,.6)', paddingLeft: 8, marginBottom: 6, fontSize: '0.8rem', opacity: 0.85 }}>
                      {m.reply_to.deleted ? 'Deleted message' : m.reply_to.content}
                    </div>
                  )}
                  {m.deleted
                    ? <em style={{ opacity: 0.7 }}>{mine ? 'You deleted this message' : 'This message was deleted'}</em>
                    : <><Attachment m={m} />{m.content}</>}
                </div>
                {reacts.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 2, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    {reacts.map(([emoji, n]) => (
                      <span key={emoji} aria-label={`${n} ${emoji}`} style={{ background: 'var(--lt-bg)', border: '1px solid var(--lt-border)', borderRadius: 999, padding: '0 6px', fontSize: '0.75rem' }}>{emoji}{n > 1 ? ` ${n}` : ''}</span>
                    ))}
                  </div>
                )}
                {m.flagged === 1 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--lt-danger-fg)', fontWeight: 700, marginTop: 2 }}>
                    ⚠ Flagged: {m.flag_reason}
                  </div>
                )}
                <div style={{ fontSize: '0.7rem', color: 'var(--lt-muted)', marginTop: 2 }}>
                  {m.edited && !m.deleted ? 'edited · ' : ''}{mine ? 'You' : otherPartyLabel} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {mine && <span aria-label={seen ? 'Seen' : 'Sent'} style={{ marginLeft: 4, color: seen ? 'var(--lt-primary)' : 'inherit', fontWeight: 700 }}>{seen ? '✓✓' : '✓'}</span>}
                  {canSend && !m.deleted && (
                    <span style={{ marginLeft: 8 }}>
                      <button type="button" className="lt-link" onClick={() => { setReplyTo(m); setEditing(null); }}>Reply</button>
                      {' · '}
                      <button type="button" className="lt-link" aria-label="React" onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}>{'🙂'}</button>
                      {mine && withinEditWindow(m) && !m.attachment_url && <> · <button type="button" className="lt-link" onClick={() => { setEditing(m); setReplyTo(null); setDraft(m.content); }}>Edit</button></>}
                      {mine && <> · <button type="button" className="lt-link" onClick={() => handleDelete(m)}>Delete</button></>}
                    </span>
                  )}
                </div>
                {menuFor === m.id && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    {EMOJIS.map((e) => <button key={e} type="button" className="lt-link" style={{ fontSize: '1.1rem' }} onClick={() => react(m, e)}>{e}</button>)}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
        {pending.map((m) => (
          <div key={m.client_id} style={{ alignSelf: 'flex-end', maxWidth: '75%', opacity: m.error ? 1 : 0.75 }}>
            <div style={{ background: 'var(--lt-primary)', color: '#fff', borderRadius: 14, padding: '8px 14px' }}>{m.content}</div>
            <div style={{ fontSize: '0.7rem', color: m.error ? 'var(--lt-danger-fg)' : 'var(--lt-muted)', marginTop: 2 }}>
              {m.error ? (
                <>Not sent: {m.error} · <button type="button" className="lt-link" onClick={() => { retryMessage(m.client_id); setPending((p) => p.map((x) => (x.client_id === m.client_id ? { ...x, error: null } : x))); }}>Retry</button> · <button type="button" className="lt-link" onClick={() => { discardMessage(m.client_id); setPending((p) => p.filter((x) => x.client_id !== m.client_id)); }}>Delete</button></>
              ) : (
                <><span aria-hidden="true">{'⏱'}</span> Waiting to send…</>
              )}
            </div>
          </div>
        ))}
        {visible.length === 0 && pending.length === 0 && <div className="lt-empty">No messages yet.</div>}
        <div ref={bottomRef} />
      </div>

      {conversation?.disappear_after_seconds ? (
        <div className="lt-helper-text" style={{ fontSize: '0.75rem', marginTop: 8 }}>{'⏳'} New messages disappear after {DISAPPEAR.find(([v]) => v === conversation.disappear_after_seconds)?.[1] || 'a while'}.</div>
      ) : null}

      {!canSend ? (
        <p className="lt-helper-text" style={{ marginTop: 12, marginBottom: 0, fontSize: '0.8rem' }}>
          You're viewing this conversation as a parent — read-only by design.
        </p>
      ) : (
        <>
          {replyTo && (
            <div className="lt-helper-text" style={{ fontSize: '0.75rem', marginTop: 8 }}>
              Replying to “{(replyTo.content || replyTo.attachment_name || 'attachment').slice(0, 60)}” · <button type="button" className="lt-link" onClick={() => setReplyTo(null)}>Cancel</button>
            </div>
          )}
          <form onSubmit={handleSend} className="lt-row" style={{ marginTop: 12 }}>
            {editing && <span className="lt-helper-text" style={{ fontSize: '0.75rem' }}>Editing · <button type="button" className="lt-link" onClick={() => { setEditing(null); setDraft(''); }}>Cancel</button></span>}
            <input ref={fileRef} type="file" hidden onChange={handleFile} accept="image/*,audio/*,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx" />
            <button type="button" className="lt-btn lt-btn--ghost lt-btn--sm" aria-label="Attach a file" disabled={uploading || !!editing} onClick={() => fileRef.current?.click()}>{uploading ? '…' : '📎'}</button>
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const now = Date.now();
                if (now - lastTypingSent.current > 2500) { lastTypingSent.current = now; getSocket().emit('typing', { conversationId, typing: true }); }
              }}
              placeholder="Type a message…"
              style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid var(--lt-border)' }}
            />
            <button className="lt-btn lt-btn--sm" type="submit" disabled={!draft.trim()}>Send</button>
          </form>
        </>
      )}
    </div>
  );
}
