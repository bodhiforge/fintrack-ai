-- Migration 002: Add Project System
-- Run: npx wrangler d1 execute fintrack-db --file=migrations/002_projects.sql --remote

-- Users table (Telegram users)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,           -- Telegram user ID
  username TEXT,
  first_name TEXT,
  current_project_id TEXT,          -- Active project
  created_at TEXT NOT NULL
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'ongoing',      -- ongoing / trip / event
  default_currency TEXT DEFAULT 'CAD',
  default_location TEXT,
  invite_code TEXT UNIQUE,
  owner_id INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL
);

-- Project Members table
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT DEFAULT 'member',       -- owner / member
  joined_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

-- Add columns to transactions (SQLite doesn't support IF NOT EXISTS for ALTER)
-- These will fail silently if columns already exist
ALTER TABLE transactions ADD COLUMN project_id TEXT;
ALTER TABLE transactions ADD COLUMN location TEXT;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_project_status ON transactions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_users_current ON users(current_project_id);
CREATE INDEX IF NOT EXISTS idx_projects_invite ON projects(invite_code);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);

-- Create default project for existing data
INSERT OR IGNORE INTO projects (id, name, type, default_currency, invite_code, owner_id, created_at)
VALUES ('default', 'Daily', 'ongoing', 'CAD', 'DAILY1', 7511659357, datetime('now'));

-- Create users for existing allowed users
INSERT OR IGNORE INTO users (id, first_name, current_project_id, created_at)
VALUES (7511659357, 'Bodhi', 'default', datetime('now'));

INSERT OR IGNORE INTO users (id, first_name, current_project_id, created_at)
VALUES (5347556412, 'Sherry', 'default', datetime('now'));

-- Add existing users to default project
INSERT OR IGNORE INTO project_members (project_id, user_id, display_name, role, joined_at)
VALUES ('default', 7511659357, 'Bodhi', 'owner', datetime('now'));

INSERT OR IGNORE INTO project_members (project_id, user_id, display_name, role, joined_at)
VALUES ('default', 5347556412, 'Sherry', 'member', datetime('now'));

-- Link existing transactions to default project
UPDATE transactions SET project_id = 'default' WHERE project_id IS NULL;
