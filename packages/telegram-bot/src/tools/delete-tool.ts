/**
 * Delete Tool
 * Deletes an existing transaction
 *
 * Pi Agent-inspired implementation with:
 * - Zod schema for type-safe parameters
 * - Dual return: content (for LLM) + details (for UI)
 */

import { z } from 'zod';
import type { Tool, PiToolResult, PiToolContextWithDb, AgentResult } from '@fintrack-ai/core';
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
  confirmed: z.boolean().nullable()
    .describe('Whether deletion is confirmed (false/null returns confirmation prompt)'),
});

type DeleteParams = z.infer<typeof DeleteParamsSchema>;

// ============================================
// Result Details Schema
// ============================================

interface DeleteDetails {
  readonly transactionId: string;
  readonly merchant: string;
  readonly amount: number;
  readonly deleted: boolean;
  readonly needsConfirmation: boolean;
}

// ============================================
// Tool Implementation
// ============================================

export const deleteTool: Tool<DeleteParams, DeleteDetails, D1Database> = {
  name: 'delete_expense',
  description: 'Delete a transaction. Use when user explicitly wants to remove/delete an expense.',
  parameters: DeleteParamsSchema,

  async execute(
    args: DeleteParams,
    context: PiToolContextWithDb<D1Database>
  ): Promise<PiToolResult<DeleteDetails>> {
    const { db, userId, projectId } = context;

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
            ? 'No recent transaction found to delete'
            : 'Could not find transaction to delete. Please specify which transaction.',
          error: 'Transaction not found',
        };
      }

      // Get transaction details
      const transaction = await db.prepare(`
        SELECT id, merchant, amount
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

      const merchant = transaction.merchant as string;
      const amount = transaction.amount as number;

      // If not confirmed, return confirmation prompt
      if (args.confirmed !== true) {
        return {
          success: true,
          content: `Delete ${merchant} ($${amount.toFixed(2)})? Reply with confirmation to proceed.`,
          details: {
            transactionId,
            merchant,
            amount,
            deleted: false,
            needsConfirmation: true,
          },
        };
      }

      // Execute deletion (soft delete by setting status)
      await db.prepare(`
        UPDATE transactions SET status = ? WHERE id = ?
      `).bind(TransactionStatus.DELETED, transactionId).run();

      return {
        success: true,
        content: `Deleted: ${merchant} ($${amount.toFixed(2)})`,
        details: {
          transactionId,
          merchant,
          amount,
          deleted: true,
          needsConfirmation: false,
        },
      };
    } catch (error) {
      console.error('[DeleteTool] Error:', error);
      return {
        success: false,
        content: 'Failed to delete transaction',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  toAgentResult(result: PiToolResult<DeleteDetails>): AgentResult {
    if (!result.success) {
      return { type: 'error', message: result.content };
    }

    const details = result.details;
    if (details == null) {
      return { type: 'message', message: result.content };
    }

    if (details.needsConfirmation) {
      return {
        type: 'confirm',
        message: `Delete *${details.merchant}* ($${details.amount.toFixed(2)})?`,
        keyboard: [
          [
            { text: '\u2705 Yes, Delete', callback_data: `delete_${details.transactionId}` },
            { text: '\u274c Cancel', callback_data: 'menu_main' },
          ],
          [{ text: '\ud83c\udfe0 Menu', callback_data: 'menu_main' }],
        ],
      };
    }

    return {
      type: 'message',
      message: `\u2705 Deleted: ${details.merchant} ($${details.amount.toFixed(2)})`,
    };
  },
};
