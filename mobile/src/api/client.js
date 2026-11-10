import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheGet, cacheSet, clearCache, reportNetwork, reportStale, setOutboxSender } from '../utils/offline';

// 'localhost' means the phone/emulator itself on React Native, not your dev
// machine — there's no way around this, only sensible defaults per platform:
//   - Android emulator: 10.0.2.2 is a special alias the emulator provides
//     for the host machine's localhost.
//   - iOS simulator: shares the host's network namespace, so 'localhost'
//     actually does work there.
//   - A physical device (either platform): needs your dev machine's real
//     LAN IP — neither of the above applies. Set EXPO_PUBLIC_API_BASE in
//     .env for this case (see .env.example).
const DEV_DEFAULT_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const API_BASE = process.env.EXPO_PUBLIC_API_BASE || `http://${DEV_DEFAULT_HOST}:4000/api`;

const TOKEN_KEY = 'ltm_access_token_v1';
const USER_KEY = 'ltm_user_v1';
const REFRESH_KEY = 'ltm_refresh_token_v1';

// AsyncStorage is asynchronous, unlike localStorage, so we can't read it
// synchronously on every request the way the web client does. Instead we
// keep an in-memory mirror, hydrated once at startup (see hydrateSession),
// and update both together on every write.
let accessToken = null;
let refreshToken = null;
let currentUser = null;
let onSessionExpired = null;
/** AuthContext registers this so a dead session drops the user back to Login. */
export function setSessionExpiredHandler(fn) { onSessionExpired = fn; }
let hydrated = false;

/** Call once at app startup, before rendering anything that reads auth state. */
export async function hydrateSession() {
  if (hydrated) return { user: currentUser, accessToken };
  const [storedToken, storedUser, storedRefresh] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(USER_KEY),
    AsyncStorage.getItem(REFRESH_KEY),
  ]);
  accessToken = storedToken || null;
  refreshToken = storedRefresh || null;
  currentUser = storedUser ? JSON.parse(storedUser) : null;
  hydrated = true;
  return { user: currentUser, accessToken };
}

export function getStoredUser() {
  return currentUser;
}

export function getAccessToken() {
  return accessToken;
}

