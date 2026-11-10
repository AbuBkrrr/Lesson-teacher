-- =====================================================================
-- Lesson Teacher — Core Schema
-- Design notes:
--   * every syncable table has: id (uuid text), created_at, updated_at,
--     deleted_at (soft delete). This is what makes offline-first sync
--     possible later: clients pull "everything changed since X",
--     including tombstones for deletes.
--   * updated_at is ALWAYS set server-side on write, never trusted from
--     the client, so last-write-wins conflict resolution is safe.
-- =====================================================================


CREATE TABLE IF NOT EXISTS schools (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    address         TEXT,
    contact_email   TEXT,
    contact_phone   TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    admin_user_id   TEXT,                 -- set after the school_admin user is created (chicken/egg on signup)
    join_code       TEXT UNIQUE NOT NULL, -- code parents/students use to attach to this school
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id                 TEXT PRIMARY KEY,
    role               TEXT NOT NULL CHECK (role IN ('super_admin','school_admin','parent','tutor','child')),
    full_name          TEXT NOT NULL,
    email              TEXT UNIQUE,
    phone              TEXT UNIQUE,
    username           TEXT UNIQUE, -- used by 'child' accounts, which have no email/phone
    password_hash      TEXT NOT NULL,
    referral_code      TEXT UNIQUE NOT NULL,   -- this user's own code to give out
    referred_by_code   TEXT,                   -- raw code/email/phone entered at signup (kept even if unresolved)
    referred_by_user_id TEXT,                  -- resolved marketer, once matched
    school_id          TEXT REFERENCES schools(id),
    status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    deleted_at         TEXT,
    FOREIGN KEY (referred_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);

CREATE TABLE IF NOT EXISTS children (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT NOT NULL REFERENCES users(id),
    school_id   TEXT REFERENCES schools(id),
    full_name   TEXT NOT NULL,
    grade_level TEXT,
    user_id     TEXT UNIQUE REFERENCES users(id), -- set once the parent grants this child their own login
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id);
CREATE INDEX IF NOT EXISTS idx_children_user ON children(user_id);
CREATE INDEX IF NOT EXISTS idx_children_updated_at ON children(updated_at);

-- =====================================================================
-- Child login invites: the ONLY way a child account can be created.
-- A parent generates a one-time code for a specific child row; the
-- child (with the parent present) redeems it to set their own
-- password. This is the structural enforcement of "adult consent" —
-- there is no self-signup path for the 'child' role anywhere in auth.
-- =====================================================================
CREATE TABLE IF NOT EXISTS child_invites (
    id                TEXT PRIMARY KEY,
    child_id          TEXT NOT NULL REFERENCES children(id),
    code              TEXT UNIQUE NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id), -- the consenting parent
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','used','expired')),
    expires_at        TEXT NOT NULL,
    used_at           TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_child_invites_child ON child_invites(child_id);

CREATE TABLE IF NOT EXISTS tutor_profiles (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL UNIQUE REFERENCES users(id),
    subjects      TEXT,          -- JSON array, e.g. ["Mathematics","Critical Thinking"]
    qualifications TEXT,
    hourly_rate   REAL,
    currency      TEXT DEFAULT 'NGN',
    bio           TEXT,
    rating        REAL DEFAULT 0,
    review_count  INTEGER DEFAULT 0,

    -- Payout destination. bank_code follows the payment provider's own
    -- bank list (e.g. Paystack's /bank endpoint); recipient_code is the
    -- provider's saved-recipient reference, created once and reused for
    -- every future transfer.
    bank_name           TEXT,
    bank_code           TEXT,
    account_number       TEXT,
    account_name         TEXT,
    payout_provider       TEXT,   -- 'paystack' | 'mock'
    payout_recipient_code TEXT,

    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_tutor_profiles_updated_at ON tutor_profiles(updated_at);
CREATE INDEX IF NOT EXISTS idx_tutor_profiles_rate ON tutor_profiles(hourly_rate);
CREATE INDEX IF NOT EXISTS idx_tutor_profiles_rating ON tutor_profiles(rating);

-- =====================================================================
-- Skill catalog: a curated, admin-managed set of skills across
-- categories (mental, physical, academic, creative, life, career).
-- Tutors attach themselves to catalog skills via tutor_skills rather
-- than free-typing subjects, so discovery filtering can use an
-- indexed join instead of scanning/parsing JSON text at query time —
-- this is the kind of choice that matters once tutor_profiles is a
-- large table.
-- =====================================================================
CREATE TABLE IF NOT EXISTS skills (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    category    TEXT NOT NULL CHECK (category IN ('mental','physical','academic','creative','life','career')),
    description TEXT,
    icon        TEXT,          -- emoji or icon identifier
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

CREATE TABLE IF NOT EXISTS tutor_skills (
    id           TEXT PRIMARY KEY,
    tutor_id     TEXT NOT NULL REFERENCES users(id),
    skill_id     TEXT NOT NULL REFERENCES skills(id),
    proficiency  TEXT NOT NULL DEFAULT 'intermediate' CHECK (proficiency IN ('beginner','intermediate','expert')),
    evidence_url TEXT,          -- link to a certificate, portfolio, etc.
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    deleted_at   TEXT,
    UNIQUE(tutor_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_tutor_skills_tutor ON tutor_skills(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tutor_skills_skill ON tutor_skills(skill_id);

-- =====================================================================
-- Curriculum library: reference units tutors plan lessons around.
-- school_id NULL = platform-wide curriculum (super_admin managed).
-- school_id set = that school's own curriculum (school_admin managed).
-- =====================================================================
CREATE TABLE IF NOT EXISTS curriculum_units (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    description         TEXT,
    skill_id            TEXT REFERENCES skills(id),
    grade_level         TEXT,
    school_id           TEXT REFERENCES schools(id),
    created_by_user_id  TEXT NOT NULL REFERENCES users(id),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_curriculum_units_school ON curriculum_units(school_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_units_skill ON curriculum_units(skill_id);

-- =====================================================================
-- Lesson materials: a tutor's own uploaded content library, optionally
-- tagged to a curriculum unit. file_url points at wherever the storage
-- provider put the file (local disk in dev, Cloudinary in production —
-- see src/services/storageProviders).
-- =====================================================================
CREATE TABLE IF NOT EXISTS lesson_materials (
    id                  TEXT PRIMARY KEY,
    tutor_id            TEXT NOT NULL REFERENCES users(id),
    curriculum_unit_id  TEXT REFERENCES curriculum_units(id),
    title               TEXT NOT NULL,
    description         TEXT,
    file_url            TEXT NOT NULL,
    file_type           TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_lesson_materials_tutor ON lesson_materials(tutor_id);
CREATE INDEX IF NOT EXISTS idx_lesson_materials_curriculum ON lesson_materials(curriculum_unit_id);

CREATE TABLE IF NOT EXISTS bookings (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT NOT NULL REFERENCES users(id),
    tutor_id    TEXT NOT NULL REFERENCES users(id),
    child_id    TEXT REFERENCES children(id),
    subject     TEXT,
    scheduled_at TEXT,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_parent ON bookings(parent_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tutor ON bookings(tutor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_updated_at ON bookings(updated_at);

CREATE TABLE IF NOT EXISTS auditions (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT NOT NULL REFERENCES users(id),
    tutor_id    TEXT NOT NULL REFERENCES users(id),
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','completed','declined')),
    video_url   TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

-- =====================================================================
-- Assignments: single-row lifecycle (assigned -> submitted -> graded)
-- rather than a separate submissions table — simpler for a first
-- version, and a child/parent can resubmit by updating the same row
-- up until it's graded.
-- =====================================================================
CREATE TABLE IF NOT EXISTS assignments (
    id                   TEXT PRIMARY KEY,
    tutor_id             TEXT NOT NULL REFERENCES users(id),
    child_id             TEXT NOT NULL REFERENCES children(id),
    booking_id           TEXT REFERENCES bookings(id),
    curriculum_unit_id   TEXT REFERENCES curriculum_units(id),
    title                TEXT NOT NULL,
    instructions         TEXT,
    due_at               TEXT,
    status               TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'submitted', 'graded')),
    submission_content   TEXT,
    submission_file_url  TEXT,
    submitted_at         TEXT,
    submitted_by_user_id TEXT REFERENCES users(id),
    grade                TEXT,
    feedback             TEXT,
    graded_at            TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_assignments_tutor ON assignments(tutor_id);
CREATE INDEX IF NOT EXISTS idx_assignments_child ON assignments(child_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);

CREATE INDEX IF NOT EXISTS idx_auditions_updated_at ON auditions(updated_at);

-- =====================================================================
-- Referrals: captures the marketer attribution at signup time.
-- Bonus calculation logic is intentionally NOT implemented yet
-- (per your call) — only attribution + status tracking.
-- =====================================================================
CREATE TABLE IF NOT EXISTS referrals (
    id                  TEXT PRIMARY KEY,
    new_user_id         TEXT NOT NULL UNIQUE REFERENCES users(id),
    marketer_identifier TEXT NOT NULL,     -- raw email/phone/code as entered at signup
    marketer_user_id    TEXT,              -- resolved marketer account, if found
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','converted','unresolved','invalid')),
    bonus_amount        REAL,              -- left null; filled in once a bonus model is decided
    bonus_status        TEXT NOT NULL DEFAULT 'not_calculated' CHECK (bonus_status IN ('not_calculated','pending','approved','paid')),
    converted_at        TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT,
    FOREIGN KEY (marketer_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_marketer ON referrals(marketer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_updated_at ON referrals(updated_at);

-- Refresh tokens for JWT rotation (supports the mobile app staying
-- logged in offline for long periods).
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    token_hash  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- =====================================================================
-- Payments & payouts
--   * A payment is money moving parent -> platform for one booking.
--   * A payout is money moving platform -> tutor, batching every
--     successful payment for that tutor that hasn't been paid out yet
--     (payout_id IS NULL means "still owed to the tutor").
--   * provider/provider_reference let this work against a real gateway
--     (Paystack) or the local 'mock' provider used in development.
-- =====================================================================
CREATE TABLE IF NOT EXISTS payouts (
    id                   TEXT PRIMARY KEY,
    tutor_id             TEXT NOT NULL REFERENCES users(id),
    amount               REAL NOT NULL,
    currency             TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','failed')),
    provider             TEXT NOT NULL,          -- 'paystack' | 'mock'
    provider_reference   TEXT,
    initiated_by_user_id TEXT REFERENCES users(id), -- which admin triggered it
    paid_at              TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at            TEXT
);

CREATE INDEX IF NOT EXISTS idx_payouts_tutor ON payouts(tutor_id);
CREATE INDEX IF NOT EXISTS idx_payouts_updated_at ON payouts(updated_at);

-- =====================================================================
-- Notifications: an audit trail of every email/SMS sent, regardless of
-- which provider actually sent it. Recorded centrally (not per-provider)
-- so "did this user get notified about X" is always one query away, and
-- so the console provider used in dev/test is genuinely verifiable
-- rather than just trusting a log line.
-- =====================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    channel     TEXT NOT NULL CHECK (channel IN ('email','sms','push','in_app')),
    type        TEXT NOT NULL, -- e.g. 'booking_requested', 'payment_receipt' — see src/services/notifications.js
    subject     TEXT,          -- email only; null for sms
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
    created_at  TEXT NOT NULL,
    read_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

CREATE TABLE IF NOT EXISTS payments (
    id                  TEXT PRIMARY KEY,
    booking_id          TEXT NOT NULL REFERENCES bookings(id),
    parent_id           TEXT NOT NULL REFERENCES users(id),
    tutor_id            TEXT NOT NULL REFERENCES users(id),

    amount              REAL NOT NULL,          -- total the parent pays
    currency            TEXT NOT NULL,
    platform_fee        REAL NOT NULL,           -- platform's cut
    tutor_amount        REAL NOT NULL,           -- amount * (1 - commission)

    provider            TEXT NOT NULL,           -- 'paystack' | 'mock' | 'manual' (manual = direct bank transfer, no gateway)
    provider_reference  TEXT NOT NULL,           -- gateway transaction reference (or a manual_* reference for direct transfer)
    status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','awaiting_confirmation','successful','failed','refunded')),

    -- How the parent chose to pay. 'direct_transfer' is manual (parent transfers to the
    -- platform's bank account and uploads proof; a tutor/admin confirms receipt). The
    -- other three all route through the configured gateway (Paystack), with the gateway's
    -- checkout channel pre-selected to match.
    method               TEXT NOT NULL DEFAULT 'gateway' CHECK (method IN ('direct_transfer','card','ussd','gateway')),
    proof_url            TEXT,                   -- uploaded proof-of-payment file (direct_transfer only)
    proof_uploaded_at    TEXT,
    confirmed_by         TEXT REFERENCES users(id), -- tutor or admin who confirmed a direct transfer

    payout_id           TEXT REFERENCES payouts(id), -- set once this payment has been paid out to the tutor

    initiated_at        TEXT NOT NULL,
    paid_at              TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    deleted_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_tutor ON payments(tutor_id);
CREATE INDEX IF NOT EXISTS idx_payments_parent ON payments(parent_id);
CREATE INDEX IF NOT EXISTS idx_payments_payout ON payments(payout_id);
CREATE INDEX IF NOT EXISTS idx_payments_updated_at ON payments(updated_at);

-- Simple key/value platform settings (e.g. commission_percent), editable
-- by super_admin without a code change.
CREATE TABLE IF NOT EXISTS platform_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- =====================================================================
-- Messaging: child <-> tutor chat, always with the parent as a silent
-- third party who can read everything. Design rules that are load-
-- bearing for child safety, not incidental:
--   * A conversation can only be created if a confirmed/completed
--     booking already exists between that tutor and that specific
--     child — enforced in the controller, not just the UI.
--   * parent_id is a required column on every conversation. The
--     parent's read access isn't a permission flag that can be turned
--     off — it's structural: any query for "messages involving my
--     child" is just "where parent_id = me".
--   * No delete operation exists for messages, by anyone, at the API
--     level. Nothing here should let a conversation be hidden from
--     the parent after the fact.
-- =====================================================================
CREATE TABLE IF NOT EXISTS conversations (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'child_tutor' CHECK (kind IN ('child_tutor', 'parent_tutor')),
    tutor_id    TEXT NOT NULL REFERENCES users(id),
    child_id    TEXT REFERENCES children(id),   -- required for 'child_tutor', NULL for 'parent_tutor'
    parent_id   TEXT NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_tutor ON conversations(tutor_id);
CREATE INDEX IF NOT EXISTS idx_conversations_child ON conversations(child_id);
CREATE INDEX IF NOT EXISTS idx_conversations_parent ON conversations(parent_id);
-- Each kind has its own uniqueness rule; a plain table-level UNIQUE
-- can't express this because Postgres treats every NULL child_id as
-- distinct, which would let duplicate parent_tutor conversations slip through.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_child_tutor_unique ON conversations(tutor_id, child_id) WHERE kind = 'child_tutor';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_parent_tutor_unique ON conversations(tutor_id, parent_id) WHERE kind = 'parent_tutor';

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    sender_id       TEXT NOT NULL REFERENCES users(id),
    sender_role     TEXT NOT NULL CHECK (sender_role IN ('child','tutor','parent')),
    content         TEXT NOT NULL,
    flagged         INTEGER NOT NULL DEFAULT 0,
    flag_reason     TEXT,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_flagged ON messages(flagged);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- =====================================================================
-- Growth & engagement features
-- Design notes:
--   * 'platform_verified' on tutor_profiles is an in-platform review
--     flag set by staff after manually checking a tutor's listed
--     evidence — it is never "certified"/"licensed"/"accredited"
--     wording anywhere in the product, since Lesson Teacher issues no
--     government or third-party credential.
--   * Digital badges awarded to children are completion/engagement
--     recognition only, not academic credentials.
--   * Leaderboards never expose a child outside their own siblings or
--     their own school — see gamificationController for the query
--     scoping that enforces this; the schema alone doesn't prevent a
--     careless cross-family query, so that discipline matters.
-- =====================================================================

ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS platform_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS platform_verified_at TEXT;
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS platform_verified_by TEXT REFERENCES users(id);

-- =====================================================================
-- Reviews: one per completed+paid booking, written by the parent.
-- tutor_profiles.rating/review_count are kept as a running aggregate
-- (recomputed on every insert) so tutor discovery sorting never has to
-- aggregate this table at query time.
-- =====================================================================
CREATE TABLE IF NOT EXISTS reviews (
    id          TEXT PRIMARY KEY,
    booking_id  TEXT NOT NULL UNIQUE REFERENCES bookings(id),
    parent_id   TEXT NOT NULL REFERENCES users(id),
    tutor_id    TEXT NOT NULL REFERENCES users(id),
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment     TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_tutor ON reviews(tutor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_parent ON reviews(parent_id);

-- =====================================================================
-- Badge catalog (platform-defined, admin-managed) + awards.
-- 'category' groups badges for display; none of these imply a
-- government/academic credential — purely platform recognition.
-- =====================================================================
CREATE TABLE IF NOT EXISTS badges (
    id          TEXT PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,   -- stable key, e.g. 'first_lesson', 'streak_7'
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    category    TEXT NOT NULL DEFAULT 'milestone' CHECK (category IN ('milestone','streak','skill','completion')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS user_badges (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),   -- always a 'child' account
    badge_id    TEXT NOT NULL REFERENCES badges(id),
    awarded_at  TEXT NOT NULL,
    meta        TEXT,                                  -- optional JSON, e.g. { "skill_id": "..." }
    UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);

-- =====================================================================
-- Streaks & points: one row per child, updated whenever that child
-- completes a qualifying activity (an assignment submission, or a
-- completed lesson booking) on a given calendar day.
-- =====================================================================
CREATE TABLE IF NOT EXISTS child_streaks (
    child_id         TEXT PRIMARY KEY REFERENCES children(id),
    current_streak   INTEGER NOT NULL DEFAULT 0,
    longest_streak    INTEGER NOT NULL DEFAULT 0,
    total_points     INTEGER NOT NULL DEFAULT 0,
    last_activity_on TEXT,              -- date only, e.g. '2026-10-03'
    updated_at       TEXT NOT NULL
);

-- =====================================================================
-- Subscription tiers. Plans are admin-defined; a subscription can
-- belong to a parent (priority booking / unlimited messaging / a
-- booking discount) or to a school (B2B seat-based access to the
-- platform's existing school_admin tooling) — scope is whichever of
-- subscriber_user_id / school_id is set.
-- =====================================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
    id              TEXT PRIMARY KEY,
    code            TEXT UNIQUE NOT NULL,     -- e.g. 'parent_plus', 'school_standard'
    name            TEXT NOT NULL,
    audience        TEXT NOT NULL CHECK (audience IN ('parent','school')),
    price           REAL NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'NGN',
    interval        TEXT NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly','yearly')),
    benefits        TEXT,                      -- JSON array of benefit strings, shown to the buyer
    booking_discount_percent REAL NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id                  TEXT PRIMARY KEY,
    plan_id             TEXT NOT NULL REFERENCES subscription_plans(id),
    subscriber_user_id  TEXT REFERENCES users(id),     -- set for a parent subscription
    school_id           TEXT REFERENCES schools(id),   -- set for a school (B2B) subscription
    status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','cancelled','expired')),
    current_period_end  TEXT NOT NULL,
    -- The charge for the current period. Not every payment here is tied
    -- to a booking (a subscription isn't), so this is tracked directly
    -- rather than joined through the booking-scoped `payments` table.
    provider            TEXT,
    provider_reference  TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_subscriber ON user_subscriptions(subscriber_user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_school ON user_subscriptions(school_id);

-- =====================================================================
-- Satisfaction guarantee: a parent can ask for a refund or a free
-- reschedule within a configurable window after a completed, paid
-- lesson. This is a ToS-backed policy, not an insurance product —
-- resolution is a manual admin/tutor decision, never automatic.
-- =====================================================================
CREATE TABLE IF NOT EXISTS refund_requests (
    id              TEXT PRIMARY KEY,
    booking_id      TEXT NOT NULL REFERENCES bookings(id),
    payment_id      TEXT NOT NULL REFERENCES payments(id),
    requested_by    TEXT NOT NULL REFERENCES users(id),
    reason          TEXT NOT NULL,
    resolution      TEXT NOT NULL DEFAULT 'refund' CHECK (resolution IN ('refund','reschedule')),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','completed')),
    resolved_by     TEXT REFERENCES users(id),
    resolution_note TEXT,
    resolved_at     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_booking ON refund_requests(booking_id);
CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests(status);

-- =====================================================================
-- Premium content packs: a tutor can price an individual lesson
-- material; a parent/child must hold a successful purchase row to
-- access the file (free materials need no purchase row at all).
-- =====================================================================
ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS is_premium INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS price REAL;
ALTER TABLE lesson_materials ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'NGN';

CREATE TABLE IF NOT EXISTS material_purchases (
    id                  TEXT PRIMARY KEY,
    material_id         TEXT NOT NULL REFERENCES lesson_materials(id),
    buyer_id            TEXT NOT NULL REFERENCES users(id),   -- the parent who paid
    provider            TEXT,
    provider_reference  TEXT,
    created_at          TEXT NOT NULL,
    UNIQUE(material_id, buyer_id)
);

-- =====================================================================
-- Fast/flexible payouts: a tutor may request an already-earned,
-- not-yet-paid-out balance as an instant payout for a small fee,
-- instead of waiting for the regular payout batch.
-- =====================================================================
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS speed TEXT NOT NULL DEFAULT 'standard' CHECK (speed IN ('standard','instant'));
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS instant_fee REAL NOT NULL DEFAULT 0;

-- =====================================================================
-- Tutor location + teaching mode (for discovery filters: city/country,
-- and whether the tutor teaches online, in person, or both).
-- =====================================================================
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS teaches_online INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS teaches_in_person INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_tutor_profiles_city ON tutor_profiles(city);

-- =====================================================================
-- Adult students (18+) who use the platform directly, without a parent
-- account, plus mandatory identity verification for every user (hard
-- gate: bookings/auditions/payouts are blocked until a super_admin
-- approves the uploaded ID). Verification status is re-read from the
-- DB on every gated request rather than trusted from the JWT, since it
-- can change after a token was issued.
-- =====================================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin','school_admin','parent','tutor','child','adult_student'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_verification_status TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_verification_status_check;
ALTER TABLE users ADD CONSTRAINT users_id_verification_status_check
  CHECK (id_verification_status IN ('unverified','pending','verified','rejected'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_rejection_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_verified_at TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS id_verified_by TEXT REFERENCES users(id);
-- Didit KYC session tracking (provider-side reference for the
-- verification session, kept distinct from our own approval status
-- since Didit's own check can run automatically while the final
-- platform approval below still requires a super_admin's sign-off).
ALTER TABLE users ADD COLUMN IF NOT EXISTS didit_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_id_verification_status ON users(id_verification_status);

-- "Post a search": a parent or adult student posts a lesson request;
-- tutors browse open requests and apply with a message/proposed rate;
-- the poster accepts an application, which auto-creates a normal
-- booking (reusing the existing booking/payment flow).
CREATE TABLE IF NOT EXISTS lesson_requests (
    id              TEXT PRIMARY KEY,
    requester_id    TEXT NOT NULL REFERENCES users(id),  -- parent or adult_student
    child_id        TEXT REFERENCES children(id),         -- optional: parent posting for a specific child
    title           TEXT NOT NULL,
    description     TEXT,
    skill_id        TEXT REFERENCES skills(id),
    grade_level     TEXT,
    min_budget      REAL,
    max_budget      REAL,
    currency        TEXT DEFAULT 'NGN',
    city            TEXT,
    online          INTEGER NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_lesson_requests_status ON lesson_requests(status);
CREATE INDEX IF NOT EXISTS idx_lesson_requests_skill ON lesson_requests(skill_id);
CREATE INDEX IF NOT EXISTS idx_lesson_requests_requester ON lesson_requests(requester_id);

CREATE TABLE IF NOT EXISTS lesson_request_applications (
    id              TEXT PRIMARY KEY,
    request_id      TEXT NOT NULL REFERENCES lesson_requests(id),
    tutor_id        TEXT NOT NULL REFERENCES users(id),
    message         TEXT,
    proposed_rate   REAL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    booking_id      TEXT REFERENCES bookings(id),
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE (request_id, tutor_id)
);
CREATE INDEX IF NOT EXISTS idx_lra_request ON lesson_request_applications(request_id);
CREATE INDEX IF NOT EXISTS idx_lra_tutor ON lesson_request_applications(tutor_id);

-- Payscrow as an additional escrow payment provider alongside Paystack
-- (provider name is selected via PAYMENT_PROVIDER env, same pattern as
-- the existing paystack/mock providers).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payscrow_transaction_ref TEXT;

-- =====================================================================
-- Push notifications (FCM for Android/web, APNs via FCM for iOS — a
-- single device-token table either way, since Expo's push service and
-- raw FCM both key off one token string per installed app instance).
-- =====================================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_channel_check
  CHECK (channel IN ('email','sms','push','in_app'));

CREATE TABLE IF NOT EXISTS push_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    token       TEXT NOT NULL UNIQUE,
    platform    TEXT NOT NULL DEFAULT 'unknown' CHECK (platform IN ('ios','android','web','unknown')),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

-- =====================================================================
-- Tutor geo-coordinates, for real radius-based "near me" search.
-- PostGIS isn't available in every deployment target, so distance is
-- computed with the Haversine formula in plain SQL (see tutorController's
-- list()) rather than a geography column — good enough at this scale and
-- needs no extension.
-- =====================================================================
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
CREATE INDEX IF NOT EXISTS idx_tutor_profiles_geo ON tutor_profiles(latitude, longitude);

-- =====================================================================
-- Password reset tokens. Same hashed-token-at-rest pattern as
-- refresh_tokens (see jwt.js's hashToken): only the raw token sent in the
-- reset email/SMS can redeem a row, so a DB read alone never leaks a
-- usable credential. Short-lived (1 hour) and single-use (`used`).
-- =====================================================================
CREATE TABLE IF NOT EXISTS password_resets (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    token_hash  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets(token_hash);

-- =====================================================================
-- Email verification. Same hashed-token-at-rest pattern as
-- password_resets. `email_verified_at` is NULL until the owner proves
-- they control the address; it is NOT a login gate (unlike
-- id_verification_status, which already gates sensitive actions) — this
-- is lighter-weight, just enough to know an address is real before
-- relying on it for delivery.
-- =====================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TEXT;

CREATE TABLE IF NOT EXISTS email_verifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    token_hash  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_token_hash ON email_verifications(token_hash);

-- =====================================================================
-- "Lesson starting soon" reminders. `reminder_sent_at` is a simple
-- once-only guard: scripts/sendLessonReminders.js runs on a schedule (an
-- external cron, not managed by this process — see the script's header),
-- selects confirmed bookings whose scheduled_at falls inside its lookahead
-- window and that haven't been reminded yet, notifies both parties, and
-- stamps this column so the next run doesn't double-send.
-- =====================================================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminder_sent_at TEXT;

-- =====================================================================
-- Tutor weekly availability. A tutor publishes a set of recurring weekly
-- windows (e.g. "Mon 14:00-17:00") rather than individual calendar dates —
-- simple to manage and enough for parents to see when a tutor is
-- generally free before requesting a booking. Not enforced against
-- bookings (no hard conflict check yet): it's informational, the same way
-- a tutor's listed rate doesn't block a booking at a different price.
-- =====================================================================
CREATE TABLE IF NOT EXISTS tutor_availability (
    id          TEXT PRIMARY KEY,
    tutor_id    TEXT NOT NULL REFERENCES users(id),
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
    start_time  TEXT NOT NULL, -- 'HH:MM', 24h
    end_time    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tutor_availability_tutor ON tutor_availability(tutor_id);

-- =====================================================================
-- Message read receipts. One row per (conversation, user) — not one row
-- per message — tracking only "everything up to this timestamp has been
-- seen", which is all a chat UI needs for an unread count or a "Seen"
-- label. A super_admin or a monitoring parent (read-only on child_tutor
-- threads) can have a row too; it just never affects the other party's
-- unread count, since unread counts only ever count the two actual
-- participants' own reads of each other's messages.
-- =====================================================================
CREATE TABLE IF NOT EXISTS conversation_reads (
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    user_id         TEXT NOT NULL REFERENCES users(id),
    last_read_at    TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
);

-- =====================================================================
-- Saved tutors ("favorites"). Parent/adult_student-only — a shortlist to
-- come back to while comparing tutors, not a relationship that needs a
-- booking first (unlike messaging).
-- =====================================================================
CREATE TABLE IF NOT EXISTS tutor_favorites (
    id          TEXT PRIMARY KEY,
    parent_id   TEXT NOT NULL REFERENCES users(id),
    tutor_id    TEXT NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL,
    UNIQUE (parent_id, tutor_id)
);
CREATE INDEX IF NOT EXISTS idx_tutor_favorites_parent ON tutor_favorites(parent_id);

-- =====================================================================
-- Admin audit log. One row per sensitive super_admin action (suspending a
-- user, changing platform settings, impersonating an account, paying out
-- a tutor manually). Append-only — nothing in this app ever updates or
-- deletes a row here. `details` is a free-form JSON blob of whatever
-- context that action type needs (e.g. the settings fields changed).
-- =====================================================================
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          TEXT PRIMARY KEY,
    admin_id    TEXT NOT NULL REFERENCES users(id),
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    details     TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at);

-- Optional 1-2 minute self-introduction video shown on a tutor's card.
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS intro_video_url TEXT;
ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS intro_video_duration_seconds INTEGER;

-- Assignments for adult students (who have no child record): addressed to the
-- student's own user. Exactly one of child_id / student_user_id is set (enforced in the controller).
ALTER TABLE assignments ALTER COLUMN child_id DROP NOT NULL;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS student_user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_assignments_student ON assignments(student_user_id);
