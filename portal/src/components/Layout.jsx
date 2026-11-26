import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { startOutboxWorker, outboxCount } from '../offline/outbox';
import { resendVerification, conversations, notifications, isImpersonating, stopImpersonation } from '../api/client';

const MESSAGING_ROLES = ['tutor', 'parent', 'adult_student', 'child'];
const UNREAD_POLL_MS = 20000;

const NAV_BY_ROLE = {
  super_admin: [
    { to: '/superadmin', label: 'Dashboard', icon: '\u2302' },
    { to: '/superadmin/users', label: 'Users', icon: '\u{1F464}' },
    { to: '/superadmin/tutors', label: 'Tutors', icon: '\u{1F393}' },
    { to: '/superadmin/schools', label: 'Schools', icon: '\u{1F3EB}' },
    { to: '/superadmin/bookings', label: 'Bookings', icon: '\u{1F4C5}' },
    { to: '/superadmin/payments', label: 'Payments', icon: '\u{1F9FE}' },
    { to: '/superadmin/refunds', label: 'Refund requests', icon: '\u21A9\uFE0F' },
    { to: '/superadmin/skills', label: 'Skill catalog', icon: '\u2728' },
    { to: '/curriculum', label: 'Curriculum', icon: '\u{1F4DA}' },
    { to: '/superadmin/payouts', label: 'Payouts', icon: '\u{1F4B8}' },
    { to: '/superadmin/referrals', label: 'Referrals', icon: '\u{1F517}' },
    { to: '/superadmin/announcements', label: 'Announcements', icon: '\u{1F4E2}' },
    { to: '/superadmin/settings', label: 'Settings', icon: '\u2699\uFE0F' },
    { to: '/subscriptions', label: 'Subscription plans', icon: '\u{1F4B3}' },
    { to: '/superadmin/verifications', label: 'ID verifications', icon: '\u{1F6E1}\uFE0F' },
    { to: '/superadmin/marketing', label: 'Marketing', icon: '\u{1F4E3}' },
    { to: '/superadmin/audit-log', label: 'Audit log', icon: '\u{1F4D2}' },
  ],
  school_admin: [
    { to: '/school', label: 'School profile', icon: '\u{1F3EB}' },
    { to: '/school/students', label: 'Students', icon: '\u{1F9D2}' },
    { to: '/curriculum', label: 'Curriculum', icon: '\u{1F4DA}' },
    { to: '/school/referrals', label: 'Referrals', icon: '\u{1F517}' },
    { to: '/subscriptions', label: 'Subscription', icon: '\u{1F4B3}' },
  ],
  tutor: [
    { to: '/tutor', label: 'My profile', icon: '\u{1F464}' },
    { to: '/tutor/skills', label: 'My skills', icon: '\u2728' },
    { to: '/tutor/availability', label: 'My availability', icon: '\u{1F4C6}' },
    { to: '/tutor/bookings', label: 'Bookings', icon: '\u{1F4C5}' },
    { to: '/tutor/auditions', label: 'Auditions', icon: '\u{1F3AC}' },
    { to: '/tutor/materials', label: 'Materials', icon: '\u{1F4C1}' },
    { to: '/tutor/assignments', label: 'Assignments', icon: '\u{1F4DD}' },
    { to: '/curriculum', label: 'Curriculum', icon: '\u{1F4DA}' },
    { to: '/tutor/requests', label: 'Browse requests', icon: '\u{1F4E3}' },
    { to: '/messages', label: 'Messages', icon: '\u{1F4AC}' },
    { to: '/tutor/earnings', label: 'Earnings', icon: '\u{1F4B0}' },
    { to: '/tutor/referrals', label: 'Referrals', icon: '\u{1F517}' },
    { to: '/verification', label: 'ID verification', icon: '\u{1F6E1}\uFE0F' },
  ],
  parent: [
    { to: '/parent', label: 'Home', icon: '\u{1F3E0}' },
    { to: '/parent/discover', label: 'Discover tutors', icon: '\u{1F50D}' },
    { to: '/parent/browse', label: 'Browse all', icon: '\u{1F4CB}' },
    { to: '/parent/saved', label: 'Saved tutors', icon: '★' },
    { to: '/parent/children', label: 'My children', icon: '\u{1F9D2}' },
    { to: '/parent/progress', label: 'Progress', icon: '\u{1F4C8}' },
    { to: '/parent/bookings', label: 'Bookings', icon: '\u{1F4C5}' },
    { to: '/parent/auditions', label: 'Auditions', icon: '\u{1F3AC}' },
    { to: '/parent/requests', label: 'Post a search', icon: '\u{1F4E3}' },
    { to: '/assignments', label: 'Assignments', icon: '\u{1F4DD}' },
    { to: '/materials', label: 'Materials', icon: '\u{1F4C1}' },
    { to: '/messages', label: 'Messages', icon: '\u{1F4AC}' },
    { to: '/parent/monitor', label: 'Monitor', icon: '\u{1F441}\uFE0F' },
    { to: '/parent/referrals', label: 'Referrals', icon: '\u{1F517}' },
    { to: '/subscriptions', label: 'Subscription', icon: '\u{1F4B3}' },
    { to: '/verification', label: 'ID verification', icon: '\u{1F6E1}\uFE0F' },
  ],
  adult_student: [
    { to: '/parent', label: 'Home', icon: '\u{1F3E0}' },
    { to: '/parent/discover', label: 'Discover tutors', icon: '\u{1F50D}' },
    { to: '/parent/browse', label: 'Browse all', icon: '\u{1F4CB}' },
    { to: '/parent/saved', label: 'Saved tutors', icon: '★' },
    { to: '/parent/bookings', label: 'Bookings', icon: '\u{1F4C5}' },
    { to: '/parent/requests', label: 'Post a search', icon: '\u{1F4E3}' },
    { to: '/assignments', label: 'Assignments', icon: '\u{1F4DD}' },
    { to: '/materials', label: 'Materials', icon: '\u{1F4C1}' },
    { to: '/messages', label: 'Messages', icon: '\u{1F4AC}' },
    { to: '/subscriptions', label: 'Subscription', icon: '\u{1F4B3}' },
    { to: '/verification', label: 'ID verification', icon: '\u{1F6E1}\uFE0F' },
  ],
  child: [
    { to: '/assignments', label: 'Assignments', icon: '\u{1F4DD}' },
    { to: '/materials', label: 'Materials', icon: '\u{1F4C1}' },
    { to: '/curriculum', label: 'Curriculum', icon: '\u{1F4DA}' },
    { to: '/my-progress', label: 'My progress', icon: '\u{1F4C8}' },
    { to: '/my-badges', label: 'Badges & rank', icon: '\u{1F3C5}' },
    { to: '/messages', label: 'Messages', icon: '\u{1F4AC}' },
  ],
};

