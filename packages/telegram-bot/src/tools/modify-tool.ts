/**
 * Modify Tool
 * Single tool to modify amount, merchant, and/or category of an existing transaction
 */

import { z } from 'zod';
import type { Tool, ToolExecutionResult, ToolContext, LastTransaction } from '@fintrack-ai/core';
import { findLastTransaction } from '../agent/query-executor.js';
import { setLastTransaction } from '../agent/memory-session.js';
import { transactionKeyboard } from './keyboards.js';

// ============================================
// Parameter Schema
// ============================================

const ModifyParamsSchema = z.object({
  target: z.enum(['last', 'specific']).describe('Target transaction: "last" for most recent, "specific" for by ID'),
  transactionId: z.string().nullable().describe('Transaction ID (required if target is "specific")'),
  amount: z.number().nullable().describe('New amount if changing amount'),
  merchant: z.string().nullable().describe('New merchant if changing merchant'),
  category: z.string().nullable().describe('New category if changing category'),
});

type ModifyParams = z.infer<typeof ModifyParamsSchema>;

// ============================================
// Tool Implementation
// ============================================

export const modifyTool: Tool<ModifyParams> = {
  name: 'modify_expense',
  description: 'Modify an existing transaction. Can change amount, merchant, and/or category in a single call. Use when user wants to correct or update a transaction.',
  parameters: ModifyParamsSchema,

  async execute(
    args: ModifyParams,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const db = context.db as D1Database;

    try {
      // Resolve transaction ID
      const transactionId = args.target === 'last'
        ? (await findLastTransaction(db, context.projectId, context.userId))?.id ?? null
        : args.transactionId;

      if (transactionId == null) {
        return {
          content: args.target === 'last'
            ? 'No recent transaction found to modify'
            : 'Could not find transaction to modify. Please specify which transaction.',
        };
      }

      // Fetch transaction
      const transaction = await db.prepare(`
        SELECT id, merchant, amount, currency, category
        FROM transactions
        WHERE id = ? AND project_id = ? AND status IN ('pending', 'confirmed', 'personal')
      `).bind(transactionId, context.projectId).first();

      if (transaction == null) {
        return { content: 'Transaction not found or already deleted' };
      }

      // Build dynamic SET clause from non-null fields
      const updates: readonly string[] = [
        ...(args.amount != null ? ['amount = ?'] : []),
        ...(args.merchant != null ? ['merchant = ?'] : []),
        ...(args.category != null ? ['category = ?'] : []),
      ];

      if (updates.length === 0) {
        return { content: 'No fields to update. Specify amount, merchant, or category.' };
      }

      const values: readonly (string | number)[] = [
        ...(args.amount != null ? [args.amount] : []),
        ...(args.merchant != null ? [args.merchant] : []),
        ...(args.category != null ? [args.category.toLowerCase()] : []),
      ];

      await db.prepare(
        `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`
      ).bind(...values, transactionId).run();

      // Fetch updated transaction and refresh working memory
      const updated = await db.prepare(`
        SELECT id, merchant, amount, currency, category, created_at
        FROM transactions WHERE id = ?
      `).bind(transactionId).first();

      if (updated == null) {
        return { content: 'Transaction update failed unexpectedly' };
      }

      const lastTransaction: LastTransaction = {
        id: updated.id as string,
        merchant: updated.merchant as string,
        amount: updated.amount as number,
        currency: updated.currency as string,
        category: updated.category as string,
        createdAt: updated.created_at as string,
      };
      await setLastTransaction(db, context.userId, context.chatId, lastTransaction);

      // Build change description
      const changes: readonly string[] = [
        ...(args.amount != null ? [`amount → $${args.amount.toFixed(2)}`] : []),
        ...(args.merchant != null ? [`merchant → ${args.merchant}`] : []),
        ...(args.category != null ? [`category → ${args.category.toLowerCase()}`] : []),
      ];

      const content = `Updated ${changes.join(', ')}. Transaction: ${updated.merchant} $${(updated.amount as number).toFixed(2)} ${updated.currency} (${updated.category})`;

      return {
        content,
        keyboard: transactionKeyboard(transactionId),
      };
    } catch (error) {
      console.error('[ModifyTool] Error:', error);
      return {
        content: `Failed to modify transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};
