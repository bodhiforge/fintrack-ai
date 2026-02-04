/**
 * Modify Helpers
 * Shared logic for modify tools (amount, merchant, category)
 */

import type { PiToolResult, LastTransaction } from '@fintrack-ai/core';
import { findLastTransaction } from '../agent/query-executor.js';
import { setLastTransaction } from '../agent/memory-session.js';

// ============================================
// Types
// ============================================

export interface ModifyDetails {
  readonly transactionId: string;
  readonly field: string;
  readonly oldValue: string | number;
  readonly newValue: string | number;
  readonly merchant: string;
  readonly amount: number;
}

interface TransactionRecord {
  readonly id: string;
  readonly merchant: string;
  readonly amount: number;
  readonly currency: string;
  readonly category: string;
}

interface ModifyToolContext {
  readonly db: D1Database;
  readonly userId: number;
  readonly projectId: string;
  readonly chatId: number;
}

// ============================================
// Resolve Transaction ID
// ============================================

export async function resolveTransactionId(
  target: 'last' | 'specific',
  transactionId: string | null,
  db: D1Database,
  projectId: string,
  userId: number
): Promise<PiToolResult<ModifyDetails> | string> {
  if (target === 'last') {
    const lastTransaction = await findLastTransaction(db, projectId, userId);
    if (lastTransaction == null) {
      return {
        success: false,
        content: 'No recent transaction found to modify',
        error: 'Transaction not found',
      };
    }
    return lastTransaction.id;
  }

  if (transactionId == null) {
    return {
      success: false,
      content: 'Could not find transaction to modify. Please specify which transaction.',
      error: 'Transaction not found',
    };
  }

  return transactionId;
}

// ============================================
// Fetch Transaction
// ============================================

export async function fetchTransaction(
  db: D1Database,
  transactionId: string,
  projectId: string
): Promise<PiToolResult<ModifyDetails> | TransactionRecord> {
  const transaction = await db.prepare(`
    SELECT id, merchant, amount, currency, category
    FROM transactions
    WHERE id = ? AND project_id = ? AND status IN ('pending', 'confirmed', 'personal')
  `).bind(transactionId, projectId).first();

  if (transaction == null) {
    return {
      success: false,
      content: 'Transaction not found or already deleted',
      error: 'Transaction not found',
    };
  }

  return {
    id: transaction.id as string,
    merchant: transaction.merchant as string,
    amount: transaction.amount as number,
    currency: transaction.currency as string,
    category: transaction.category as string,
  };
}

// ============================================
// Update Field and Build Result
// ============================================

export async function updateFieldAndBuildResult(
  context: ModifyToolContext,
  field: 'amount' | 'merchant' | 'category',
  newValue: number | string,
  transactionId: string,
  oldDisplayValue: string
): Promise<PiToolResult<ModifyDetails>> {
  const { db, userId, chatId } = context;

  const updateSql: Record<string, string> = {
    amount: 'UPDATE transactions SET amount = ? WHERE id = ?',
    merchant: 'UPDATE transactions SET merchant = ? WHERE id = ?',
    category: 'UPDATE transactions SET category = ? WHERE id = ?',
  };

  await db.prepare(updateSql[field]).bind(newValue, transactionId).run();

  const updatedTransaction = await db.prepare(`
    SELECT id, merchant, amount, currency, category, created_at
    FROM transactions WHERE id = ?
  `).bind(transactionId).first();

  if (updatedTransaction == null) {
    return {
      success: false,
      content: 'Transaction update failed unexpectedly',
      error: 'Failed to fetch updated transaction',
    };
  }

  const lastTransaction: LastTransaction = {
    id: updatedTransaction.id as string,
    merchant: updatedTransaction.merchant as string,
    amount: updatedTransaction.amount as number,
    currency: updatedTransaction.currency as string,
    category: updatedTransaction.category as string,
    createdAt: updatedTransaction.created_at as string,
  };

  await setLastTransaction(db, userId, chatId, lastTransaction);

  const formattedNew = field === 'amount'
    ? `$${Number(newValue).toFixed(2)}`
    : String(newValue);

  const content = `Updated ${field}: ${oldDisplayValue} \u2192 ${formattedNew}. Transaction: ${updatedTransaction.merchant} $${(updatedTransaction.amount as number).toFixed(2)}`;

  return {
    success: true,
    content,
    details: {
      transactionId,
      field,
      oldValue: oldDisplayValue,
      newValue,
      merchant: updatedTransaction.merchant as string,
      amount: updatedTransaction.amount as number,
    },
  };
}
