-- Live lesson extras: in-call chat (kept for parent oversight, like other
-- child conversations) and the shared whiteboard saved per booking.
CREATE TABLE IF NOT EXISTS lesson_call_messages (
    id          TEXT PRIMARY KEY,
    booking_id  TEXT NOT NULL REFERENCES bookings(id),
    sender_id   TEXT NOT NULL REFERENCES users(id),
    sender_role TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lesson_call_messages_booking ON lesson_call_messages(booking_id, created_at);

CREATE TABLE IF NOT EXISTS lesson_whiteboards (
    booking_id  TEXT PRIMARY KEY REFERENCES bookings(id),
    strokes     TEXT NOT NULL DEFAULT '[]',  -- JSON array of strokes, coordinates normalised 0..1
    updated_at  TEXT NOT NULL
);
