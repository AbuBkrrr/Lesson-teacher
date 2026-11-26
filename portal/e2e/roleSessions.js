// Shared by the all-pages and responsive tests: one signed-in session per role,
// with real content (a child with a login, a paid lesson with a report, an audition).
import { expect } from '@playwright/test';
import { uniqueEmail, verifyUserInDb, createAdminInDb } from './helpers.js';

const API = 'http://localhost:4000/api';

async function json(res) { expect(res.ok(), `${res.url()} -> ${res.status()}`).toBeTruthy(); return res.json(); }

async function signUp(request, role, extra = {}) {
  const email = uniqueEmail(`e2e-all-${role}`);
  const s = await json(await request.post(`${API}/auth/signup`, { data: { email, password: 'TestPass123', full_name: `All ${role}`, role, ...extra } }));
  verifyUserInDb(email);
  return s;
}

export async function sessions(request) {
  const tutor = await signUp(request, 'tutor');
  const parent = await signUp(request, 'parent');
  const adult = await signUp(request, 'adult_student', { date_of_birth: '1995-05-05' });
  const school = await signUp(request, 'school_admin', { school_name: `All School ${Date.now()}` });
  const admin = createAdminInDb();
  const adminSession = await json(await request.post(`${API}/auth/login`, { data: { identifier: admin.email, password: admin.password } }));

  // Give pages real content: a child with a login, a paid lesson and a report.
  const P = { Authorization: `Bearer ${parent.access_token}` };
  const T = { Authorization: `Bearer ${tutor.access_token}` };
  await request.put(`${API}/tutors/me`, { headers: T, data: { hourly_rate: 2000, currency: 'NGN', subjects: [], bio: 'Patient maths tutor' } });
  const child = (await json(await request.post(`${API}/children`, { headers: P, data: { full_name: 'All Kid', age: 10 } }))).child;
  const invite = await json(await request.post(`${API}/children/${child.id}/invite`, { headers: P }));
  const kid = await json(await request.post(`${API}/auth/child/redeem-invite`, { data: { code: invite.code, username: `allkid${Date.now()}`, password: 'KidPass1234' } }));
  const b = (await json(await request.post(`${API}/bookings`, { headers: P, data: { tutor_id: tutor.user.id, child_id: child.id, subject: 'Maths', scheduled_at: new Date(Date.now() + 3 * 864e5).toISOString() } }))).booking;
  await json(await request.patch(`${API}/bookings/${b.id}/status`, { headers: T, data: { status: 'confirmed' } }));
  const pay = await json(await request.post(`${API}/payments/initialize`, { headers: P, data: { booking_id: b.id } }));
  await json(await request.post(`${API}/payments/mock/complete`, { headers: P, data: { reference: pay.reference } }));
  await json(await request.put(`${API}/bookings/${b.id}/report`, { headers: T, data: { summary: 'Fractions', score: 80 } }));
  await json(await request.post(`${API}/auditions`, { headers: P, data: { tutor_id: tutor.user.id, type: 'video' } }));

  return { tutor, parent, adult_student: adult, school_admin: school, super_admin: adminSession, child: kid };
}

