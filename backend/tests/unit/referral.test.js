const db = require('../../src/config/db');
const { generateUniqueReferralCode, resolveMarketer, generateUniqueJoinCode, uuidv4 } = require('../../src/utils/referral');
const bcrypt = require('bcryptjs');

describe('referral utils', () => {
  it('generates a referral code in the expected format', async () => {
    const code = await generateUniqueReferralCode(db);
    expect(code).toMatch(/^LT-[A-Z0-9]{6}$/);
  });

  it('generates a join code in the expected format', async () => {
    const code = await generateUniqueJoinCode(db);
    expect(code).toMatch(/^SCH-[A-Z0-9]{8}$/);
  });

  it('resolveMarketer returns null for empty input', async () => {
    expect(await resolveMarketer(db, '')).toBeNull();
    expect(await resolveMarketer(db, null)).toBeNull();
  });

  it('resolveMarketer finds a user by email, phone, or referral code', async () => {
    const id = uuidv4();
    const now = new Date().toISOString();
    const referralCode = await generateUniqueReferralCode(db);
    await db.prepare(
      `INSERT INTO users (id, role, full_name, email, phone, password_hash, referral_code, status, created_at, updated_at)
       VALUES (?, 'parent', 'Findable Person', 'findable@example.com', '+2348011112222', ?, ?, 'active', ?, ?)`
    ).run(id, bcrypt.hashSync('x', 4), referralCode, now, now);

    expect((await resolveMarketer(db, 'findable@example.com')).id).toBe(id);
    expect((await resolveMarketer(db, '+2348011112222')).id).toBe(id);
    expect((await resolveMarketer(db, referralCode)).id).toBe(id);
    expect(await resolveMarketer(db, 'nobody@nowhere.com')).toBeUndefined();
  });
});
