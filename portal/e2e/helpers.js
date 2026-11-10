import { execSync } from 'child_process';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';

/** Runs SQL against the e2e database. In CI set E2E_DATABASE_URL (a postgres://
 * URL); locally it falls back to the sandbox's `sudo -u postgres psql`. SQL goes
 * in on stdin so quoting never depends on the shell. */
export function psql(sql, { tuples = false } = {}) {
  const flags = tuples ? '-t -A' : '';
  // E2E_DOCKER_PG=<container> runs psql inside that Postgres container (handy on Windows, no local psql needed).
  const cmd = process.env.E2E_DOCKER_PG
    ? `docker exec -i ${process.env.E2E_DOCKER_PG} psql -U lessonteacher -d lessonteacher -v ON_ERROR_STOP=1 ${flags}`
    : process.env.E2E_DATABASE_URL
      ? `psql "${process.env.E2E_DATABASE_URL}" -v ON_ERROR_STOP=1 ${flags}`
      : `sudo -u postgres psql -d lessonteacher -v ON_ERROR_STOP=1 ${flags}`;
  return execSync(cmd, { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}

/** Bypasses the ID-verification hard gate for e2e test accounts by setting their
 * status directly in the dev DB — mirrors the backend Jest suite's verifyUser()
 * helper, since e2e tests exercise the real HTTP/UI flow and a live admin
 * KYC-approval walkthrough is out of scope for this smoke suite. */
export function verifyUserInDb(email) {
  const sql = `UPDATE users SET id_verification_status='verified' WHERE email='${email.replace(/'/g, "''")}';`;
  psql(sql);
}

export function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

/** Reads the raw email-verification token out of the dev DB's notifications
 * log, the same way latestResetToken stands in for receiving the password-
 * reset email below. */
export function latestVerifyEmailToken(email) {
  const sql = `SELECT body FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email='${email.replace(/'/g, "''")}' AND n.type='verify_email' ORDER BY n.created_at DESC LIMIT 1;`;
  const out = psql(sql, { tuples: true });
  const match = out.match(/token=([a-f0-9]+)/);
  return match && match[1];
}

/** Reads the raw reset token out of the dev DB's notifications log — standing
 * in for actually receiving the email, since this suite drives the UI, not a
 * mail server. The console email provider logs the same body that's stored
 * in `notifications.body`, which contains the full reset link. */
export function latestResetToken(email) {
  const sql = `SELECT body FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email='${email.replace(/'/g, "''")}' AND n.type='password_reset' ORDER BY n.created_at DESC LIMIT 1;`;
  const out = psql(sql, { tuples: true });
  const match = out.match(/token=([a-f0-9]+)/);
  return match && match[1];
}

/** Creates a super_admin directly in the dev DB (there's no signup path for
 * that role by design) and returns its credentials. */
export function createAdminInDb() {
  const email = uniqueEmail('e2e-admin');
  const password = 'AdminPass12345';
  const bcrypt = createRequire(import.meta.url)('../../backend/node_modules/bcryptjs');
  const hash = bcrypt.hashSync(password, 10);
  const id = randomUUID();
  const code = 'ADM' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const now = new Date().toISOString();
  const out = psql(
    `INSERT INTO users (id, role, full_name, email, password_hash, referral_code, status, created_at, updated_at) VALUES ('${id}','super_admin','E2E Admin','${email}','${hash}','${code}','active','${now}','${now}');`
  );
  if (!/INSERT 0 1/.test(out)) throw new Error(`admin insert failed: ${out}`);
  return { email, password };
}
