/**
 * Modify Tool
 * Modifies an existing transaction
 *
 * Pi Agent-inspired implementation with:
 * - Zod schema for type-safe parameters
 * - Dual return: content (for LLM) + details (for UI)
 */

import { z } from 'zod';
import type { Tool, PiToolResult, PiToolContextWithDb, LastTransaction } from '@fintrack-ai/core';
import { findLastTransaction } from '../agent/query-executor.js';
import { setLastTransaction } from '../agent/memory-session.js';

// ============================================
// Parameter Schema
// ============================================

const ModifyParamsSchema = z.object({
  target: z.enum(['last', 'specific'])
    .describe('Target transaction: "last" for most recent, "specific" for by ID'),
  transactionId: z.string().nullable()
    .describe('Transaction ID (required if target is "specific")'),
  field: z.enum(['amount', 'merchant', 'category', 'split'])
    .describe('Field to modify'),
  newValue: z.union([z.string(), z.number()])
    .describe('New value for the field'),
});

type ModifyParams = z.infer<typeof ModifyParamsSchema>;

// ============================================
// Result Details Schema
// ============================================

interface ModifyDetails {
  readonly transactionId: string;
  readonly field: string;
  readonly oldValue: string | number;
  readonly newValue: string | number;
  readonly merchant: string;
  readonly amount: number;
}

// ============================================
// Extended Context
// ============================================

interface ModifyToolContext extends PiToolContextWithDb<D1Database> {
  readonly chatId: number;
}

// ============================================
// Tool Implementation
// ============================================

export const modifyTool: Tool<ModifyParams, ModifyDetails, D1Database> = {
  name: 'modify_expense',
  description: 'Modify an existing transaction. Use for corrections like "no, I mean X" or "actually it was Y".',
  parameters: ModifyParamsSchema,

  async execute(
    args: ModifyParams,
    context: PiToolContextWithDb<D1Database>
  ): Promise<PiToolResult<ModifyDetails>> {
    const extendedContext = context as ModifyToolContext;
    const { db, userId, projectId, chatId } = extendedContext;

    try {
      // Find target transaction
      const transactionId = await (async (): Promise<string | null> => {
        if (args.target === 'last') {
          const lastTx = await findLastTransaction(db, projectId, userId);
          return lastTx?.id ?? null;
        }
        return args.transactionId;
      })();

      if (transactionId == null) {
        return {
          success: false,
          content: args.target === 'last'
            ? 'No recent transaction found to modify'
            : 'Could not find transaction to modify. Please specify which transaction.',
          error: 'Transaction not found',
        };
      }

      // Verify transaction exists and user has access
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

      // Handle split modification separately (not yet supported)
      if (args.field === 'split') {
        return {
          success: false,
          content: 'Split modification not yet supported via this tool. Use /edit command.',
          error: 'Split modification not supported',
        };
      }

      // Determine column and values based on field
      const fieldConfig: Record<'amount' | 'merchant' | 'category', {
        readonly column: string;
        readonly oldValue: string | number;
        readonly dbValue: string | number;
        readonly formattedNew: string;
        readonly formattedOld: string;
      }> = {
        amount: {
          column: 'amount',
          oldValue: transaction.amount as number,
          dbValue: Number(args.newValue),
          formattedNew: `$${Number(args.newValue).toFixed(2)}`,
          formattedOld: `$${(transaction.amount as number).toFixed(2)}`,
        },
        merchant: {
          column: 'merchant',
          oldValue: transaction.merchant as string,
          dbValue: String(args.newValue),
          formattedNew: String(args.newValue),
          formattedOld: String(transaction.merchant),
        },
        category: {
          column: 'category',
          oldValue: transaction.category as string,
          dbValue: String(args.newValue).toLowerCase(),
          formattedNew: String(args.newValue).toLowerCase(),
          formattedOld: String(transaction.category),
        },
      };

      const config = fieldConfig[args.field];

      // Execute the update using parameterized column (safe: column comes from fieldConfig keys)
      const updateSql = {
        amount: 'UPDATE transactions SET amount = ? WHERE id = ?',
        merchant: 'UPDATE transactions SET merchant = ? WHERE id = ?',
        category: 'UPDATE transactions SET category = ? WHERE id = ?',
      }[args.field];

      await db.prepare(updateSql).bind(config.dbValue, transactionId).run();

      // Fetch updated transaction
      const updatedTx = await db.prepare(`
        SELECT id, merchant, amount, currency, category, created_at
        FROM transactions WHERE id = ?
      `).bind(transactionId).first();

      if (updatedTx == null) {
        return {
          success: false,
          content: 'Transaction update failed unexpectedly',
          error: 'Failed to fetch updated transaction',
        };
      }

      // Update working memory
      const lastTransaction: LastTransaction = {
        id: updatedTx.id as string,
        merchant: updatedTx.merchant as string,
        amount: updatedTx.amount as number,
        currency: updatedTx.currency as string,
        category: updatedTx.category as string,
        createdAt: updatedTx.created_at as string,
      };

      await setLastTransaction(db, userId, chatId, lastTransaction);

      const content = `Updated ${args.field}: ${config.formattedOld} → ${config.formattedNew}. Transaction: ${updatedTx.merchant} $${(updatedTx.amount as number).toFixed(2)}`;

      return {
        success: true,
        content,
        details: {
          transactionId,
          field: args.field,
          oldValue: config.oldValue,
          newValue: config.dbValue,
          merchant: updatedTx.merchant as string,
          amount: updatedTx.amount as number,
        },
      };
    } catch (error) {
      console.error('[ModifyTool] Error:', error);
      return {
        success: false,
        content: 'Failed to modify transaction',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
