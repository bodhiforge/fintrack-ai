/**
 * Modify Category Tool
 * Modifies the category of an existing transaction
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

const ModifyCategoryParamsSchema = z.object({
  target: z.enum(['last', 'specific'])
    .describe('Target transaction: "last" for most recent, "specific" for by ID'),
  transactionId: z.string().nullable()
    .describe('Transaction ID (required if target is "specific")'),
  newCategory: z.string()
    .describe('The corrected category (e.g., dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, sports, education, other)'),
});

type ModifyCategoryParams = z.infer<typeof ModifyCategoryParamsSchema>;

// ============================================
// Extended Context
// ============================================

interface ModifyCategoryToolContext extends PiToolContextWithDb<D1Database> {
  readonly chatId: number;
}

// ============================================
// Tool Implementation
// ============================================

export const modifyCategoryTool: Tool<ModifyCategoryParams, ModifyDetails, D1Database> = {
  name: 'modify_category',
  description: 'Modify the category of an existing transaction. Use when user provides a CATEGORY to correct. Examples: "grocery", "that was dining", "wrong category, it\'s entertainment".',
  parameters: ModifyCategoryParamsSchema,

  async execute(
    args: ModifyCategoryParams,
    context: PiToolContextWithDb<D1Database>
  ): Promise<PiToolResult<ModifyDetails>> {
    const extendedContext = context as ModifyCategoryToolContext;
    const { db, userId, projectId, chatId } = extendedContext;

    try {
      const resolvedId = await resolveTransactionId(args.target, args.transactionId, db, projectId, userId);
      if (typeof resolvedId !== 'string') return resolvedId;

      const transaction = await fetchTransaction(db, resolvedId, projectId);
      if ('success' in transaction) return transaction;

      const normalizedCategory = args.newCategory.toLowerCase();

      return updateFieldAndBuildResult(
        { db, userId, projectId, chatId },
        'category',
        normalizedCategory,
        resolvedId,
        transaction.category
      );
    } catch (error) {
      console.error('[ModifyCategoryTool] Error:', error);
      return {
        success: false,
        content: 'Failed to modify category',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
