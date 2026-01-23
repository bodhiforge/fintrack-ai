-- Migration 003: Add invite code expiration
-- Run: npx wrangler d1 execute fintrack-db --file=migrations/003_invite_expiry.sql --remote

-- Add expiration column to projects
ALTER TABLE projects ADD COLUMN invite_expires_at TEXT;

-- Clear existing invite codes (will be regenerated on demand)
UPDATE projects SET invite_code = NULL, invite_expires_at = NULL;
