-- Working memory for context-aware conversations
-- Stores last transaction, pending clarifications, and recent messages
CREATE TABLE IF NOT EXISTS working_memory (
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  last_transaction TEXT,
  pending_clarification TEXT,
  recent_messages TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (user_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_working_memory_expires ON working_memory(expires_at);
