/**
 * Transaction Database Helpers
 */

import type { Transaction, Category, Currency } from '@fintrack-ai/core';

// ============================================
// Types
// ============================================

export interface HistoryExample {
  readonly input: string;
  readonly merchant: string;
  readonly category: string;
  readonly currency: string;
}

// ============================================
// History Retrieval for Few-shot Learning
// ============================================

export async function getRecentExamples(
  database: D1Database,
  userId: number,
  limit: number = 10
): Promise<readonly HistoryExample[]> {
  const result = await database.prepare(`
    SELECT raw_input, merchant, category, currency
    FROM transactions
    WHERE user_id = ?
      AND raw_input IS NOT NULL
      AND raw_input != ''
      AND status IN ('confirmed', 'personal')
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(userId, limit).all();

  return (result.results ?? []).map(row => ({
    input: row.raw_input as string,
    merchant: row.merchant as string,
    category: row.category as string,
    currency: row.currency as string,
  }));
}

// ============================================
// Row Mappers
// ============================================

export function rowToTransaction(row: Readonly<Record<string, unknown>>): Transaction {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    date: row.created_at as string,
    merchant: row.merchant as string,
    amount: row.amount as number,
    currency: row.currency as Currency,
    category: row.category as Category,
    location: row.location as string | undefined,
    cardLastFour: (row.card_last_four as string) ?? '',
    payer: row.payer as string,
    isShared: row.is_shared === 1,
    splits: row.splits != null ? JSON.parse(row.splits as string) : {},
    createdAt: row.created_at as string,
    confirmedAt: row.confirmed_at as string,
  };
}
