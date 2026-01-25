-- Session state for multi-turn conversations
CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (user_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
