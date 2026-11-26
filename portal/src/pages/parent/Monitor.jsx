import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import ChatThread from '../../components/ChatThread';
import { conversations } from '../../api/client';

export default function Monitor() {
  const [list, setList] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    conversations.monitor().then((d) => {
      setList(d.conversations);
      if (d.conversations.length > 0) setActiveId(d.conversations[0].id);
    }).catch((e) => setError(e.message));
  }, []);

  return (
    <Layout>
      <h1>Monitor</h1>
      <p>Every conversation between your children and their tutors. You can read everything here — this is automatic, not something you have to remember to check.</p>

      {error && <div className="lt-error-banner">{error}</div>}

      <div className="lt-monitor-grid">
        <div className="lt-card" style={{ padding: 8 }}>
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className="lt-nav-link"
              style={{ width: '100%', background: activeId === c.id ? 'var(--lt-bg)' : 'transparent', display: 'flex', justifyContent: 'space-between' }}
            >
              <span>{c.child_name} ↔ {c.tutor_name}</span>
              {c.flagged_count > 0 && <span className="lt-badge lt-badge--danger">{c.flagged_count} flagged</span>}
            </button>
          ))}
          {list.length === 0 && <div className="lt-empty">No conversations to monitor yet.</div>}
        </div>

        {activeId ? (
          <ChatThread key={activeId} conversationId={activeId} otherPartyLabel="Tutor / student" />
        ) : (
          <div className="lt-card lt-empty">Select a conversation.</div>
        )}
      </div>
    </Layout>
  );
}
