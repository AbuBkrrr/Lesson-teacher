import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

// Offline support for the mobile app (mirrors the web client's design):
//  - GET responses are cached per user, so screens open offline with the last data;
//  - chat messages go through a persisted outbox and are delivered in order, once,
//    when the network returns (client_id makes retries idempotent on the server).

const listeners = new Set();
export function onOfflineEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (type, detail = {}) => listeners.forEach((fn) => fn({ type, ...detail }));

// ---- read cache ----
const CACHE = 'ltm_cache:';
export async function cacheSet(key, data) {
  try { await AsyncStorage.setItem(CACHE + key, JSON.stringify({ data, at: Date.now() })); } catch { /* storage full: ignore */ }
}
export async function cacheGet(key) {
  try { const raw = await AsyncStorage.getItem(CACHE + key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export async function clearCache() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(CACHE)));
  } catch { /* ignore */ }
}
export const reportNetwork = (ok) => emit('network', { ok });
export const reportStale = () => emit('stale');

// ---- chat outbox ----
const OUTBOX = 'ltm_outbox_messages';
let items = null;
let flushing = false;
let sender = null;

async function load() {
  if (items === null) {
    try { items = JSON.parse((await AsyncStorage.getItem(OUTBOX)) || '[]'); } catch { items = []; }
  }
  return items;
}
async function save() {
  try { await AsyncStorage.setItem(OUTBOX, JSON.stringify(items)); } catch { /* ignore */ }
  emit('outbox', { count: items.length });
}

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

export async function retryMessage(clientId) {
  await load();
  const m = items.find((x) => x.client_id === clientId);
  if (m) { m.error = null; await save(); flushOutbox(); }
}

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
        emit('sent', { client_id: m.client_id, message: res.message });
      } catch (err) {
        if (err.status === 0 || err.status >= 500) break;
        m.error = err.message || 'Could not send';
        await save();
        emit('failed', { client_id: m.client_id, error: m.error });
      }
    }
  } finally {
    flushing = false;
  }
}

/** Retry when the app returns to the foreground and every 15s while it is open. */
export function startOutboxWorker() {
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') flushOutbox(); });
  const t = setInterval(flushOutbox, 15000);
  flushOutbox();
  return () => { sub.remove(); clearInterval(t); };
}