async function storeSession({ user, access_token, refresh_token }) {
  if (refresh_token) {
    refreshToken = refresh_token;
    await AsyncStorage.setItem(REFRESH_KEY, refresh_token);
  }
  if (user) {
    currentUser = user;
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  if (access_token) {
    accessToken = access_token;
    await AsyncStorage.setItem(TOKEN_KEY, access_token);
  }
}

export async function clearSession() {
  clearCache();
  currentUser = null;
  accessToken = null;
  refreshToken = null;
  await AsyncStorage.multiRemove([USER_KEY, TOKEN_KEY, REFRESH_KEY]);
}

// Access tokens live 15 minutes: on a 401 swap the refresh token for a new one
// once (shared by concurrent requests) and retry; if that fails, end the session.
let refreshing = null;
async function refreshAccessToken() {
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const d = await r.json().catch(() => ({}));
        if (!d.access_token) return false;
        accessToken = d.access_token;
        await AsyncStorage.setItem(TOKEN_KEY, d.access_token);
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

const NO_REFRESH_PATHS = ['/auth/device-link/claim', '/auth/login', '/auth/signup', '/auth/refresh', '/auth/forgot-password', '/auth/child/redeem-invite'];

async function authedFetch(path, init) {
  const build = () => {
    const headers = { ...(init.headers || {}) };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_BASE}${path}`, { ...init, headers });
  };
  let res;
  try {
    res = await build();
  } catch {
    const err = new Error('Cannot reach the server. Check your connection and try again.');
    err.status = 0;
    throw err;
  }
  if (res.status === 401 && accessToken && !NO_REFRESH_PATHS.includes(path)) {
    if (await refreshAccessToken()) res = await build();
    if (res.status === 401) {
      await clearSession();
      if (onSessionExpired) onSessionExpired();
    }
  }
  return res;
}

const NO_CACHE = ['/conversations/export', '/auth/', '/admin/audit-log', '/payments/'];

async function request(path, { method = 'GET', body } = {}) {
  const cacheable = method === 'GET' && !!accessToken && !NO_CACHE.some((p) => path.startsWith(p));
  const key = `${currentUser?.id || 'anon'}:${path}`;
  let res;
  try {
    res = await authedFetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    reportNetwork(true);
  } catch (err) {
    reportNetwork(false);
    if (cacheable && err.status === 0) {
      const hit = await cacheGet(key);
      if (hit) { reportStale(); return hit.data; }
    }
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  if (cacheable) cacheSet(key, data);
  return data;
}

/**
 * Like request(), but sends a FormData body — used for the direct-transfer
 * proof-of-payment upload. RN's FormData expects file parts shaped as
 * { uri, name, type }, not a browser File/Blob — see
 * imagePickerAssetToFormDataFile() in this file for building that part
 * from an expo-image-picker result.
 */
async function requestForm(path, formData) {
  const headers = {};
  const res = await authedFetch(path, { method: 'POST', headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Builds the { uri, name, type } part RN's FormData needs from an expo-image-picker asset. */
export function imagePickerAssetToFormDataFile(asset) {
  const uriParts = asset.uri.split('.');
  const ext = uriParts[uriParts.length - 1];
  return {
    uri: asset.uri,
    name: asset.fileName || `proof.${ext}`,
    type: asset.mimeType || `image/${ext}`,
  };
}

// ---- Auth ----
export const deviceLink = {
  start: () => request('/auth/device-link/start', { method: 'POST', body: { label: `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} app` } }),
  /** Resolves null while pending; on approval stores the session and resolves it. */
  async claim(code, secret) {
    const res = await authedFetch('/auth/device-link/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, secret }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 202) return null;
    if (!res.ok) throw new Error(data.error || 'Link failed');
    await storeSession(data);
    return data;
  },
  approve: (code) => request('/auth/device-link/approve', { method: 'POST', body: { code } }),
  async devices() {
    const rt = await AsyncStorage.getItem(REFRESH_KEY);
    const res = await authedFetch('/auth/devices', { headers: { 'X-Refresh-Token': rt || '' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load devices');
    return data;
  },
  revoke: (id) => request(`/auth/devices/${id}`, { method: 'DELETE' }),
};

export async function login(identifier, password) {
  const data = await request('/auth/login', { method: 'POST', body: { identifier, password, device_label: `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} app` } });
  await storeSession(data);
  return data;
}
export async function signup(payload) {
  const data = await request('/auth/signup', { method: 'POST', body: payload });
  await storeSession(data);
  return data;
}
export async function logout() {
  if (refreshToken) {
    fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) }).catch(() => {});
  }
  await clearSession();
}
export function forgotPassword(identifier) {
  return request('/auth/forgot-password', { method: 'POST', body: { identifier } });
}

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
  favorites: () => request('/tutors/favorites/mine'),
  addFavorite: (tutorId) => request(`/tutors/${tutorId}/favorite`, { method: 'POST' }),
  removeFavorite: (tutorId) => request(`/tutors/${tutorId}/favorite`, { method: 'DELETE' }),
};

// ---- Account ----
export function resendVerification() {
  return request('/auth/resend-verification', { method: 'POST' });
}
export const account = {
  export: () => request('/account/export'),
  delete: (password) => request('/account/delete', { method: 'POST', body: { password } }),
};

// ---- Skills (used to filter Discover) ----
export const skills = {
  list: (category) => request(`/skills${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  create: (payload) => request('/skills', { method: 'POST', body: payload }),
  remove: (id) => request(`/skills/${id}`, { method: 'DELETE' }),
  mine: () => request('/skills/mine'),
  addMine: (skill_id, proficiency, evidence_url) => request('/skills/mine', { method: 'POST', body: { skill_id, proficiency, evidence_url } }),
  removeMine: (skillId) => request(`/skills/mine/${skillId}`, { method: 'DELETE' }),
};

// ---- Children (parent) ----
export const children = {
  mine: () => request('/children/mine'),
  me: () => request('/children/me'),
  create: (payload) => request('/children', { method: 'POST', body: payload }),
  remove: (id) => request(`/children/${id}`, { method: 'DELETE' }),
};

// ---- Child invites (parent generates a code so a child can create their own login) ----
export const childInvites = {
  create: (childId) => request(`/children/${childId}/invite`, { method: 'POST' }),
};

// ---- Bookings ----
export const bookings = {
  create: (payload) => request('/bookings', { method: 'POST', body: payload }),
  mine: () => request('/bookings/mine'),
  getOne: (id) => request(`/bookings/${id}`),
  updateStatus: (id, status) => request(`/bookings/${id}/status`, { method: 'PATCH', body: { status } }),
  reschedule: (id, scheduled_at) => request(`/bookings/${id}/schedule`, { method: 'PATCH', body: { scheduled_at } }),
};

// ---- Auditions ----
export const auditions = {
  create: (payload) => request('/auditions', { method: 'POST', body: payload }),
  mine: () => request('/auditions/mine'),
  updateStatus: (id, status, video_url) => request(`/auditions/${id}/status`, { method: 'PATCH', body: { status, video_url } }),
};

// ---- Curriculum ----
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
  purchase: (materialId) => request(`/lesson-materials/${materialId}/purchase`, { method: 'POST' }),
};

// ---- Assignments ----
export const assignments = {
  create: (payload) => request('/assignments', { method: 'POST', body: payload }),
  mine: () => request('/assignments/mine'),
  submit: (id, payload) => request(`/assignments/${id}/submit`, { method: 'PATCH', body: payload }),
  grade: (id, payload) => request(`/assignments/${id}/grade`, { method: 'PATCH', body: payload }),
};

// ---- Schools ----
export const schools = {
  mine: () => request('/schools/me'),
  update: (payload) => request('/schools/me', { method: 'PATCH', body: payload }),
  children: () => request('/schools/me/children'),
  addChild: (payload) => request('/schools/me/children', { method: 'POST', body: payload }),
  lookupParent: (identifier) => request(`/schools/me/parent-lookup?identifier=${encodeURIComponent(identifier)}`),
};

