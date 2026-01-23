-- Migration: Add user_cards table for credit card management
-- Phase 3: User Card Management

-- User's credit cards
CREATE TABLE IF NOT EXISTS user_cards (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,           -- References preset card ID (e.g., 'amex-cobalt')
  last_four TEXT,                  -- Last 4 digits (optional, for identification)
  nickname TEXT,                   -- User's custom name for this card
  is_active INTEGER DEFAULT 1,     -- Active/inactive toggle
  added_at TEXT NOT NULL,

  UNIQUE(user_id, card_id)         -- User can't add same card twice
);

CREATE INDEX IF NOT EXISTS idx_user_cards_user ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_user_cards_active ON user_cards(user_id, is_active);
