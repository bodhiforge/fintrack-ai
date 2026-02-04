/**
 * Record Tool
 * Records a new expense transaction
 *
 * Pi Agent-inspired implementation with:
 * - Zod schema for type-safe parameters
 * - Dual return: content (for LLM) + details (for UI)
 */

import { z } from 'zod';
import { TransactionParser, splitExpense } from '@fintrack-ai/core';
import type { Tool, PiToolResult, PiToolContextWithDb } from '@fintrack-ai/core';
import type { LastTransaction } from '@fintrack-ai/core';
import { TransactionStatus } from '../constants.js';
import { getSimilarExamples, getRecentExamples } from '../db/index.js';
import { updateMemoryAfterTransaction } from '../agent/memory-session.js';
import type { Environment } from '../types.js';

// ============================================
// Parameter Schema
// ============================================

const RecordParamsSchema = z.object({
  rawText: z.string().describe('The user\'s original input text describing the expense'),
});

type RecordParams = z.infer<typeof RecordParamsSchema>;

// ============================================
// Result Details Schema
// ============================================

interface RecordDetails {
  readonly transactionId: string;
  readonly merchant: string;
  readonly amount: number;
  readonly currency: string;
  readonly category: string;
  readonly splits: Readonly<Record<string, number>>;
  readonly needsClarification: boolean;
  readonly lowConfidenceFields?: readonly string[];
}

// ============================================
// Extended Context (with Environment)
// ============================================

interface RecordToolContext extends PiToolContextWithDb<D1Database> {
  readonly environment: Environment;
  readonly chatId: number;
  readonly payerName: string;
}

// ============================================
// Tool Implementation
// ============================================

export const recordTool: Tool<RecordParams, RecordDetails, D1Database> = {
  name: 'record_expense',
  description: 'Record a new expense transaction. Use when user mentions spending money, buying something, or paying for a service.',
  parameters: RecordParamsSchema,

  async execute(
    args: RecordParams,
    context: PiToolContextWithDb<D1Database>
  ): Promise<PiToolResult<RecordDetails>> {
    // Type assertion for extended context (telegram-bot specific)
    const extendedContext = context as RecordToolContext;
    const {
      db,
      userId,
      projectId,
      projectName,
      participants,
      defaultCurrency,
      defaultLocation,
      environment,
      chatId,
      payerName,
    } = extendedContext;

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
        : await getRecentExamples(db, userId, 5);

      console.log(`[RecordTool] Using ${semanticExamples.length > 0 ? 'semantic' : 'recent'} examples: ${historyExamples.length}`);

      // Parse transaction using existing parser
      const parser = new TransactionParser(environment.OPENAI_API_KEY);
      const { parsed, confidence, confidenceFactors } = await parser.parseNaturalLanguage(
        args.rawText,
        {
          participants: [...participants],
          defaultCurrency,
          defaultLocation,
          examples: historyExamples,
        }
      );

      // Calculate splits
      const splitResult = splitExpense({
        totalAmount: parsed.amount,
        currency: parsed.currency,
        payer: payerName,
        participants: [...participants],
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
        projectId,
        userId,
        chatId,
        parsed.merchant,
        parsed.amount,
        parsed.currency,
        parsed.category,
        location,
        parsed.cardLastFour ?? null,
        payerName,
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
      await updateMemoryAfterTransaction(db, userId, chatId, lastTransaction, args.rawText);

      // Check confidence for clarification
      const clarificationThreshold = 0.7;
      const lowConfidenceFields = confidenceFactors != null
        ? [
            ...(confidenceFactors.merchant < clarificationThreshold ? ['merchant'] : []),
            ...(confidenceFactors.amount < clarificationThreshold ? ['amount'] : []),
            ...(confidenceFactors.category < clarificationThreshold ? ['category'] : []),
          ]
        : [];

      const needsClarification = lowConfidenceFields.length > 0;

      // Build response content for LLM
      const splitSummary = Object.entries(splitResult.shares)
        .map(([person, share]) => `${person}: $${share.toFixed(2)}`)
        .join(', ');

      const locationText = location != null ? ` in ${location}` : '';
      const clarificationNote = needsClarification
        ? ` (low confidence on: ${lowConfidenceFields.join(', ')})`
        : '';

      const content = `Recorded: ${parsed.merchant}${locationText} - $${parsed.amount.toFixed(2)} ${parsed.currency} (${parsed.category}). Split: ${splitSummary}${clarificationNote}`;

      return {
        success: true,
        content,
        details: {
          transactionId,
          merchant: parsed.merchant,
          amount: parsed.amount,
          currency: parsed.currency,
          category: parsed.category,
          splits: splitResult.shares,
          needsClarification,
          lowConfidenceFields: needsClarification ? lowConfidenceFields : undefined,
        },
      };
    } catch (error) {
      console.error('[RecordTool] Error:', error);
      return {
        success: false,
        content: 'Failed to record expense',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
