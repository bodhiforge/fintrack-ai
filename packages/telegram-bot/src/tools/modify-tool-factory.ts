/**
 * Modify Tool Factory
 * Creates modify tools for amount, merchant, and category
 * One factory, three registrations — no copy-paste
 */

import { z } from 'zod';
import type { Tool, PiToolResult, PiToolContextWithDb, AgentResult, LastTransaction } from '@fintrack-ai/core';
import { findLastTransaction } from '../agent/query-executor.js';
import { setLastTransaction } from '../agent/memory-session.js';

// ============================================
// Shared Types
// ============================================

export interface ModifyDetails {
  readonly transactionId: string;
  readonly field: string;
  readonly oldValue: string | number;
  readonly newValue: string | number;
  readonly merchant: string;
  readonly amount: number;
}

interface ModifyToolContext extends PiToolContextWithDb<D1Database> {
  readonly chatId: number;
}

// ============================================
// Factory Config
// ============================================

interface ModifyToolConfig<TParams> {
  readonly name: string;
  readonly description: string;
  readonly field: 'amount' | 'merchant' | 'category';
  readonly parameters: z.ZodSchema<TParams>;
  readonly extractValue: (args: TParams) => string | number;
}

// ============================================
// Shared Keyboard
// ============================================

function transactionKeyboard(transactionId: string): ReadonlyArray<ReadonlyArray<{ text: string; callback_data: string }>> {
  return [
    [
      { text: '\u2705 Confirm', callback_data: `confirm_${transactionId}` },
      { text: '\u270f\ufe0f Edit', callback_data: `edit_${transactionId}` },
    ],
    [
      { text: '\ud83d\udc64 Personal', callback_data: `personal_${transactionId}` },
      { text: '\u274c Delete', callback_data: `delete_${transactionId}` },
    ],
    [{ text: '\ud83c\udfe0 Menu', callback_data: 'menu_main' }],
  ];
}

// ============================================
// Factory
// ============================================

export function createModifyTool<TParams>(
  config: ModifyToolConfig<TParams>
): Tool<TParams, ModifyDetails, D1Database> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,

    async execute(
      args: TParams,
      context: PiToolContextWithDb<D1Database>
    ): Promise<PiToolResult<ModifyDetails>> {
      const { db, userId, projectId, chatId } = context as ModifyToolContext;

      try {
        // Resolve transaction ID
        const baseArgs = args as Record<string, unknown>;
        const target = baseArgs.target as 'last' | 'specific';
        const specifiedId = baseArgs.transactionId as string | null;

        const transactionId = target === 'last'
          ? (await findLastTransaction(db, projectId, userId))?.id ?? null
          : specifiedId;

        if (transactionId == null) {
          return {
            success: false,
            content: target === 'last'
              ? 'No recent transaction found to modify'
              : 'Could not find transaction to modify. Please specify which transaction.',
            error: 'Transaction not found',
          };
        }

        // Fetch transaction
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

        // Extract and apply new value
        const newValue = config.extractValue(args);
        const oldDisplayValue = config.field === 'amount'
          ? `$${(transaction.amount as number).toFixed(2)}`
          : transaction[config.field] as string;

        const updateSql: Record<string, string> = {
          amount: 'UPDATE transactions SET amount = ? WHERE id = ?',
          merchant: 'UPDATE transactions SET merchant = ? WHERE id = ?',
          category: 'UPDATE transactions SET category = ? WHERE id = ?',
        };

        await db.prepare(updateSql[config.field]).bind(newValue, transactionId).run();

        // Fetch updated transaction and refresh working memory
        const updated = await db.prepare(`
          SELECT id, merchant, amount, currency, category, created_at
          FROM transactions WHERE id = ?
        `).bind(transactionId).first();

        if (updated == null) {
          return {
            success: false,
            content: 'Transaction update failed unexpectedly',
            error: 'Failed to fetch updated transaction',
          };
        }

        const lastTransaction: LastTransaction = {
          id: updated.id as string,
          merchant: updated.merchant as string,
          amount: updated.amount as number,
          currency: updated.currency as string,
          category: updated.category as string,
          createdAt: updated.created_at as string,
        };
        await setLastTransaction(db, userId, chatId, lastTransaction);

        const formattedNew = config.field === 'amount'
          ? `$${Number(newValue).toFixed(2)}`
          : String(newValue);

        return {
          success: true,
          content: `Updated ${config.field}: ${oldDisplayValue} \u2192 ${formattedNew}. Transaction: ${updated.merchant} $${(updated.amount as number).toFixed(2)}`,
          details: {
            transactionId,
            field: config.field,
            oldValue: oldDisplayValue,
            newValue,
            merchant: updated.merchant as string,
            amount: updated.amount as number,
          },
        };
      } catch (error) {
        console.error(`[${config.name}] Error:`, error);
        return {
          success: false,
          content: `Failed to modify ${config.field}`,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },

    toAgentResult(result: PiToolResult<ModifyDetails>): AgentResult {
      if (!result.success) {
        return { type: 'error', message: result.content };
      }

      const details = result.details;
      if (details == null) {
        return { type: 'message', message: result.content };
      }

      const formattedNew = details.field === 'amount'
        ? `$${Number(details.newValue).toFixed(2)}`
        : String(details.newValue);

      return {
        type: 'confirm',
        message: `\u2705 Updated *${details.field}*: ${details.oldValue} \u2192 ${formattedNew}\n\n_${details.merchant} \u2022 $${details.amount.toFixed(2)}_`,
        keyboard: transactionKeyboard(details.transactionId),
      };
    },
  };
}

// ============================================
// Three Tools, One Factory
// ============================================

export const modifyAmountTool = createModifyTool({
  name: 'modify_amount',
  description: 'Modify the amount of an existing transaction. Use when user provides a NUMBER to correct the amount. Examples: "40.81", "actually 25", "no it was 15".',
  field: 'amount',
  parameters: z.object({
    target: z.enum(['last', 'specific']).describe('Target transaction: "last" for most recent, "specific" for by ID'),
    transactionId: z.string().nullable().describe('Transaction ID (required if target is "specific")'),
    newAmount: z.number().describe('The corrected amount (a number)'),
  }),
  extractValue: args => args.newAmount,
});

export const modifyMerchantTool = createModifyTool({
  name: 'modify_merchant',
  description: 'Modify the merchant name of an existing transaction. Use when user provides a NAME to correct the merchant. Examples: "H Mart", "no I mean Costco", "that was at Starbucks".',
  field: 'merchant',
  parameters: z.object({
    target: z.enum(['last', 'specific']).describe('Target transaction: "last" for most recent, "specific" for by ID'),
    transactionId: z.string().nullable().describe('Transaction ID (required if target is "specific")'),
    newMerchant: z.string().describe('The corrected merchant name'),
  }),
  extractValue: args => args.newMerchant,
});

export const modifyCategoryTool = createModifyTool({
  name: 'modify_category',
  description: 'Modify the category of an existing transaction. Use when user provides a CATEGORY to correct. Examples: "grocery", "that was dining", "wrong category, it\'s entertainment".',
  field: 'category',
  parameters: z.object({
    target: z.enum(['last', 'specific']).describe('Target transaction: "last" for most recent, "specific" for by ID'),
    transactionId: z.string().nullable().describe('Transaction ID (required if target is "specific")'),
    newCategory: z.string().describe('The corrected category'),
  }),
  extractValue: args => args.newCategory.toLowerCase(),
});
