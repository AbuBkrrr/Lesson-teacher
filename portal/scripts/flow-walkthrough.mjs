// Runs the real marketplace flow through the API for each role and prints what happens.
import { uniqueEmail, verifyUserInDb } from '../e2e/helpers.js';
const API = 'http://localhost:4000/api';
async function call(method, path, token, body) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
const log = (who, step, r, extra = '') => console.log(`${r.ok ? 'OK  ' : 'FAIL'} [${who}] ${step}${r.ok ? '' : ` -> ${r.status} ${r.j.error}`} ${extra}`);
async function signup(role, name, extra = {}) {
  const email = uniqueEmail(role);
  const r = await call('POST', '/auth/signup', null, { role, full_name: name, email, password: 'walkpass123', ...extra });
  return { email, token: r.j.access_token, user: r.j.user, r };
}

// ---- Tutor
const T = await signup('tutor', 'Tola Tutor'); log('tutor', 'sign up', T.r);
log('tutor', 'fill profile', await call('PUT', '/tutors/me', T.token, { bio: 'Maths teacher', hourly_rate: 5000, currency: 'NGN', city: 'Lagos', country: 'Nigeria', qualifications: 'B.Ed', teaches_online: true }));
const skills = (await call('GET', '/skills', T.token)).j.skills || [];
log('tutor', `add skill (${skills[0]?.name})`, await call('POST', '/skills/mine', T.token, { skill_id: skills[0].id, proficiency: 'expert' }));
log('tutor', 'publish availability', await call('PUT', '/tutors/me/availability', T.token, { slots: [{ day_of_week: 1, start_time: '16:00', end_time: '18:00' }] }));
const pre = await call('GET', '/tutors?city=Lagos', T.token);
verifyUserInDb(T.email);

// ---- Parent + child
const P = await signup('parent', 'Pat Parent'); log('parent', 'sign up', P.r);
let blocked = await call('POST', '/bookings', P.token, { tutor_id: T.user.id, subject: 'Maths' });
log('parent', 'book BEFORE ID verification (expect blocked)', { ok: !blocked.ok, status: blocked.status, j: {} }, `-> ${blocked.status}: ${blocked.j.error?.slice(0, 60)}`);
verifyUserInDb(P.email);
const kid = (await call('POST', '/children', P.token, { full_name: 'Kemi Kid', grade_level: 'SS2', subjects: ['Maths'] })).j;
const kidId = kid.child?.id || kid.id; log('parent', 'add child', { ok: !!kidId, status: 200, j: {} });
const inv = await call('POST', `/children/${kidId}/invite`, P.token); log('parent', 'create child invite code', inv);
const redeem = await call('POST', '/auth/child/redeem-invite', null, { code: inv.j.code || inv.j.invite?.code, username: 'kemi' + Date.now(), password: 'kidpass123' });
log('child', 'redeem invite & get own login', redeem); const K = redeem.j;
const book = await call('POST', '/bookings', P.token, { tutor_id: T.user.id, child_id: kidId, subject: 'Maths', scheduled_at: new Date(Date.now() + 86400000).toISOString() });
const bid = book.j.booking?.id; log('parent', 'book lesson for child', book, `status=${book.j.booking?.status}`);
log('tutor', 'accept booking', await call('PATCH', `/bookings/${bid}/status`, T.token, { status: 'confirmed' }));
const pay = await call('POST', '/payments/initialize', P.token, { booking_id: bid, method: 'gateway' }); log('parent', 'start payment', pay, JSON.stringify(Object.keys(pay.j)));
if (pay.j.reference) log('parent', 'complete mock payment', await call('POST', '/payments/mock/complete', P.token, { reference: pay.j.reference }));
const conv = await call('POST', '/conversations', P.token, { tutor_id: T.user.id, child_id: kidId }); log('parent', 'open chat with tutor', conv);
const asg = await call('POST', '/assignments', T.token, { child_id: kidId, booking_id: bid, title: 'Quadratics worksheet', instructions: 'Do Q1-5' }); log('tutor', 'set assignment for child', asg);
const ca = await call('GET', '/assignments/mine', K.access_token); log('child', 'see assignments', ca, `count=${ca.j.assignments?.length}`);
const aid = ca.j.assignments?.[0]?.id;
log('child', 'submit assignment', await call('PATCH', `/assignments/${aid}/submit`, K.access_token, { content: 'Done' }));
log('tutor', 'grade assignment', await call('PATCH', `/assignments/${aid}/grade`, T.token, { grade: 'A', feedback: 'Great' }));
const cb = await call('GET', '/bookings/mine', K.access_token); log('child', 'see own bookings', cb, `count=${cb.j.bookings?.length}`);
log('tutor', 'mark lesson complete', await call('PATCH', `/bookings/${bid}/status`, T.token, { status: 'completed' }));
log('parent', 'leave review', await call('POST', '/reviews', P.token, { booking_id: bid, rating: 5, comment: 'Great' }));
const streak = await call('GET', `/gamification/children/${kidId}/streak`, P.token); log('child', 'streak/points after lesson', streak, JSON.stringify(streak.j).slice(0, 90));

// ---- Adult student
const A = await signup('adult_student', 'Ada Adult', { date_of_birth: '1995-05-05' }); log('adult', 'sign up', A.r);
verifyUserInDb(A.email);
const ab = await call('POST', '/bookings', A.token, { tutor_id: T.user.id, subject: 'Maths', scheduled_at: new Date(Date.now() + 172800000).toISOString() }); log('adult', 'book lesson for self', ab);
const abid = ab.j.booking?.id;
log('tutor', 'accept', await call('PATCH', `/bookings/${abid}/status`, T.token, { status: 'confirmed' }));
const apay = await call('POST', '/payments/initialize', A.token, { booking_id: abid, method: 'gateway' }); log('adult', 'start payment', apay);
if (apay.j.reference) log('adult', 'complete mock payment', await call('POST', '/payments/mock/complete', A.token, { reference: apay.j.reference }));
log('adult', 'open chat with tutor', await call('POST', '/conversations', A.token, { tutor_id: T.user.id }));
const aas = await call('POST', '/assignments', T.token, { booking_id: abid, title: 'Adult worksheet', instructions: 'Q1' }); log('tutor', 'set assignment for adult student (no child_id)', aas);
const aa = await call('GET', '/assignments/mine', A.token); log('adult', 'see assignments', aa, `count=${aa.j.assignments?.length}`);
log('adult', 'saved tutors', await call('POST', `/tutors/${T.user.id}/favorite`, A.token));
log('tutor', 'complete', await call('PATCH', `/bookings/${abid}/status`, T.token, { status: 'completed' }));
log('adult', 'leave review', await call('POST', '/reviews', A.token, { booking_id: abid, rating: 4, comment: 'Good' }));
const earn = await call('GET', '/payments/earnings/summary', T.token); log('tutor', 'earnings summary', earn, JSON.stringify(earn.j).slice(0, 120));
