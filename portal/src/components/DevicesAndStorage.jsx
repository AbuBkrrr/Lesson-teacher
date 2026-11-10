import React, { useCallback, useEffect, useState } from 'react';
import { deviceLink, conversations } from '../api/client';
import { idbClearPrefix } from '../offline/idb';

function download(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const fmt = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);

/** Linked devices, chat backup and local storage manager (Account page). */
export default function DevicesAndStorage() {
  const [devices, setDevices] = useState([]);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [usage, setUsage] = useState(null);

  const loadDevices = useCallback(() => {
    deviceLink.devices().then((d) => setDevices(d.devices)).catch((e) => setErr(e.message));
  }, []);
  const loadUsage = useCallback(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage || 0)).catch(() => {});
  }, []);
  useEffect(() => { loadDevices(); loadUsage(); }, [loadDevices, loadUsage]);

  async function approve(e) {
    e.preventDefault(); setErr(null); setMsg(null);
    try { const r = await deviceLink.approve(code); setMsg(`Linked ${r.label || 'device'}.`); setCode(''); loadDevices(); } catch (x) { setErr(x.message); }
  }
  async function revoke(d) {
    if (!window.confirm(`Sign out ${d.label}?`)) return;
    try { await deviceLink.revoke(d.id); loadDevices(); } catch (x) { setErr(x.message); }
  }
  async function backup() {
    setErr(null);
    try { download(`lesson-teacher-chats-${new Date().toISOString().slice(0, 10)}.json`, await conversations.exportChats()); setMsg('Chat backup downloaded.'); } catch (x) { setErr(x.message); }
  }
  async function clearLocal() {
    if (!window.confirm('Clear offline data on this device? Unsent messages will be lost; everything else re-downloads when you are online.')) return;
    await idbClearPrefix('cache:');
    await idbClearPrefix('outbox:');
    setMsg('Offline data cleared.'); loadUsage();
  }

  return (
    <div className="lt-card" style={{ marginTop: 16 }}>
      <h2>Linked devices</h2>
      <p className="lt-helper-text">Signed in on these devices. To sign in a new device, choose “Sign in with a code” on its login screen and enter the code here.</p>
      {err && <div className="lt-error-banner">{err}</div>}
      {msg && <div className="lt-success-banner">{msg}</div>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {devices.map((d) => (
          <li key={d.id} className="lt-row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
            <span>{d.label}{d.current ? ' (this device)' : ''} <small className="lt-helper-text">· last active {new Date(d.last_used_at || d.created_at).toLocaleString()}</small></span>
            {!d.current && <button className="lt-btn lt-btn--ghost lt-btn--sm" onClick={() => revoke(d)}>Sign out</button>}
          </li>
        ))}
      </ul>
      <form onSubmit={approve} className="lt-row">
        <input aria-label="Device code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code from the new device" maxLength={8} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--lt-border)' }} />
        <button className="lt-btn lt-btn--sm" type="submit" disabled={code.length < 8}>Link device</button>
      </form>

      <h2 style={{ marginTop: 24 }}>Chat backup &amp; storage</h2>
      <p className="lt-helper-text">Your messages live on our servers and re-sync to any device you sign in on. You can also keep your own copy.</p>
      <div className="lt-row">
        <button className="lt-btn lt-btn--sm" onClick={backup}>Download chat backup</button>
        <button className="lt-btn lt-btn--ghost lt-btn--sm" onClick={clearLocal}>Clear offline data{usage != null ? ` (${fmt(usage)})` : ''}</button>
      </div>
    </div>
  );
}
