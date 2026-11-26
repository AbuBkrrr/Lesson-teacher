-- Marketing: tracking links (each has a QR code), every open of the public
-- pitch page with the device that opened it, demo-form leads, follow-up
-- e-mails, and which link/device a new account signed up from.
--
-- Privacy: no raw IP addresses are stored (only a salted hash, to spot
-- repeat networks), location is city-level from an offline IP database, and
-- the device key is a random ID the pitch page keeps in the browser.

CREATE TABLE IF NOT EXISTS marketing_links (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    campaign    TEXT,
    channel     TEXT NOT NULL DEFAULT 'other',
    audience    TEXT NOT NULL DEFAULT 'any' CHECK (audience IN ('any','parent','tutor','school')),
    language    TEXT NOT NULL DEFAULT 'en',
    notes       TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT REFERENCES users(id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketing_opens (
    id            TEXT PRIMARY KEY,
    link_id       TEXT REFERENCES marketing_links(id),
    device_key    TEXT NOT NULL,
    device_source TEXT NOT NULL CHECK (device_source IN ('id','fingerprint')),
    device_no     INTEGER NOT NULL,   -- 1, 2, 3… per link, in order of first open
    open_no       INTEGER NOT NULL,   -- this device's nth open of this link
    device_type   TEXT,               -- mobile | tablet | desktop
    os            TEXT,
    os_version    TEXT,
    browser       TEXT,
    in_app        TEXT,               -- e.g. Facebook, Instagram, TikTok, WhatsApp
    device_model  TEXT,
    screen        TEXT,
    timezone      TEXT,
    language      TEXT,
    referrer      TEXT,
    utm_source    TEXT,
    utm_medium    TEXT,
    utm_campaign  TEXT,
    utm_content   TEXT,
    utm_term      TEXT,
    ip_hash       TEXT,
    country       TEXT,
    region        TEXT,
    city          TEXT,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_opens_link ON marketing_opens(link_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mkt_opens_device ON marketing_opens(device_key);
CREATE INDEX IF NOT EXISTS idx_mkt_opens_created ON marketing_opens(created_at);

CREATE TABLE IF NOT EXISTS marketing_leads (
    id                TEXT PRIMARY KEY,
    link_id           TEXT REFERENCES marketing_links(id),
    device_key        TEXT,
    full_name         TEXT NOT NULL,
    email             TEXT,
    phone             TEXT,
    interest          TEXT NOT NULL DEFAULT 'parent' CHECK (interest IN ('parent','tutor','school','other')),
    message           TEXT,
    consent_marketing INTEGER NOT NULL DEFAULT 0,
    unsubscribe_token TEXT NOT NULL UNIQUE,
    unsubscribed_at   TEXT,
    opens_before      INTEGER NOT NULL DEFAULT 0, -- how many times this device had opened the page
    country           TEXT,
    city              TEXT,
    converted_user_id TEXT REFERENCES users(id),
    last_emailed_at   TEXT,
    created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mkt_leads_created ON marketing_leads(created_at);
CREATE INDEX IF NOT EXISTS idx_mkt_leads_email ON marketing_leads(lower(email));

CREATE TABLE IF NOT EXISTS marketing_emails (
    id          TEXT PRIMARY KEY,
    subject     TEXT NOT NULL,
    body        TEXT NOT NULL,
    sent_count  INTEGER NOT NULL DEFAULT 0,
    skipped     INTEGER NOT NULL DEFAULT 0,
    created_by  TEXT REFERENCES users(id),
    created_at  TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_link_id TEXT REFERENCES marketing_links(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_device_key TEXT;
CREATE INDEX IF NOT EXISTS idx_users_signup_link ON users(signup_link_id) WHERE signup_link_id IS NOT NULL;
