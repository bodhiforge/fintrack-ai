/**
 * Delete Tool
 * Soft-deletes an existing transaction
 */

import { z } from 'zod';
import type { Tool, ToolExecutionResult, ToolContext } from '@fintrack-ai/core';
import { findLastTransaction } from '../agent/query-executor.js';
import { TransactionStatus } from '../constants.js';

// ============================================
// Parameter Schema
// ============================================

const DeleteParamsSchema = z.object({
  target: z.enum(['last', 'specific'])
    .describe('Target transaction: "last" for most recent, "specific" for by ID'),
  transactionId: z.string().nullable()
    .describe('Transaction ID (required if target is "specific")'),
});

type DeleteParams = z.infer<typeof DeleteParamsSchema>;

// ============================================
// Tool Implementation
// ============================================

export const deleteTool: Tool<DeleteParams> = {
  name: 'delete_expense',
  description: 'Delete a transaction. Use when user explicitly wants to remove/delete an expense.',
  parameters: DeleteParamsSchema,

  async execute(
    args: DeleteParams,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const db = context.db as D1Database;

    try {
      // Find target transaction
      const transactionId = await (async (): Promise<string | null> => {
        if (args.target === 'last') {
          const lastTx = await findLastTransaction(db, context.projectId, context.userId);
          return lastTx?.id ?? null;
        }
        return args.transactionId;
      })();

      if (transactionId == null) {
        return {
          content: args.target === 'last'
            ? 'No recent transaction found to delete'
            : 'Could not find transaction to delete. Please specify which transaction.',
        };
      }

      // Get transaction details
      const transaction = await db.prepare(`
        SELECT id, merchant, amount
        FROM transactions
        WHERE id = ? AND project_id = ? AND status IN ('pending', 'confirmed', 'personal')
      `).bind(transactionId, context.projectId).first();

      if (transaction == null) {
        return { content: 'Transaction not found or already deleted' };
      }

      // Execute soft delete
      await db.prepare(`
        UPDATE transactions SET status = ? WHERE id = ?
      `).bind(TransactionStatus.DELETED, transactionId).run();

      const merchant = transaction.merchant as string;
      const amount = transaction.amount as number;

      return {
        content: `Deleted: ${merchant} ($${amount.toFixed(2)})`,
      };
    } catch (error) {
      console.error('[DeleteTool] Error:', error);
      return {
        content: `Failed to delete transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};
