/**
 * Modify Merchant Tool
 * Modifies the merchant of an existing transaction
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

const ModifyMerchantParamsSchema = z.object({
  target: z.enum(['last', 'specific'])
    .describe('Target transaction: "last" for most recent, "specific" for by ID'),
  transactionId: z.string().nullable()
    .describe('Transaction ID (required if target is "specific")'),
  newMerchant: z.string()
    .describe('The corrected merchant name'),
});

type ModifyMerchantParams = z.infer<typeof ModifyMerchantParamsSchema>;

// ============================================
// Extended Context
// ============================================

interface ModifyMerchantToolContext extends PiToolContextWithDb<D1Database> {
  readonly chatId: number;
}

// ============================================
// Tool Implementation
// ============================================

export const modifyMerchantTool: Tool<ModifyMerchantParams, ModifyDetails, D1Database> = {
  name: 'modify_merchant',
  description: 'Modify the merchant name of an existing transaction. Use when user provides a NAME to correct the merchant. Examples: "H Mart", "no I mean Costco", "that was at Starbucks".',
  parameters: ModifyMerchantParamsSchema,

  async execute(
    args: ModifyMerchantParams,
    context: PiToolContextWithDb<D1Database>
  ): Promise<PiToolResult<ModifyDetails>> {
    const extendedContext = context as ModifyMerchantToolContext;
    const { db, userId, projectId, chatId } = extendedContext;

    try {
      const resolvedId = await resolveTransactionId(args.target, args.transactionId, db, projectId, userId);
      if (typeof resolvedId !== 'string') return resolvedId;

      const transaction = await fetchTransaction(db, resolvedId, projectId);
      if ('success' in transaction) return transaction;

      return updateFieldAndBuildResult(
        { db, userId, projectId, chatId },
        'merchant',
        args.newMerchant,
        resolvedId,
        transaction.merchant
      );
    } catch (error) {
      console.error('[ModifyMerchantTool] Error:', error);
      return {
        success: false,
        content: 'Failed to modify merchant',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
