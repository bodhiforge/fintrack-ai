/**
 * AI-powered transaction parser
 * Uses OpenAI Structured Outputs with Zod schema
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { ParsedTransaction, ParserResponse, Category, Currency, HistoryExample, ConfidenceFactors } from './types.js';

// ============================================
// Zod Schema
// ============================================

const ConfidenceSchema = z.object({
  merchant: z.number().min(0).max(1).describe('0-1: How clear is the merchant name (1 = explicit name, 0.5 = inferred, 0.3 = guessed)'),
  amount: z.number().min(0).max(1).describe('0-1: How clear is the amount (1 = explicit, 0.5 = might be ambiguous like "13" could be $1.3 or $13)'),
  category: z.number().min(0).max(1).describe('0-1: How confident is the category match (1 = obvious, 0.5 = educated guess)'),
});

const ExpenseSchema = z.object({
  merchant: z.string().describe('What they paid for - store name, item, or activity'),
  amount: z.number().describe('The amount spent'),
  currency: z.string().describe('Currency code (CAD, USD, EUR, etc.). Use CAD if not specified.'),
  category: z.string().describe('Expense category: dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, sports, education, or other'),
  cardLastFour: z.string().describe('Last 4 digits of card if mentioned, or "unknown"'),
  date: z.string().describe('Date in YYYY-MM-DD format'),
  location: z.string().nullable().describe('City or country if mentioned'),
  excludedParticipants: z.array(z.string()).describe('Names of people NOT splitting this expense. Empty array if none.'),
  customSplits: z.record(z.string(), z.number()).nullable().describe('Custom split amounts per person'),
  confidence: ConfidenceSchema.describe('Your confidence in each extracted field'),
});

type ExpenseOutput = z.infer<typeof ExpenseSchema>;

// ============================================
// System Prompt
// ============================================

const SYSTEM_PROMPT = `You are parsing expense tracking input for a personal finance app.

## Context
Users are logging expenses right after paying. They type quickly using shorthand, abbreviations, mixed languages (English/Chinese), or voice transcription. Your job is to understand their intent and extract structured data.

## User's Mental Model
- They just spent money and want to record it fast
- Input typically contains: WHAT (description) + HOW MUCH (amount)
- Order varies, format is inconsistent, and that's OK
- They may mention who to exclude from splitting the bill

## Guidelines
- merchant: Use their words, never output "unknown". If they say "午饭", use "午饭"
- amount: Extract the numeric value
- category: Infer from context using common sense (coffee → dining, Uber → transport, gym → sports)
- date: Default to today if not specified
- excludedParticipants: Match names exactly from the participant list if provided
- Preserve the user's language (Chinese stays Chinese, English stays English)`;

// ============================================
// Parser Class
// ============================================

export class TransactionParser {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, options?: { model?: string; baseUrl?: string }) {
    this.client = new OpenAI({
      apiKey,
      baseURL: options?.baseUrl,
    });
    this.model = options?.model ?? 'gpt-4o-mini';
  }

  /**
   * Parse a bank email notification
   */
  async parseEmail(emailBody: string, emailSubject?: string): Promise<ParserResponse> {
    const input = emailSubject
      ? `Email subject: ${emailSubject}\nEmail body: ${emailBody}`
      : emailBody;

    return this.parse(input);
  }

  /**
   * Parse natural language input
   */
  async parseNaturalLanguage(
    text: string,
    options?: {
      readonly participants?: readonly string[];
      readonly defaultCurrency?: string;
      readonly defaultLocation?: string;
      readonly examples?: readonly HistoryExample[];
    }
  ): Promise<ParserResponse> {
    const contextParts: string[] = [];

    if (options?.participants != null && options.participants.length > 0) {
      contextParts.push(`Participants in this group: ${options.participants.join(', ')}`);
    }
    if (options?.defaultCurrency != null) {
      contextParts.push(`Default currency (use if not specified): ${options.defaultCurrency}`);
    }
    if (options?.defaultLocation != null) {
      contextParts.push(`Default location (use if not specified): ${options.defaultLocation}`);
    }

    // Add few-shot examples from user's history
    if (options?.examples != null && options.examples.length > 0) {
      const exampleLines = options.examples.map(
        example => `- "${example.input}" → merchant: "${example.merchant}", category: "${example.category}"`
      );
      contextParts.push('');
      contextParts.push('## Your Reference (user\'s past entries, use for personalized inference)');
      contextParts.push(...exampleLines);
    }

    const context = contextParts.length > 0 ? `\n\n${contextParts.join('\n')}` : '';
    return this.parse(text + context);
  }

  /**
   * Core parsing logic using Structured Outputs
   */
  private async parse(input: string): Promise<ParserResponse> {
    const today = new Date().toISOString().split('T')[0];

    const completion = await this.client.beta.chat.completions.parse({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Today's date: ${today}\n\nInput: ${input}` },
      ],
      response_format: zodResponseFormat(ExpenseSchema, 'expense'),
      temperature: 0,
    });

    const parsed = completion.choices[0]?.message?.parsed;

    if (parsed == null) {
      throw new Error('Failed to parse expense from input');
    }

    const validated = this.normalize(parsed);
    const warnings = this.checkWarnings(validated);
    const confidenceFactors: ConfidenceFactors = {
      merchant: parsed.confidence.merchant,
      amount: parsed.confidence.amount,
      category: parsed.confidence.category,
    };

    // Overall confidence is the minimum of all factors
    const minFieldConfidence = Math.min(
      confidenceFactors.merchant,
      confidenceFactors.amount,
      confidenceFactors.category
    );
    const baseConfidence = warnings.length === 0 ? 1.0 : 0.8;
    const overallConfidence = Math.min(baseConfidence, minFieldConfidence);

    return {
      parsed: validated,
      confidence: overallConfidence,
      confidenceFactors,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Normalize parsed data to match our types
   */
  private normalize(parsed: ExpenseOutput): ParsedTransaction {
    return {
      merchant: parsed.merchant || 'Expense',
      amount: parsed.amount,
      currency: this.normalizeCurrency(parsed.currency),
      category: this.normalizeCategory(parsed.category),
      cardLastFour: parsed.cardLastFour || 'unknown',
      date: parsed.date,
      location: parsed.location ?? undefined,
      excludedParticipants: parsed.excludedParticipants.length > 0 ? parsed.excludedParticipants : undefined,
      customSplits: parsed.customSplits ?? undefined,
    };
  }

  private normalizeCurrency(currency: string): Currency {
    const upper = currency.toUpperCase();
    const currencyMap: Record<string, Currency> = {
      'CAD': 'CAD', 'USD': 'USD', 'EUR': 'EUR', 'GBP': 'GBP',
      'MXN': 'MXN', 'CRC': 'CRC', 'JPY': 'JPY',
      'PESOS': 'MXN', 'COLONES': 'CRC', 'YEN': 'JPY',
    };
    return currencyMap[upper] ?? upper;
  }

  private normalizeCategory(category: string): Category {
    return category.toLowerCase().trim() as Category;
  }

  private checkWarnings(parsed: ParsedTransaction): readonly string[] {
    const checks = [
      { condition: parsed.amount <= 0, message: 'Amount is zero or negative' },
      { condition: parsed.amount > 10000, message: 'Unusually large amount - please verify' },
    ];
    return checks.filter(c => c.condition).map(c => c.message);
  }
}

// ============================================
// Utility Functions
// ============================================

export async function parseTransaction(
  apiKey: string,
  input: string,
  options?: { model?: string }
): Promise<ParserResponse> {
  const parser = new TransactionParser(apiKey, options);
  return parser.parseNaturalLanguage(input);
}

export async function parseBankEmail(
  apiKey: string,
  emailBody: string,
  emailSubject?: string
): Promise<ParserResponse> {
  const parser = new TransactionParser(apiKey);
  return parser.parseEmail(emailBody, emailSubject);
}
