-- Idempotent sends for offline-first clients: a message queued offline and retried
-- after a flaky reconnect must be stored exactly once.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_id ON messages(conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL;