// ---- Referrals ----
export const referrals = {
  mine: () => request('/referrals/me'),
  unresolved: () => request('/referrals/unresolved'),
  resolve: (id, marketer_user_id) => request(`/referrals/${id}/resolve`, { method: 'POST', body: { marketer_user_id } }),
};

// ---- Payouts ----
export const payouts = {
  mine: () => request('/payouts/mine'),
  requestInstant: () => request('/payouts/instant', { method: 'POST' }),
  balances: () => request('/admin/payouts/balances'),
  listAll: () => request('/admin/payouts'),
  payoutTutor: (tutorId) => request(`/admin/payouts/tutor/${tutorId}`, { method: 'POST' }),
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
  getSettings: () => request('/admin/settings'),
  updateSettings: (payload) => request('/admin/settings', { method: 'PATCH', body: payload }),
  auditLog: (page = 1) => request(`/admin/audit-log?page=${page}`),
  payments: (params = {}) => request(`/admin/payments?${new URLSearchParams(params)}`),
  refunds: (params = {}) => request(`/admin/refunds?${new URLSearchParams(params)}`),
  announce: (payload) => request('/admin/announcements', { method: 'POST', body: payload }),
  bookings: (params = {}) => request(`/admin/bookings?${new URLSearchParams(params)}`),
  tutors: (params = {}) => request(`/admin/tutors?${new URLSearchParams(params)}`),
  setTutorVerified: (tutorId, verified) => request(`/reviews/tutors/${tutorId}/verify`, { method: 'POST', body: { verified } }),
  sendPasswordReset: (id) => request(`/admin/users/${id}/password-reset`, { method: 'POST' }),
};

// ---- Payments ----
export const payments = {
  initialize: (booking_id, method = 'gateway') => request('/payments/initialize', { method: 'POST', body: { booking_id, method } }),
  uploadProof: (paymentId, formData) => requestForm(`/payments/${paymentId}/proof`, formData),
  mockComplete: (reference) => request('/payments/mock/complete', { method: 'POST', body: { reference } }),
  mine: () => request('/payments/mine'),
  confirm: (paymentId) => request(`/payments/${paymentId}/confirm`, { method: 'POST' }),
  earningsSummary: () => request('/payments/earnings/summary'),
};

// ---- Conversations ----
export const notifications = {
  list: (page = 1) => request(`/notifications?page=${page}&page_size=20`),
  unreadCount: () => request('/notifications/unread-count'),
  markRead: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => request('/notifications/read-all', { method: 'POST' }),
};

export const conversations = {
  getOrCreate: (payload) => request('/conversations', { method: 'POST', body: payload }),
  mine: () => request('/conversations/mine'),
  monitor: () => request('/conversations/monitor'),
  messages: (id) => request(`/conversations/${id}/messages`),
  unreadCount: () => request('/conversations/unread-count'),
  markRead: (id) => request(`/conversations/${id}/read`, { method: 'POST' }),
  sendMessage: (id, content, client_id, reply_to_id) => request(`/conversations/${id}/messages`, { method: 'POST', body: { content, ...(client_id ? { client_id } : {}), ...(reply_to_id ? { reply_to_id } : {}) } }),
  sendAttachment: (id, asset, content = '', reply_to_id = null) => {
    const fd = new FormData();
    fd.append('file', imagePickerAssetToFormDataFile(asset));
    fd.append('content', content);
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
};

// ---- Gamification: badges, streaks, leaderboards ----
export const gamification = {
  childStreak: (childId) => request(`/gamification/children/${childId}/streak`),
  childBadges: (childId) => request(`/gamification/children/${childId}/badges`),
  siblingLeaderboard: () => request('/gamification/leaderboard/siblings'),
  schoolLeaderboard: () => request('/gamification/leaderboard/school'),
};

// ---- Reviews ----
export const reviews = {
  create: (payload) => request('/reviews', { method: 'POST', body: payload }),
  mine: () => request('/reviews/mine'),
};

// ---- Satisfaction guarantee: refund / reschedule requests ----
export const refundRequests = {
  create: (payload) => request('/refund-requests', { method: 'POST', body: payload }),
  mine: () => request('/refund-requests/mine'),
};

// ---- Subscription tiers (parent plans) ----
export const subscriptions = {
  plans: (audience = 'parent') => request(`/subscriptions/plans?audience=${audience}`),
  subscribe: (plan_id) => request('/subscriptions/subscribe', { method: 'POST', body: { plan_id } }),
  mockComplete: (reference) => request('/subscriptions/mock/complete', { method: 'POST', body: { reference } }),
  mine: () => request('/subscriptions/mine'),
  cancel: (id) => request(`/subscriptions/${id}/cancel`, { method: 'POST' }),
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

// ---- Lesson requests: "post a search" ----
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

// ---- Push notification device tokens ----
export const pushTokens = {
  register: (token, platform) => request('/push-tokens', { method: 'POST', body: { token, platform } }),
  unregister: (token) => request('/push-tokens', { method: 'DELETE', body: { token } }),
};

export { API_BASE };

setOutboxSender((id, content, clientId, replyTo) => conversations.sendMessage(id, content, clientId, replyTo));
