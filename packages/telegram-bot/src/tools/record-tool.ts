/**
 * Record Tool
 * Records a new expense transaction
 */

import { z } from 'zod';
import { TransactionParser, splitExpense } from '@fintrack-ai/core';
import type { Tool, ToolExecutionResult, ToolContext, LastTransaction } from '@fintrack-ai/core';
import { TransactionStatus } from '../constants.js';
import { getSimilarExamples, getRecentExamples } from '../db/index.js';
import { updateMemoryAfterTransaction } from '../agent/memory-session.js';
import type { Environment } from '../types.js';
import { transactionKeyboard } from './keyboards.js';

// ============================================
// Parameter Schema
// ============================================

const RecordParamsSchema = z.object({
  rawText: z.string().describe('The user\'s original input text describing the expense'),
});

type RecordParams = z.infer<typeof RecordParamsSchema>;

// ============================================
// Tool Implementation
// ============================================

export const recordTool: Tool<RecordParams> = {
  name: 'record_expense',
  description: 'Record a new expense transaction. Use when user mentions spending money, buying something, or paying for a service.',
  parameters: RecordParamsSchema,

  async execute(
    args: RecordParams,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const db = context.db as D1Database;
    const environment = (context as unknown as { readonly environment: Environment }).environment;

    try {
      // Clean input text (remove voice transcription markers)
      const cleanedText = args.rawText.replace(/^🎤\s*[""]?|[""]?\s*$/g, '').trim();

      // Get similar transactions for few-shot learning
      const semanticExamples = await getSimilarExamples(environment, cleanedText, {
        topK: 5,
        minScore: 0.5,
      });

      // Fallback to recent if no semantic matches
      const historyExamples = semanticExamples.length > 0
        ? semanticExamples
        : await getRecentExamples(db, context.userId, 5);

      console.log(`[RecordTool] Using ${semanticExamples.length > 0 ? 'semantic' : 'recent'} examples: ${historyExamples.length}`);

      // Parse transaction
      const parser = new TransactionParser(context.openaiApiKey);
      const { parsed } = await parser.parseNaturalLanguage(
        args.rawText,
        {
          participants: [...context.participants],
          defaultCurrency: context.defaultCurrency,
          defaultLocation: context.defaultLocation,
          examples: historyExamples,
        }
      );

      // Calculate splits
      const splitResult = splitExpense({
        totalAmount: parsed.amount,
        currency: parsed.currency,
        payer: context.payerName,
        participants: [...context.participants],
        excludedParticipants: parsed.excludedParticipants != null
          ? [...parsed.excludedParticipants]
          : [],
        customSplits: parsed.customSplits,
      });

      // Generate transaction ID and timestamp
      const transactionId = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      // Normalize location
      const location = parsed.location != null && parsed.location !== ''
        ? parsed.location
        : null;

      // Insert into database
      await db.prepare(`
        INSERT INTO transactions (
          id, project_id, user_id, chat_id, merchant, amount, currency,
          category, location, card_last_four, payer, is_shared, splits,
          status, created_at, raw_input
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        transactionId,
        context.projectId,
        context.userId,
        context.chatId,
        parsed.merchant,
        parsed.amount,
        parsed.currency,
        parsed.category,
        location,
        parsed.cardLastFour ?? null,
        context.payerName,
        1,
        JSON.stringify(splitResult.shares),
        TransactionStatus.PENDING,
        createdAt,
        args.rawText
      ).run();

      // Update working memory
      const lastTransaction: LastTransaction = {
        id: transactionId,
        merchant: parsed.merchant,
        amount: parsed.amount,
        currency: parsed.currency,
        category: parsed.category,
        createdAt,
      };
      await updateMemoryAfterTransaction(db, context.userId, context.chatId, lastTransaction, args.rawText);

      // Build response content for LLM
      const splitSummary = Object.entries(splitResult.shares)
        .map(([person, share]) => `${person}: $${share.toFixed(2)}`)
        .join(', ');

      const locationText = location != null ? ` in ${location}` : '';

      const content = `Recorded: ${parsed.merchant}${locationText} - $${parsed.amount.toFixed(2)} ${parsed.currency} (${parsed.category}). Split: ${splitSummary}`;

      return {
        content,
        keyboard: transactionKeyboard(transactionId),
      };
    } catch (error) {
      console.error('[RecordTool] Error:', error);
      return {
        content: `Failed to record expense: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};
