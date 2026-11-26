import React, { useCallback, useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { notifications } from '../api/client';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { formatLesson } from '../utils/time';

const ICONS = {
  booking: '📅', payment: '💳', assignment: '📝', message: '💬',
  audition: '🎥', refund: '↩️', payout: '🏦', id: '🪪', lesson: '🎓', review: '⭐',
};
const iconFor = (type = '') => ICONS[Object.keys(ICONS).find((k) => type.startsWith(k))] || '🔔';
const changed = () => window.dispatchEvent(new Event('lt:notifications-changed'));

export default function Notifications() {
  const [items, setItems] = useState(null);
  const [meta, setMeta] = useState({ page: 1, page_size: 20, total: 0, unread_count: 0 });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback((page = 1, append = false) => {
    setError(null);
    return notifications.list(page, unreadOnly)
      .then((d) => {
        setItems((prev) => (append && prev ? [...prev, ...d.notifications] : d.notifications));
        setMeta({ page: d.page, page_size: d.page_size, total: d.total, unread_count: d.unread_count });
      })
      .catch((e) => setError(e.message));
  }, [unreadOnly]);

  useEffect(() => { load(1); }, [load]);
  useRefreshOnFocus(() => load(1));

  async function markRead(n) {
    if (n.read_at) return;
    setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
    setMeta((m) => ({ ...m, unread_count: Math.max(0, m.unread_count - 1) }));
    try { await notifications.markRead(n.id); changed(); } catch (e) { setError(e.message); load(1); }
  }
  async function markAll() {
    try { await notifications.markAllRead(); changed(); await load(1); } catch (e) { setError(e.message); }
  }

  const hasMore = items && items.length < meta.total;

  return (
    <Layout>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1>Notifications</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
          </label>
          <button type="button" className="lt-btn lt-btn--sm lt-btn--secondary" disabled={!meta.unread_count} onClick={markAll}>
            Mark all as read
          </button>
        </div>
      </div>
      {error && <div className="lt-error-banner" role="alert">{error}</div>}
      {items === null && !error && <p>Loading…</p>}
      {items && items.length === 0 && (
        <p>{unreadOnly ? 'No unread notifications.' : 'Nothing here yet. Booking updates, payments, assignments and messages will show up here.'}</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {(items || []).map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => markRead(n)}
              className="lt-card"
              style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 12, cursor: n.read_at ? 'default' : 'pointer', opacity: n.read_at ? 0.7 : 1, borderLeft: n.read_at ? undefined : '4px solid var(--lt-primary, #2563eb)' }}
              aria-label={`${n.read_at ? '' : 'Unread: '}${n.subject || 'Notification'}. ${n.body}`}
            >
              <span aria-hidden="true" style={{ fontSize: '1.4rem' }}>{iconFor(n.type)}</span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                <strong>{n.subject || 'Notification'}</strong>
                <span style={{ display: 'block' }}>{n.body}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--lt-muted)' }}>{formatLesson(n.created_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button type="button" className="lt-btn lt-btn--secondary" style={{ marginTop: 12 }} onClick={() => load(meta.page + 1, true)}>
          Load more
        </button>
      )}
    </Layout>
  );
}
