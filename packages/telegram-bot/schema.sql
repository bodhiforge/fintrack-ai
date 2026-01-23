-- FinTrack AI Transaction Schema

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  chat_id INTEGER NOT NULL,
  merchant TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  category TEXT NOT NULL,
  card_last_four TEXT,
  payer TEXT NOT NULL,
  is_shared INTEGER DEFAULT 1,
  splits TEXT, -- JSON: {"Bodhi": 25, "Sherry": 25}
  notes TEXT,
  status TEXT DEFAULT 'pending', -- pending, confirmed, personal, deleted
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_status ON transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_status ON transactions(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_created_at ON transactions(created_at);
