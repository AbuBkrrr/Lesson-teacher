import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import ChatThread, { dayLabel } from '../components/ChatThread';
import { conversations } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function Messages() {
  const { user } = useAuth();
  const location = useLocation();
  const [list, setList] = useState([]);
  const [activeId, setActiveId] = useState(location.state?.openConversationId || null);
  const [error, setError] = useState(null);

  useEffect(() => {
    conversations.mine().then((d) => {
      setList(d.conversations);
      if (!activeId && d.conversations.length > 0) setActiveId(d.conversations[0].id);
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function labelFor(c) {
    if (user?.role === 'tutor') return c.kind === 'parent_tutor' ? `${c.parent_name} (parent)` : `${c.child_name} (student)`;
    if (['parent','adult_student'].includes(user?.role)) return c.tutor_name;
    return c.tutor_name;
  }

  return (
    <Layout>
      <h1>Messages</h1>
      <p>{user?.role === 'tutor' ? 'Conversations with parents and students.' : 'Your conversations.'}</p>

      {error && <div className="lt-error-banner">{error}</div>}

      <div className="lt-messages-grid">
        <div className={`lt-card${activeId ? ' lt-messages-list--hide-mobile' : ''}`} style={{ padding: 8 }}>
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className="lt-nav-link"
              style={{ width: '100%', background: activeId === c.id ? 'var(--lt-bg)' : 'transparent', display: 'block', textAlign: 'left' }}
            >
              <span className="lt-conv-row">
                <strong className="lt-conv-name">{labelFor(c)}</strong>
                {c.last_message && <span className="lt-conv-time">{dayLabel(c.last_message.created_at) === 'Today' ? new Date(c.last_message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : dayLabel(c.last_message.created_at)}</span>}
              </span>
              <span className="lt-conv-row">
                <span className="lt-conv-preview">{c.last_message ? `${c.last_message.mine ? 'You: ' : ''}${c.last_message.content}` : 'No messages yet'}</span>
                {c.unread_count > 0 && activeId !== c.id && <span className="lt-conv-badge">{c.unread_count}</span>}
              </span>
            </button>
          ))}
          {list.length === 0 && <div className="lt-empty">
              {user?.role === 'child' ? 'No messages yet — your tutor will start a chat with you here.'
                : user?.role === 'tutor' ? 'No conversations yet. Students and parents will appear here once you have a booking.'
                  : 'No conversations yet. Use "Message" on a booking to start one with your tutor.'}
            </div>}
        </div>

        {activeId ? (
          <div>
            <button className="lt-btn lt-btn--ghost lt-btn--sm lt-messages-back-btn" onClick={() => setActiveId(null)}>
              ← Conversations
            </button>
            <ChatThread key={activeId} conversationId={activeId} otherPartyLabel="Them" />
          </div>
        ) : (
          <div className="lt-card lt-empty lt-messages-placeholder">Select a conversation.</div>
        )}
      </div>
    </Layout>
  );
}
