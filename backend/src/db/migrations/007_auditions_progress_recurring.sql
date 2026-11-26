-- Spec gap fill: child profile fields, audition types + parent review,
-- booking skill/duration/price/recurring series, tutor lesson reports and
-- per-child skill progress, tutor skill "advanced" level + several evidence links.

-- Children ------------------------------------------------------------------
ALTER TABLE children ADD COLUMN IF NOT EXISTS age INTEGER CHECK (age IS NULL OR (age BETWEEN 1 AND 25));
ALTER TABLE children ADD COLUMN IF NOT EXISTS school_name TEXT;
ALTER TABLE children ADD COLUMN IF NOT EXISTS learning_needs TEXT;

-- Auditions -----------------------------------------------------------------
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'video';
ALTER TABLE auditions DROP CONSTRAINT IF EXISTS auditions_type_check;
ALTER TABLE auditions ADD CONSTRAINT auditions_type_check CHECK (type IN ('video','live','portfolio','challenge'));
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS child_id TEXT REFERENCES children(id);
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS skill_id TEXT REFERENCES skills(id);
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS brief TEXT;            -- parent's request / challenge task
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS tutor_note TEXT;       -- tutor's note when submitting
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS scheduled_at TEXT;     -- live auditions
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5));
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS feedback TEXT;
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS decision TEXT;
ALTER TABLE auditions DROP CONSTRAINT IF EXISTS auditions_decision_check;
ALTER TABLE auditions ADD CONSTRAINT auditions_decision_check CHECK (decision IS NULL OR decision IN ('accepted','rejected'));
ALTER TABLE auditions ADD COLUMN IF NOT EXISTS decided_at TEXT;
CREATE INDEX IF NOT EXISTS idx_auditions_parent ON auditions(parent_id);
CREATE INDEX IF NOT EXISTS idx_auditions_tutor ON auditions(tutor_id);

-- Bookings ------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS skill_id TEXT REFERENCES skills(id);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price NUMERIC(12,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS series_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_series ON bookings(series_id) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_child ON bookings(child_id);

-- Tutor skills --------------------------------------------------------------
ALTER TABLE tutor_skills DROP CONSTRAINT IF EXISTS tutor_skills_proficiency_check;
ALTER TABLE tutor_skills ADD CONSTRAINT tutor_skills_proficiency_check
    CHECK (proficiency IN ('beginner','intermediate','advanced','expert'));
ALTER TABLE tutor_skills ADD COLUMN IF NOT EXISTS evidence_urls TEXT;  -- JSON array of https links
UPDATE tutor_skills SET evidence_urls = json_build_array(evidence_url)::text
 WHERE evidence_url IS NOT NULL AND evidence_urls IS NULL;

-- Lesson reports: the tutor's record of what happened in a lesson ----------
CREATE TABLE IF NOT EXISTS lesson_reports (
    id          TEXT PRIMARY KEY,
    booking_id  TEXT NOT NULL UNIQUE REFERENCES bookings(id),
    tutor_id    TEXT NOT NULL REFERENCES users(id),
    child_id    TEXT REFERENCES children(id),
    skill_id    TEXT REFERENCES skills(id),
    summary     TEXT NOT NULL,          -- what was covered
    strengths   TEXT,
    next_steps  TEXT,
    homework    TEXT,
    score       INTEGER CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
    engagement  INTEGER CHECK (engagement IS NULL OR (engagement BETWEEN 1 AND 5)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lesson_reports_child ON lesson_reports(child_id);
CREATE INDEX IF NOT EXISTS idx_lesson_reports_tutor ON lesson_reports(tutor_id);

-- Per child, per skill progress (recomputed from completed bookings + reports)
CREATE TABLE IF NOT EXISTS child_skill_progress (
    child_id          TEXT NOT NULL REFERENCES children(id),
    skill_id          TEXT NOT NULL REFERENCES skills(id),
    level             TEXT NOT NULL DEFAULT 'beginner' CHECK (level IN ('beginner','intermediate','advanced','expert')),
    completed_lessons INTEGER NOT NULL DEFAULT 0,
    average_score     NUMERIC(5,2),
    last_lesson_at    TEXT,
    updated_at        TEXT NOT NULL,
    PRIMARY KEY (child_id, skill_id)
);
