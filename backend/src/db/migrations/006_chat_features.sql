-- Chat features: attachments, replies, reactions, disappearing messages, presence, linked devices.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS disappear_after_seconds INTEGER;

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id),
    emoji      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TEXT;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS device_label TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at TEXT;

CREATE TABLE IF NOT EXISTS device_links (
    code        TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    label       TEXT,
    user_id     TEXT REFERENCES users(id),
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','claimed')),
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
