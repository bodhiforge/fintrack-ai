/**
 * Modify Amount Tool
 * Modifies the amount of an existing transaction
 */

import { z } from 'zod';
import type { Tool, PiToolResult, PiToolContextWithDb } from '@fintrack-ai/core';
import {
  type ModifyDetails,
  resolveTransactionId,
  fetchTransaction,
  updateFieldAndBuildResult,
} from './modify-helpers.js';

// ============================================
// Parameter Schema
// ============================================

const ModifyAmountParamsSchema = z.object({
  target: z.enum(['last', 'specific'])
    .describe('Target transaction: "last" for most recent, "specific" for by ID'),
  transactionId: z.string().nullable()
    .describe('Transaction ID (required if target is "specific")'),
  newAmount: z.number()
    .describe('The corrected amount (a number)'),
});

type ModifyAmountParams = z.infer<typeof ModifyAmountParamsSchema>;

// ============================================
// Extended Context
// ============================================

interface ModifyAmountToolContext extends PiToolContextWithDb<D1Database> {
  readonly chatId: number;
}

// ============================================
// Tool Implementation
// ============================================

export const modifyAmountTool: Tool<ModifyAmountParams, ModifyDetails, D1Database> = {
  name: 'modify_amount',
  description: 'Modify the amount of an existing transaction. Use when user provides a NUMBER to correct the amount. Examples: "40.81", "actually 25", "no it was 15".',
  parameters: ModifyAmountParamsSchema,

  async execute(
    args: ModifyAmountParams,
    context: PiToolContextWithDb<D1Database>
  ): Promise<PiToolResult<ModifyDetails>> {
    const extendedContext = context as ModifyAmountToolContext;
    const { db, userId, projectId, chatId } = extendedContext;

    try {
      const resolvedId = await resolveTransactionId(args.target, args.transactionId, db, projectId, userId);
      if (typeof resolvedId !== 'string') return resolvedId;

      const transaction = await fetchTransaction(db, resolvedId, projectId);
      if ('success' in transaction) return transaction;

      const oldDisplayValue = `$${transaction.amount.toFixed(2)}`;

      return updateFieldAndBuildResult(
        { db, userId, projectId, chatId },
        'amount',
        args.newAmount,
        resolvedId,
        oldDisplayValue
      );
    } catch (error) {
      console.error('[ModifyAmountTool] Error:', error);
      return {
        success: false,
        content: 'Failed to modify amount',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