const ROLE_LABEL = {
  super_admin: 'Super Admin',
  school_admin: 'School Portal',
  tutor: 'Tutor Portal',
  parent: 'Parent Portal',
  adult_student: 'My Learning Portal',
  child: 'My Learning',
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const nav = NAV_BY_ROLE[user?.role] || [];
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [verifyBannerState, setVerifyBannerState] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'dismissed'

  const showVerifyBanner = user?.email && user?.role !== 'super_admin' && !user?.email_verified_at && verifyBannerState !== 'dismissed';

  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!MESSAGING_ROLES.includes(user?.role)) return;
    let cancelled = false;
    const poll = () => conversations.unreadCount().then((d) => { if (!cancelled) setUnreadCount(d.unread); }).catch(() => {});
    poll();
    const interval = setInterval(poll, UNREAD_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.role]);

  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [stale, setStale] = useState(false);
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    const up = () => { setOnline(true); setStale(false); };
    const down = () => setOnline(false);
    const onStale = () => setStale(true);
    const onQ = (e) => setQueued(e.detail.count);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    window.addEventListener('lt:serving-cached', onStale);
    window.addEventListener('lt:outbox-changed', onQ);
    outboxCount().then(setQueued);
    const stop = startOutboxWorker();
    return () => {
      window.removeEventListener('online', up); window.removeEventListener('offline', down);
      window.removeEventListener('lt:serving-cached', onStale); window.removeEventListener('lt:outbox-changed', onQ); stop();
    };
  }, []);

  const [notifUnread, setNotifUnread] = useState(0);
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    const poll = () => {
      if (document.visibilityState === 'hidden') return;
      notifications.unreadCount().then((d) => { if (!cancelled) setNotifUnread(d.unread_count); }).catch(() => {});
    };
    poll();
    const interval = setInterval(poll, UNREAD_POLL_MS);
    const onRead = () => poll();
    window.addEventListener('lt:notifications-changed', onRead);
    document.addEventListener('visibilitychange', poll);
    return () => { cancelled = true; clearInterval(interval); window.removeEventListener('lt:notifications-changed', onRead); document.removeEventListener('visibilitychange', poll); };
  }, [user?.id]);

  async function handleResendVerification() {
    setVerifyBannerState('sending');
    try {
      await resendVerification();
      setVerifyBannerState('sent');
    } catch {
      setVerifyBannerState('idle');
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function closeMobileNav() {
    setMobileNavOpen(false);
  }

  return (
    <div className="lt-shell">
      <div className="lt-mobile-topbar">
        <button
          className="lt-mobile-menu-btn"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileNavOpen ? '\u2715' : '\u2630'}
        </button>
        <span className="lt-mobile-topbar-brand">Lesson Teacher</span>
      </div>

      {mobileNavOpen && <div className="lt-sidebar-backdrop" onClick={closeMobileNav} />}

      <aside className={`lt-sidebar${mobileNavOpen ? ' lt-sidebar--open' : ''}`}>
        <div className="lt-sidebar-brand">Lesson Teacher</div>
        <div className="lt-sidebar-role">{ROLE_LABEL[user?.role] || 'Portal'}</div>

        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={['/superadmin', '/school', '/tutor', '/parent'].includes(item.to)}
            className={({ isActive }) => `lt-nav-link${isActive ? ' active' : ''}`}
            onClick={closeMobileNav}
          >
            <span>{item.icon}</span> {item.label}
            {item.to === '/messages' && unreadCount > 0 && (
              <span
                style={{
                  marginLeft: 'auto', background: 'var(--lt-danger-fg, #d33)', color: '#fff',
                  borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, padding: '1px 7px', lineHeight: '16px',
                }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}

        <NavLink to="/notifications" className={({ isActive }) => `lt-nav-link${isActive ? ' active' : ''}`} onClick={closeMobileNav}>
          <span>{'\uD83D\uDD14'}</span> Notifications
          {notifUnread > 0 && (
            <span
              aria-label={`${notifUnread} unread`}
              style={{ marginLeft: 'auto', background: 'var(--lt-danger-fg, #d33)', color: '#fff', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, padding: '1px 7px', lineHeight: '16px' }}
            >
              {notifUnread > 99 ? '99+' : notifUnread}
            </span>
          )}
        </NavLink>

        <div className="lt-nav-spacer" />

        <div style={{ padding: '0 12px 8px 12px', fontSize: '0.85rem', color: 'var(--lt-muted)' }}>
          {user?.full_name}
        </div>
        <NavLink to="/account" className={({ isActive }) => `lt-nav-link${isActive ? ' active' : ''}`} onClick={closeMobileNav}>
          <span>{'\u2699\uFE0F'}</span> Account
        </NavLink>
        <button className="lt-nav-link" onClick={handleLogout}>
          <span>{'\u21AA'}</span> Log out
        </button>
      </aside>
      <main className="lt-main">
        {(!online || stale || queued > 0) && (
          <div role="status" className="lt-error-banner" style={{ background: '#eef2ff', borderColor: '#c7d2fe', color: '#312e81' }}>
            {!online || stale ? "You're offline. Showing saved information, which may be out of date." : 'Reconnected.'}
            {queued > 0 && ` ${queued} message${queued === 1 ? '' : 's'} will send when you're back online.`}
          </div>
        )}
        {isImpersonating() && (
          <div className="lt-error-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>Admin view: you are signed in as {user?.full_name} ({user?.role}). Actions you take are real.</span>
            <button className="lt-btn lt-btn--sm" onClick={() => { stopImpersonation(); window.location.hash = '#/superadmin/users'; window.location.reload(); }}>
              Exit view
            </button>
          </div>
        )}
        {showVerifyBanner && (
          <div className="lt-error-banner" style={{ background: '#fff8e1', borderColor: '#f0c674', color: '#6b5300', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span>
              {verifyBannerState === 'sent'
                ? "Verification email sent — check your inbox."
                : 'Please verify your email address.'}
            </span>
            {verifyBannerState !== 'sent' && (
              <button className="lt-btn" onClick={handleResendVerification} disabled={verifyBannerState === 'sending'}>
                {verifyBannerState === 'sending' ? 'Sending...' : 'Resend email'}
              </button>
            )}
            <button
              onClick={() => setVerifyBannerState('dismissed')}
              aria-label="Dismiss"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: 'inherit' }}
            >
              {'✕'}
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
