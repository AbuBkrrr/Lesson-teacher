import { idbGet, idbSet, idbClearPrefix } from '../offline/idb';
import { setOutboxSender } from '../offline/outbox';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

const TOKEN_KEY = 'ltp_access_token_v1';
const USER_KEY = 'ltp_user_v1';
const REFRESH_KEY = 'ltp_refresh_token_v1';
const SESSION_EXPIRED_KEY = 'ltp_session_expired_v1';
let sessionExpiredNotice = null;
/** 'expired' | 'suspended' | false — why the last session ended (safe under StrictMode double-render). */
export function consumeSessionExpired() {
  if (sessionExpiredNotice === null) {
    try {
      // Not removed here: the page reloads right after the flag is set, and the
      // Login screen can render once before that. Cleared on the next sign-in.
      sessionExpiredNotice = sessionStorage.getItem(SESSION_EXPIRED_KEY) || false;
    } catch { sessionExpiredNotice = false; }
  }
  return sessionExpiredNotice;
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function storeSession({ user, access_token, refresh_token }) {
  try { sessionStorage.removeItem(SESSION_EXPIRED_KEY); } catch { /* ignore */ }
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (access_token) localStorage.setItem(TOKEN_KEY, access_token);
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
}

export function clearSession() {
  idbClearPrefix('cache:');
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// Access tokens live 15 minutes. On a 401 we swap the refresh token for a new
// access token once (shared across concurrent requests) and retry; if that
// fails the session is really over, so send the user to Login with a notice
// instead of leaving every page showing "Invalid or expired token".
let refreshing = null;
// Resolves 'ok' (new access token stored), 'invalid' (server rejected the refresh
// token: session is over) or 'error' (network/server trouble: don't log the user out).
async function refreshAccessToken() {
  const refresh_token = localStorage.getItem(REFRESH_KEY);
  if (!refresh_token || isImpersonating()) return 'invalid';
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    })
      .then(async (r) => {
        if (r.status === 401 || r.status === 400) return 'invalid';
        if (!r.ok) return 'error';
        const d = await r.json().catch(() => ({}));
        if (!d.access_token) return 'error';
        localStorage.setItem(TOKEN_KEY, d.access_token);
        return 'ok';
      })
      .catch(() => 'error')
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

let ending = false;
function endSession(reason = 'expired') {
  if (ending) return;
  ending = true;
  if (isImpersonating()) {
    stopImpersonation();
    window.location.hash = '#/superadmin/users';
  } else {
    clearSession();
    try { sessionStorage.setItem(SESSION_EXPIRED_KEY, reason); } catch { /* ignore */ }
    window.location.hash = '#/login';
  }
  window.location.reload();
}

const NO_REFRESH_PATHS = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email', '/auth/child/redeem-invite'];

// fetch + one transparent refresh-and-retry on 401 for authenticated calls.
async function authedFetch(path, init) {
  let sentToken = null;
  const build = () => {
    const headers = { ...(init.headers || {}) };
    sentToken = getAccessToken();
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  let res;
  try {
    res = await build();
  } catch {
    const err = new Error('Cannot reach the server. Check your internet connection and try again.');
    err.status = 0;
    throw err;
  }
  if (res.status === 401 && sentToken && !NO_REFRESH_PATHS.includes(path)) {
    // Another request may already have refreshed while this one was in flight.
    const alreadyRefreshed = getAccessToken() && getAccessToken() !== sentToken;
    const outcome = alreadyRefreshed ? 'ok' : await refreshAccessToken();
    if (outcome === 'ok') {
      res = await build();
      if (res.status === 401) endSession();
    } else if (outcome === 'invalid') {
      endSession();
    }
  }
  if (res.status === 403 && sentToken && !NO_REFRESH_PATHS.includes(path)) {
    const msg = await res.clone().json().then((d) => d.error || '', () => '');
    if (/suspended/i.test(msg)) endSession('suspended');
  }
  return res;
}

// Reads are cached on the device (per user). Offline, a read falls back to the
// last copy so lists, bookings, messages etc. still open; the Layout banner says
// the data may be old. Writes are never cached (only chat has an outbox).
const cacheKey = (path) => `cache:${getStoredUser()?.id || 'anon'}:${path}`;
const NO_CACHE = ['/conversations/export', '/auth/', '/admin/audit-log', '/payments/'];

async function request(path, opts = {}) {
  const { method = 'GET', body } = opts;
  const cacheable = method === 'GET' && !NO_CACHE.some((p) => path.startsWith(p)) && getAccessToken();
  let res;
  try {
    res = await authedFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (cacheable && err.status === 0) {
      const hit = await idbGet(cacheKey(path));
      if (hit) {
        window.dispatchEvent(new CustomEvent('lt:serving-cached', { detail: { at: hit.at } }));
        return hit.data;
      }
    }
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (cacheable) idbSet(cacheKey(path), { data, at: Date.now() });
  return data;
}

/** Like request(), but sends a FormData body (no Content-Type header — the browser sets the multipart boundary itself). */
async function requestForm(path, formData) {
  const res = await authedFetch(path, { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- Auth ----
function deviceLabel() {
  const ua = navigator.userAgent || '';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'device';
  const app = /Electron/.test(ua) ? 'Desktop app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${app} on ${os}`;
}

export const deviceLink = {
  start: () => request('/auth/device-link/start', { method: 'POST', body: { label: deviceLabel() } }),
  /** Resolves null while pending; on approval stores the session and resolves it. */
  async claim(code, secret) {
    const res = await authedFetch('/auth/device-link/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, secret }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 202) return null;
    if (!res.ok) throw new Error(data.error || 'Link failed');
    storeSession(data);
    return data;
  },
  approve: (code) => request('/auth/device-link/approve', { method: 'POST', body: { code } }),
  devices: () => fetchDevices(),
  revoke: (id) => request(`/auth/devices/${id}`, { method: 'DELETE' }),
};
async function fetchDevices() {
  const res = await authedFetch('/auth/devices', { headers: { 'X-Refresh-Token': localStorage.getItem(REFRESH_KEY) || '' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load devices');
  return data;
}

export async function login(identifier, password) {
  const data = await request('/auth/login', { method: 'POST', body: { identifier, password, device_label: deviceLabel() } });
  storeSession(data);
  return data;
}
export function logout() {
  // Revoke the refresh token server-side (best effort), then drop local state.
  const refresh_token = localStorage.getItem(REFRESH_KEY);
  if (refresh_token) {
    fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token }) }).catch(() => {});
  }
  clearSession();
}
export async function signup(payload) {
  const data = await request('/auth/signup', { method: 'POST', body: payload });
  storeSession(data);
  return data;
}
export function forgotPassword(identifier) {
  return request('/auth/forgot-password', { method: 'POST', body: { identifier } });
}
export function resetPassword(token, new_password) {
  return request('/auth/reset-password', { method: 'POST', body: { token, new_password } });
}
export function verifyEmail(token) {
  return request('/auth/verify-email', { method: 'POST', body: { token } });
}
export function resendVerification() {
  return request('/auth/resend-verification', { method: 'POST' });
}
export const notifications = {
  list: (page = 1, unread = false) => request(`/notifications?page=${page}&page_size=20${unread ? '&unread=true' : ''}`),
  unreadCount: () => request('/notifications/unread-count'),
  markRead: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => request('/notifications/read-all', { method: 'POST' }),
};
export const account = {
  export: () => request('/account/export'),
  delete: (password) => request('/account/delete', { method: 'POST', body: { password } }),
};

// ---- Identity verification (Didit + manual upload, super_admin review) ----
export const kyc = {
  myStatus: () => request('/kyc/me'),
  uploadDocument: (formData) => requestForm('/kyc/document', formData),
  startDiditSession: () => request('/kyc/didit/session', { method: 'POST' }),
  pending: () => request('/kyc/pending'),
  approve: (userId) => request(`/kyc/${userId}/approve`, { method: 'POST' }),
  reject: (userId, reason) => request(`/kyc/${userId}/reject`, { method: 'POST', body: { reason } }),
};

// ---- Lesson requests: "post a search" (parent/adult_student post, tutors browse & apply) ----
export const lessonRequests = {
  create: (payload) => request('/lesson-requests', { method: 'POST', body: payload }),
  open: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))).toString();
    return request(`/lesson-requests/open${qs ? `?${qs}` : ''}`);
  },
  mine: () => request('/lesson-requests/mine'),
  close: (id) => request(`/lesson-requests/${id}/close`, { method: 'PATCH' }),
  apply: (id, payload) => request(`/lesson-requests/${id}/apply`, { method: 'POST', body: payload }),
  myApplications: () => request('/lesson-requests/applications/mine'),
  acceptApplication: (id, appId) => request(`/lesson-requests/${id}/applications/${appId}/accept`, { method: 'POST' }),
  declineApplication: (id, appId) => request(`/lesson-requests/${id}/applications/${appId}/decline`, { method: 'POST' }),
};

// ---- Admin (super_admin) ----
export const admin = {
  stats: () => request('/admin/stats'),
  listUsers: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/admin/users${qs ? `?${qs}` : ''}`);
  },
  listSchools: () => request('/admin/schools'),
  suspendUser: (id) => request(`/admin/users/${id}/suspend`, { method: 'POST' }),
  reactivateUser: (id) => request(`/admin/users/${id}/reactivate`, { method: 'POST' }),
  auditLog: (page = 1) => request(`/admin/audit-log?page=${page}`),
  impersonate: (id) => request(`/admin/users/${id}/impersonate`, { method: 'POST' }),
  resendVerification: (id) => request(`/admin/users/${id}/resend-verification`, { method: 'POST' }),
  sendPasswordReset: (id) => request(`/admin/users/${id}/password-reset`, { method: 'POST' }),
  bookings: (params = {}) => request(`/admin/bookings?${new URLSearchParams(params)}`),
  payments: (params = {}) => request(`/admin/payments?${new URLSearchParams(params)}`),
  tutors: (params = {}) => request(`/admin/tutors?${new URLSearchParams(params)}`),
  refunds: (params = {}) => request(`/admin/refunds?${new URLSearchParams(params)}`),
  announce: (payload) => request('/admin/announcements', { method: 'POST', body: payload }),
};

/** Uploaded files are served by the API (local storage) or a CDN (absolute URL). */
export const assetUrl = (u) => (!u ? null : /^https?:/i.test(u) ? u : API_BASE.replace(/\/api$/, '') + u);

// ---- "View as" (admin impersonation) ----
// The admin's own session is parked in sessionStorage while impersonating,
// so exiting restores it without a re-login. The impersonated token is
// short-lived and has no refresh token, so it simply expires if forgotten.
const ADMIN_BACKUP_KEY = 'ltp_admin_session_backup_v1';
export function startImpersonation({ access_token, user }) {
  sessionStorage.setItem(ADMIN_BACKUP_KEY, JSON.stringify({ user: getStoredUser(), access_token: getAccessToken() }));
  storeSession({ user, access_token });
}
export function isImpersonating() {
  return !!sessionStorage.getItem(ADMIN_BACKUP_KEY);
}
export function stopImpersonation() {
  const raw = sessionStorage.getItem(ADMIN_BACKUP_KEY);
  sessionStorage.removeItem(ADMIN_BACKUP_KEY);
  if (raw) storeSession(JSON.parse(raw));
}

// ---- Referrals ----
export const referrals = {
  mine: () => request('/referrals/me'),
  unresolved: () => request('/referrals/unresolved'),
  resolve: (id, marketer_user_id) => request(`/referrals/${id}/resolve`, { method: 'POST', body: { marketer_user_id } }),
};

// ---- Schools ----
export const schools = {
  mine: () => request('/schools/me'),
  update: (payload) => request('/schools/me', { method: 'PATCH', body: payload }),
  children: () => request('/schools/me/children'),
  addChild: (payload) => request('/schools/me/children', { method: 'POST', body: payload }),
  lookupParent: (identifier) => request(`/schools/me/parent-lookup?identifier=${encodeURIComponent(identifier)}`),
};

// ---- Skills ----
export const skills = {
  list: (category) => request(`/skills${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  create: (payload) => request('/skills', { method: 'POST', body: payload }),
  remove: (id) => request(`/skills/${id}`, { method: 'DELETE' }),
  mine: () => request('/skills/mine'),
  addMine: (skill_id, proficiency, evidence_urls) => request('/skills/mine', {
    method: 'POST',
    body: { skill_id, proficiency, evidence_urls: Array.isArray(evidence_urls) ? evidence_urls : (evidence_urls ? [evidence_urls] : []) },
  }),
  removeMine: (skillId) => request(`/skills/mine/${skillId}`, { method: 'DELETE' }),
};

// ---- Tutors ----
export const tutors = {
  list: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))).toString();
    return request(`/tutors${qs ? `?${qs}` : ''}`);
  },
  myProfile: () => request('/tutors/me'),
  updateMyProfile: (payload) => request('/tutors/me', { method: 'PUT', body: payload }),
  uploadIntroVideo: (formData) => requestForm('/tutors/me/intro-video', formData),
  removeIntroVideo: () => request('/tutors/me/intro-video', { method: 'DELETE' }),
  updateBankAccount: (payload) => request('/tutors/me/bank-account', { method: 'PUT', body: payload }),
  myAvailability: () => request('/tutors/me/availability'),
  updateMyAvailability: (slots, timezone) => request('/tutors/me/availability', { method: 'PUT', body: { slots, timezone } }),
  availabilityFor: (tutorId) => request(`/tutors/${tutorId}/availability`),
  favorites: () => request('/tutors/favorites/mine'),
  addFavorite: (tutorId) => request(`/tutors/${tutorId}/favorite`, { method: 'POST' }),
  removeFavorite: (tutorId) => request(`/tutors/${tutorId}/favorite`, { method: 'DELETE' }),
};

