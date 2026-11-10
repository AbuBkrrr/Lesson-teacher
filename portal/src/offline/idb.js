// Tiny IndexedDB key-value store (no dependency). Every call degrades to a
// no-op/undefined when IndexedDB is unavailable (private mode, old webview).
const DB = 'lt-offline-v1';
const STORE = 'kv';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  })).catch(() => undefined);
}

export const idbGet = (key) => tx('readonly', (s) => s.get(key));
export const idbSet = (key, value) => tx('readwrite', (s) => s.put(value, key));
export const idbDel = (key) => tx('readwrite', (s) => s.delete(key));
export const idbClear = () => tx('readwrite', (s) => s.clear());

/** Deletes every key that starts with `prefix` (used to wipe cached API data on logout). */
export const idbClearPrefix = (prefix) => tx('readwrite', (s) => {
  const req = s.openKeyCursor();
  req.onsuccess = () => {
    const c = req.result;
    if (!c) return;
    if (String(c.key).startsWith(prefix)) s.delete(c.key);
    c.continue();
  };
  return req;
});
