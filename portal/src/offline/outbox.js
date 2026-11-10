import { idbGet, idbSet } from './idb';

// Chat outbox: messages typed while offline (or while the network drops mid-send)
// are queued on the device and delivered in order once the connection returns.
// Each carries a client_id so a retry after an ambiguous failure is stored once.
const KEY = 'outbox:messages';
let items = null;
let flushing = false;
let sender = null; // (conversationId, content, clientId) => Promise<{message}>, injected to avoid an import cycle

const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

async function load() {
  if (items === null) items = (await idbGet(KEY)) || [];
  return items;
}
async function save() { await idbSet(KEY, items); emit('lt:outbox-changed', { count: items.length }); }

export function setOutboxSender(fn) { sender = fn; }
export async function outboxFor(conversationId) { return (await load()).filter((m) => m.conversation_id === conversationId); }
export async function outboxCount() { return (await load()).length; }

export async function enqueueMessage(conversationId, content, replyToId = null) {
  await load();
  const m = { client_id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, conversation_id: conversationId, content, reply_to_id: replyToId, created_at: new Date().toISOString(), error: null };
  items.push(m);
  await save();
  flushOutbox();
  return m;
}

export async function discardMessage(clientId) {
  await load();
  items = items.filter((m) => m.client_id !== clientId);
  await save();
}

/** Sends queued messages oldest-first. A network failure stops the run (retry later); a server rejection marks that message failed and moves on. */
export async function flushOutbox() {
  if (flushing || !sender) return;
  flushing = true;
  try {
    await load();
    for (const m of [...items]) {
      if (m.error) continue;
      try {
        const res = await sender(m.conversation_id, m.content, m.client_id, m.reply_to_id);
        items = items.filter((x) => x.client_id !== m.client_id);
        await save();
        emit('lt:outbox-sent', { client_id: m.client_id, message: res.message });
      } catch (err) {
        if (err.status === 0 || err.status >= 500) break; // offline / server hiccup: keep and retry
        m.error = err.message || 'Could not send';
        await save();
        emit('lt:outbox-failed', { client_id: m.client_id, error: m.error });
      }
    }
  } finally {
    flushing = false;
  }
}

export function startOutboxWorker() {
  const run = () => { if (navigator.onLine !== false) flushOutbox(); };
  window.addEventListener('online', run);
  const t = setInterval(run, 15000);
  run();
  return () => { window.removeEventListener('online', run); clearInterval(t); };
}

export async function retryMessage(clientId) {
  await load();
  const m = items.find((x) => x.client_id === clientId);
  if (m) { m.error = null; await save(); flushOutbox(); }
}