// ---- Children (parent) ----
export const children = {
  mine: () => request('/children/mine'),
  me: () => request('/children/me'),
  create: (payload) => request('/children', { method: 'POST', body: payload }),
  update: (id, payload) => request(`/children/${id}`, { method: 'PATCH', body: payload }),
  remove: (id) => request(`/children/${id}`, { method: 'DELETE' }),
};

// ---- Bookings ----
export const bookings = {
  create: (payload) => request('/bookings', { method: 'POST', body: payload }),
  mine: () => request('/bookings/mine'),
  getOne: (id) => request(`/bookings/${id}`),
  updateStatus: (id, status, opts = {}) => request(`/bookings/${id}/status`, { method: 'PATCH', body: { status, ...opts } }),
  report: (id) => request(`/bookings/${id}/report`),
  saveReport: (id, payload) => request(`/bookings/${id}/report`, { method: 'PUT', body: payload }),
  callChat: (id) => request(`/bookings/${id}/call-chat`),
  reschedule: (id, scheduled_at) => request(`/bookings/${id}/schedule`, { method: 'PATCH', body: { scheduled_at } }),
  downloadIcs: async (id) => {
    const res = await authedFetch(`/bookings/${id}/ics`, { headers: {} });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not download the calendar file');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = 'lesson.ics'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

// ---- Parents ----
export const parents = {
  dashboard: () => request('/parents/me/dashboard'),
};

// ---- Payments ----
export const payments = {
  initialize: (booking_id, method = 'gateway') => request('/payments/initialize', { method: 'POST', body: { booking_id, method } }),
  getTransferDetails: (paymentId) => request(`/payments/${paymentId}/transfer-details`),
  uploadProof: (paymentId, formData) => requestForm(`/payments/${paymentId}/proof`, formData),
  confirm: (paymentId) => request(`/payments/${paymentId}/confirm`, { method: 'POST' }),
  mockComplete: (reference) => request('/payments/mock/complete', { method: 'POST', body: { reference } }),
  mine: () => request('/payments/mine'),
  earningsSummary: () => request('/payments/earnings/summary'),
};

// ---- Payouts ----
export const payouts = {
  mine: () => request('/payouts/mine'),
  balances: () => request('/admin/payouts/balances'),
  listAll: () => request('/admin/payouts'),
  payoutTutor: (tutorId) => request(`/admin/payouts/tutor/${tutorId}`, { method: 'POST' }),
};

// ---- Settings ----
export const settings = {
  get: () => request('/admin/settings'),
  update: (payload) => request('/admin/settings', { method: 'PATCH', body: payload }),
};

// ---- Auditions ----
export const auditions = {
  create: (payload) => request('/auditions', { method: 'POST', body: payload }),
  mine: () => request('/auditions/mine'),
  updateStatus: (id, status, video_url, extra = {}) => request(`/auditions/${id}/status`, { method: 'PATCH', body: { status, video_url, ...extra } }),
  review: (id, payload) => request(`/auditions/${id}/review`, { method: 'PATCH', body: payload }),
};

// ---- Curriculum ----
export const progress = {
  me: () => request('/progress/me'),
  family: () => request('/progress/family'),
  child: (childId) => request(`/progress/children/${childId}`),
};

export const curriculum = {
  list: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString();
    return request(`/curriculum${qs ? `?${qs}` : ''}`);
  },
  create: (payload) => request('/curriculum', { method: 'POST', body: payload }),
  update: (id, payload) => request(`/curriculum/${id}`, { method: 'PATCH', body: payload }),
  remove: (id) => request(`/curriculum/${id}`, { method: 'DELETE' }),
};

// ---- Lesson materials ----
export const lessonMaterials = {
  upload: (formData) => requestForm('/lesson-materials', formData),
  mine: () => request('/lesson-materials/mine'),
  forTutor: (tutorId) => request(`/lesson-materials/tutor/${tutorId}`),
  remove: (id) => request(`/lesson-materials/${id}`, { method: 'DELETE' }),
};

// ---- Assignments ----
export const assignments = {
  create: (payload) => request('/assignments', { method: 'POST', body: payload }),
  mine: () => request('/assignments/mine'),
  submit: (id, payload) => request(`/assignments/${id}/submit`, { method: 'PATCH', body: payload }),
  grade: (id, payload) => request(`/assignments/${id}/grade`, { method: 'PATCH', body: payload }),
};

// ---- Conversations ----
export const conversations = {
  getOrCreate: (payload) => request('/conversations', { method: 'POST', body: payload }),
  mine: () => request('/conversations/mine'),
  monitor: () => request('/conversations/monitor'),
  messages: (id) => request(`/conversations/${id}/messages`),
  sendMessage: (id, content, client_id, reply_to_id) => request(`/conversations/${id}/messages`, { method: 'POST', body: { content, ...(client_id ? { client_id } : {}), ...(reply_to_id ? { reply_to_id } : {}) } }),
  sendAttachment: (id, file, content = '', reply_to_id = null) => {
    const fd = new FormData();
    fd.append('file', file); fd.append('content', content);
    if (reply_to_id) fd.append('reply_to_id', reply_to_id);
    return requestForm(`/conversations/${id}/messages`, fd);
  },
  react: (id, mid, emoji) => request(`/conversations/${id}/messages/${mid}/reaction`, { method: 'PUT', body: { emoji } }),
  setDisappear: (id, secs) => request(`/conversations/${id}/settings`, { method: 'PATCH', body: { disappear_after_seconds: secs } }),
  presence: (id) => request(`/conversations/${id}/presence`),
  exportChats: () => request('/conversations/export'),
  messagesAfter: (id, after) => request(`/conversations/${id}/messages?after=${encodeURIComponent(after)}`),
  editMessage: (id, mid, content) => request(`/conversations/${id}/messages/${mid}`, { method: 'PATCH', body: { content } }),
  deleteMessage: (id, mid) => request(`/conversations/${id}/messages/${mid}`, { method: 'DELETE' }),
  markRead: (id) => request(`/conversations/${id}/read`, { method: 'POST' }),
  unreadCount: () => request('/conversations/unread-count'),
};

// ---- Child invites (parent generates, child redeems) ----
export const childInvites = {
  create: (childId) => request(`/children/${childId}/invite`, { method: 'POST' }),
  redeem: async (code, username, password) => {
    const data = await request('/auth/child/redeem-invite', { method: 'POST', body: { code, username, password } });
    storeSession(data);
    return data;
  },
};

// ---- Reviews & platform-verified ----
export const reviews = {
  create: (payload) => request('/reviews', { method: 'POST', body: payload }),
  mine: () => request('/reviews/mine'),
  forTutor: (tutorId) => request(`/reviews/tutor/${tutorId}`),
  setVerified: (tutorId, verified) => request(`/reviews/tutors/${tutorId}/verify`, { method: 'POST', body: { verified } }),
};

// ---- Gamification: badges, streaks, leaderboards ----
export const gamification = {
  badgeCatalog: () => request('/gamification/badges'),
  childBadges: (childId) => request(`/gamification/children/${childId}/badges`),
  childStreak: (childId) => request(`/gamification/children/${childId}/streak`),
  siblingLeaderboard: () => request('/gamification/leaderboard/siblings'),
  schoolLeaderboard: () => request('/gamification/leaderboard/school'),
};

// ---- Satisfaction guarantee: refund / reschedule requests ----
export const refundRequests = {
  create: (payload) => request('/refund-requests', { method: 'POST', body: payload }),
  mine: () => request('/refund-requests/mine'),
  list: (status) => request(`/refund-requests${status ? `?status=${status}` : ''}`),
  resolve: (id, payload) => request(`/refund-requests/${id}/resolve`, { method: 'PATCH', body: payload }),
};

// ---- Subscription tiers (parent plans + B2B school plans) ----
export const subscriptions = {
  plans: (audience) => request(`/subscriptions/plans${audience ? `?audience=${audience}` : ''}`),
  createPlan: (payload) => request('/subscriptions/plans', { method: 'POST', body: payload }),
  subscribe: (plan_id) => request('/subscriptions/subscribe', { method: 'POST', body: { plan_id } }),
  mockComplete: (reference) => request('/subscriptions/mock/complete', { method: 'POST', body: { reference } }),
  mine: () => request('/subscriptions/mine'),
  cancel: (id) => request(`/subscriptions/${id}/cancel`, { method: 'POST' }),
};

// ---- Instant payouts & AI-assisted matching ----
export const instantPayout = {
  request: () => request('/payouts/instant', { method: 'POST' }),
};
export const matching = {
  recommended: (skillId, params = {}) => request(`/tutors/recommended?skill_id=${skillId}${params.max_rate ? `&max_rate=${params.max_rate}` : ''}`),
};

// ---- Premium material purchases ----
export const materialPurchases = {
  purchase: (materialId) => request(`/lesson-materials/${materialId}/purchase`, { method: 'POST' }),
};

export { API_BASE };

// The outbox sends through the normal API client (lets it share auth refresh and error shapes).
setOutboxSender((id, content, clientId, replyTo) => conversations.sendMessage(id, content, clientId, replyTo));
