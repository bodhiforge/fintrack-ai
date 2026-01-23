/**
 * AI-powered transaction parser
 * Extracts structured data from bank emails and natural language input
 */

import type { ParsedTransaction, ParserResponse, Category, Currency } from './types.js';

// ============================================
// Configuration
// ============================================

const SYSTEM_PROMPT = `You are a precise financial data extractor. Extract transaction information from bank notification emails or natural language descriptions.

Return ONLY valid JSON with these fields:
- merchant: string (store/restaurant name, clean and normalized)
- amount: number (e.g., 50.00, not "50.00")
- currency: string (CAD, USD, EUR, etc. Default to CAD if not specified)
- category: string (one of: dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, other)
- cardLastFour: string (last 4 digits if mentioned, otherwise "unknown")
- date: string (YYYY-MM-DD format, use today's date if not specified)

Category classification rules:
- dining: restaurants, cafes, food delivery (Uber Eats, DoorDash, Skip)
- grocery: supermarkets, grocery stores (Costco food, T&T, Superstore, Whole Foods)
- gas: gas stations, EV charging
- shopping: retail, Amazon, online shopping
- subscription: Netflix, Spotify, software subscriptions
- travel: flights, hotels, Airbnb
- transport: Uber rides, transit, parking
- entertainment: movies, concerts, games
- health: pharmacy, medical
- utilities: phone, internet, electricity
- other: anything else

Merchant normalization:
- "UBER* EATS" → "Uber Eats"
- "AMZN MKTP" → "Amazon"
- "COSTCO WHOLESALE" → "Costco"

Return JSON only. No explanation.`;

// ============================================
// Parser Class
// ============================================

export class TransactionParser {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, options?: { model?: string; baseUrl?: string }) {
    this.apiKey = apiKey;
    this.model = options?.model ?? 'gpt-4o-mini';
    this.baseUrl = options?.baseUrl ?? 'https://api.openai.com/v1';
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
   * Parse natural language input (e.g., "dinner 50 USD at Sukiya")
   */
  async parseNaturalLanguage(text: string): Promise<ParserResponse> {
    return this.parse(text);
  }

  /**
   * Core parsing logic
   */
  private async parse(input: string): Promise<ParserResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        temperature: 0,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const result = await response.json() as {
      choices: Array<{
        message: { content: string };
        finish_reason: string;
      }>;
    };

    const content = result.choices[0]?.message?.content ?? '';

    try {
      // Clean potential markdown code blocks
      const jsonStr = content.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(jsonStr) as ParsedTransaction;

      // Validate and normalize
      const validated = this.validate(parsed);
      const warnings = this.checkWarnings(validated, input);

      return {
        parsed: validated,
        confidence: warnings.length === 0 ? 1.0 : 0.8,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (e) {
      throw new Error(`Failed to parse AI response: ${content}`);
    }
  }

  /**
   * Validate and normalize parsed data
   */
  private validate(parsed: Partial<ParsedTransaction>): ParsedTransaction {
    const today = new Date().toISOString().split('T')[0];

    return {
      merchant: parsed.merchant ?? 'Unknown',
      amount: typeof parsed.amount === 'number' ? parsed.amount : parseFloat(String(parsed.amount)) || 0,
      currency: this.normalizeCurrency(parsed.currency),
      category: this.normalizeCategory(parsed.category),
      cardLastFour: parsed.cardLastFour ?? 'unknown',
      date: parsed.date ?? today,
    };
  }

  /**
   * Normalize currency code
   */
  private normalizeCurrency(currency?: string): Currency {
    if (!currency) return 'CAD';

    const upper = currency.toUpperCase();
    const currencyMap: Record<string, Currency> = {
      'CAD': 'CAD',
      'USD': 'USD',
      'EUR': 'EUR',
      'GBP': 'GBP',
      'MXN': 'MXN',
      'CRC': 'CRC',
      'JPY': 'JPY',
      'PESOS': 'MXN',
      'COLONES': 'CRC',
      'YEN': 'JPY',
    };

    return currencyMap[upper] ?? upper;
  }

  /**
   * Normalize category
   */
  private normalizeCategory(category?: string): Category {
    if (!category) return 'other';

    const lower = category.toLowerCase();
    const validCategories: Category[] = [
      'dining', 'grocery', 'gas', 'shopping', 'subscription',
      'travel', 'transport', 'entertainment', 'health', 'utilities', 'other'
    ];

    return validCategories.includes(lower as Category) ? (lower as Category) : 'other';
  }

  /**
   * Check for potential issues
   */
  private checkWarnings(parsed: ParsedTransaction, originalInput: string): string[] {
    const warnings: string[] = [];

    if (parsed.amount <= 0) {
      warnings.push('Amount is zero or negative');
    }

    if (parsed.amount > 10000) {
      warnings.push('Unusually large amount - please verify');
    }

    if (parsed.merchant === 'Unknown') {
      warnings.push('Could not identify merchant');
    }

    if (parsed.cardLastFour === 'unknown') {
      warnings.push('Card number not detected');
    }

    return warnings;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Quick parse without instantiating a class
 */
export async function parseTransaction(
  apiKey: string,
  input: string,
  options?: { model?: string }
): Promise<ParserResponse> {
  const parser = new TransactionParser(apiKey, options);
  return parser.parseNaturalLanguage(input);
}

/**
 * Parse bank email notification
 */
export async function parseBankEmail(
  apiKey: string,
  emailBody: string,
  emailSubject?: string
): Promise<ParserResponse> {
  const parser = new TransactionParser(apiKey);
  return parser.parseEmail(emailBody, emailSubject);
}
