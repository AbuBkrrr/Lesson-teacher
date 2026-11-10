import React from 'react';

/** Shared footer for paged admin tables: empty/loading state and Load more. */
export function ListFooter({ list, empty }) {
  if (list.rows === null && !list.error) return <div className="lt-empty">Loading…</div>;
  if (list.rows && list.rows.length === 0) return <div className="lt-empty">{empty}</div>;
  return (
    <div className="lt-row-between" style={{ marginTop: 12 }}>
      <span style={{ color: 'var(--lt-muted)' }}>Showing {list.rows ? list.rows.length : 0} of {list.total}</span>
      {list.hasMore && (
        <button type="button" className="lt-btn" onClick={list.loadMore} disabled={list.loadingMore}>
          {list.loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

export const selectStyle = { padding: 8, borderRadius: 8, border: '1px solid var(--lt-border)' };
export const money = (amount, currency) => `${currency || ''} ${Number(amount || 0).toLocaleString()}`.trim();
