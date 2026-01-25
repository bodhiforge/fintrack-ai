/**
 * Session State Management
 * Stores conversation state in D1 for multi-turn interactions
 */

import type { Session, SessionState } from '@fintrack-ai/core';

// Session TTL: 5 minutes
const SESSION_TTL_MS = 5 * 60 * 1000;

// ============================================
// Session CRUD Operations
// ============================================

/**
 * Get active session for user/chat
 * Returns null if no session or expired
 */
export async function getSession(
  database: D1Database,
  userId: number,
  chatId: number
): Promise<Session | null> {
  const row = await database.prepare(`
    SELECT state, created_at, expires_at
    FROM sessions
    WHERE user_id = ? AND chat_id = ? AND expires_at > datetime('now')
  `).bind(userId, chatId).first();

  if (row == null) {
    return null;
  }

  return {
    userId,
    chatId,
    state: JSON.parse(row.state as string) as SessionState,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  };
}

/**
 * Create or update session state
 */
export async function updateSession(
  database: D1Database,
  userId: number,
  chatId: number,
  state: SessionState
): Promise<void> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await database.prepare(`
    INSERT INTO sessions (user_id, chat_id, state, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, chat_id)
    DO UPDATE SET state = ?, expires_at = ?
  `).bind(
    userId,
    chatId,
    JSON.stringify(state),
    now,
    expiresAt,
    JSON.stringify(state),
    expiresAt
  ).run();
}

/**
 * Clear session (set to idle or delete)
 */
export async function clearSession(
  database: D1Database,
  userId: number,
  chatId: number
): Promise<void> {
  await database.prepare(`
    DELETE FROM sessions
    WHERE user_id = ? AND chat_id = ?
  `).bind(userId, chatId).run();
}

/**
 * Check if session is in idle state
 */
export function isIdleSession(session: Session | null): boolean {
  return session == null || session.state.type === 'idle';
}

/**
 * Cleanup expired sessions (can be called periodically)
 */
export async function cleanupExpiredSessions(database: D1Database): Promise<number> {
  const result = await database.prepare(`
    DELETE FROM sessions
    WHERE expires_at < datetime('now')
  `).run();

  return result.meta.changes ?? 0;
}
