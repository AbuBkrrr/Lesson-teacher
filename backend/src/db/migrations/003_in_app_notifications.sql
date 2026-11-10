-- In-app inbox: notifications gain an 'in_app' channel (always written) and read_at.
-- Also adds 'push', which notifyUser already records but the old CHECK did not allow.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_channel_check CHECK (channel IN ('email','sms','push','in_app'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON notifications(user_id, created_at DESC) WHERE channel = 'in_app';
