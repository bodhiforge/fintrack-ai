/**
 * Memory Session
 * Working memory management for context-aware conversations
 */

import type {
  WorkingMemory,
  LastTransaction,
  ConversationMessage,
  PendingClarification,
} from '@fintrack-ai/core';

// Memory TTL: 10 minutes
const MEMORY_TTL_MS = 10 * 60 * 1000;

// Max recent messages to keep
const MAX_RECENT_MESSAGES = 5;

// ============================================
// Database Row Interface
// ============================================

interface MemoryRow {
  readonly user_id: number;
  readonly chat_id: number;
  readonly last_transaction: string | null;
  readonly pending_clarification: string | null;
  readonly recent_messages: string;
  readonly updated_at: string;
  readonly expires_at: string;
}

// ============================================
// Working Memory CRUD
// ============================================

/**
 * Get working memory for a user/chat session
 */
export async function getWorkingMemory(
  database: D1Database,
  userId: number,
  chatId: number
): Promise<WorkingMemory> {
  const row = await database.prepare(`
    SELECT last_transaction, pending_clarification, recent_messages
    FROM working_memory
    WHERE user_id = ? AND chat_id = ? AND expires_at > datetime('now')
  `).bind(userId, chatId).first<MemoryRow>();

  if (row == null) {
    return {
      lastTransaction: null,
      pendingClarification: null,
      recentMessages: [],
    };
  }

  return {
    lastTransaction: row.last_transaction != null
      ? JSON.parse(row.last_transaction) as LastTransaction
      : null,
    pendingClarification: row.pending_clarification != null
      ? JSON.parse(row.pending_clarification) as PendingClarification
      : null,
    recentMessages: JSON.parse(row.recent_messages) as readonly ConversationMessage[],
  };
}

/**
 * Set the last transaction in working memory
 */
export async function setLastTransaction(
  database: D1Database,
  userId: number,
  chatId: number,
  transaction: LastTransaction
): Promise<void> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MEMORY_TTL_MS).toISOString();

  await database.prepare(`
    INSERT INTO working_memory (user_id, chat_id, last_transaction, pending_clarification, recent_messages, updated_at, expires_at)
    VALUES (?, ?, ?, NULL, '[]', ?, ?)
    ON CONFLICT (user_id, chat_id)
    DO UPDATE SET
      last_transaction = ?,
      updated_at = ?,
      expires_at = ?
  `).bind(
    userId,
    chatId,
    JSON.stringify(transaction),
    now,
    expiresAt,
    JSON.stringify(transaction),
    now,
    expiresAt
  ).run();
}

/**
 * Clear the last transaction from working memory
 */
export async function clearLastTransaction(
  database: D1Database,
  userId: number,
  chatId: number
): Promise<void> {
  await database.prepare(`
    UPDATE working_memory
    SET last_transaction = NULL, updated_at = datetime('now')
    WHERE user_id = ? AND chat_id = ?
  `).bind(userId, chatId).run();
}

/**
 * Set pending clarification in working memory
 */
export async function setPendingClarification(
  database: D1Database,
  userId: number,
  chatId: number,
  clarification: PendingClarification
): Promise<void> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MEMORY_TTL_MS).toISOString();

  await database.prepare(`
    INSERT INTO working_memory (user_id, chat_id, last_transaction, pending_clarification, recent_messages, updated_at, expires_at)
    VALUES (?, ?, NULL, ?, '[]', ?, ?)
    ON CONFLICT (user_id, chat_id)
    DO UPDATE SET
      pending_clarification = ?,
      updated_at = ?,
      expires_at = ?
  `).bind(
    userId,
    chatId,
    JSON.stringify(clarification),
    now,
    expiresAt,
    JSON.stringify(clarification),
    now,
    expiresAt
  ).run();
}

/**
 * Clear pending clarification from working memory
 */
export async function clearPendingClarification(
  database: D1Database,
  userId: number,
  chatId: number
): Promise<void> {
  await database.prepare(`
    UPDATE working_memory
    SET pending_clarification = NULL, updated_at = datetime('now')
    WHERE user_id = ? AND chat_id = ?
  `).bind(userId, chatId).run();
}

/**
 * Add a message to the conversation history
 */
export async function addMessage(
  database: D1Database,
  userId: number,
  chatId: number,
  role: 'user' | 'assistant',
  content: string
): Promise<void> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MEMORY_TTL_MS).toISOString();

  // Get current messages
  const currentMemory = await getWorkingMemory(database, userId, chatId);

  // Add new message and keep only last N
  const newMessage: ConversationMessage = {
    role,
    content,
    timestamp: now,
  };

  const updatedMessages = [
    ...currentMemory.recentMessages,
    newMessage,
  ].slice(-MAX_RECENT_MESSAGES);

  await database.prepare(`
    INSERT INTO working_memory (user_id, chat_id, last_transaction, pending_clarification, recent_messages, updated_at, expires_at)
    VALUES (?, ?, NULL, NULL, ?, ?, ?)
    ON CONFLICT (user_id, chat_id)
    DO UPDATE SET
      recent_messages = ?,
      updated_at = ?,
      expires_at = ?
  `).bind(
    userId,
    chatId,
    JSON.stringify(updatedMessages),
    now,
    expiresAt,
    JSON.stringify(updatedMessages),
    now,
    expiresAt
  ).run();
}

/**
 * Update working memory after a transaction is created
 * Sets last transaction and adds user message
 */
export async function updateMemoryAfterTransaction(
  database: D1Database,
  userId: number,
  chatId: number,
  transaction: LastTransaction,
  userMessage: string
): Promise<void> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MEMORY_TTL_MS).toISOString();

  // Get current messages
  const currentMemory = await getWorkingMemory(database, userId, chatId);

  // Add user message
  const newMessage: ConversationMessage = {
    role: 'user',
    content: userMessage,
    timestamp: now,
  };

  const updatedMessages = [
    ...currentMemory.recentMessages,
    newMessage,
  ].slice(-MAX_RECENT_MESSAGES);

  await database.prepare(`
    INSERT INTO working_memory (user_id, chat_id, last_transaction, pending_clarification, recent_messages, updated_at, expires_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT (user_id, chat_id)
    DO UPDATE SET
      last_transaction = ?,
      pending_clarification = NULL,
      recent_messages = ?,
      updated_at = ?,
      expires_at = ?
  `).bind(
    userId,
    chatId,
    JSON.stringify(transaction),
    JSON.stringify(updatedMessages),
    now,
    expiresAt,
    JSON.stringify(transaction),
    JSON.stringify(updatedMessages),
    now,
    expiresAt
  ).run();
}

/**
 * Extend memory TTL (called on each interaction)
 */
export async function extendMemoryTTL(
  database: D1Database,
  userId: number,
  chatId: number
): Promise<void> {
  const expiresAt = new Date(Date.now() + MEMORY_TTL_MS).toISOString();

  await database.prepare(`
    UPDATE working_memory
    SET expires_at = ?, updated_at = datetime('now')
    WHERE user_id = ? AND chat_id = ?
  `).bind(expiresAt, userId, chatId).run();
}

/**
 * Clean up expired memory entries
 */
export async function cleanupExpiredMemory(database: D1Database): Promise<number> {
  const result = await database.prepare(`
    DELETE FROM working_memory
    WHERE expires_at < datetime('now')
  `).run();

  return result.meta.changes ?? 0;
}
