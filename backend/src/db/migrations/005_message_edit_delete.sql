-- Edit / delete-for-everyone. Originals are retained for child-safety review
-- (visible to monitoring parents and admins only), never to chat participants.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS original_content TEXT;
