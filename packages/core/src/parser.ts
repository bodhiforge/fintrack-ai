/**
 * AI-powered transaction parser
 * Extracts structured data from bank emails and natural language input
 */

import type { ParsedTransaction, ParserResponse, Category, Currency } from './types.js';

// ============================================
// Configuration
// ============================================

const SYSTEM_PROMPT = `You are a precise financial data extractor. Extract transaction information from natural language descriptions.

Return ONLY valid JSON with these fields:
- merchant: string (store name OR expense description - NEVER "unknown")
- amount: number (extract the number from input, e.g., 50.00)
- currency: string (CAD, USD, EUR, etc. Default CAD)
- category: string (dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, other)
- cardLastFour: string (last 4 digits if mentioned, otherwise "unknown")
- date: string (YYYY-MM-DD, default today)
- location: string or null (city/country if mentioned)
- excludedParticipants: string[] (people NOT participating, empty array if none)
- customSplits: object or null (custom amounts if mentioned)

IMPORTANT - Input parsing examples:
- "basketball fee 26" → merchant: "Basketball fee", amount: 26
- "lunch 50" → merchant: "Lunch", amount: 50
- "uber 15" → merchant: "Uber", amount: 15
- "coffee 5" → merchant: "Coffee", amount: 5
- "打车 30" → merchant: "打车", amount: 30
- "晚饭120" → merchant: "晚饭", amount: 120
- "Costco 150" → merchant: "Costco", amount: 150

Category rules:
- dining: restaurants, cafes, food delivery
- grocery: supermarkets (Costco, T&T)
- gas: gas stations, EV charging
- shopping: retail, Amazon
- subscription: Netflix, Spotify
- travel: flights, hotels, Airbnb
- transport: Uber rides, transit, parking
- entertainment: movies, concerts, games, sports fees
- health: pharmacy, medical
- utilities: phone, internet
- other: anything else

Split modifiers (match participant names exactly):
- "lunch 50 without Alice" → excludedParticipants: ["Alice"]
- "晚饭120不算小明" → excludedParticipants: ["小明"]

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
   * @param text - The user input text
   * @param options - Optional parsing options
   * @param options.participants - List of participant names for split detection
   */
  async parseNaturalLanguage(
    text: string,
    options?: { participants?: readonly string[] }
  ): Promise<ParserResponse> {
    const participantContext = options?.participants != null && options.participants.length > 0
      ? `\n\nParticipants in this group: ${options.participants.join(', ')}`
      : '';
    return this.parse(text + participantContext);
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

    // Normalize excludedParticipants to array
    const excludedParticipants = Array.isArray(parsed.excludedParticipants)
      ? parsed.excludedParticipants.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : undefined;

    // Normalize customSplits
    const customSplits = parsed.customSplits != null && typeof parsed.customSplits === 'object'
      ? parsed.customSplits
      : undefined;

    // Normalize merchant - reject "unknown" variants
    const rawMerchant = parsed.merchant?.trim() ?? '';
    const isUnknownMerchant = rawMerchant === '' || rawMerchant.toLowerCase() === 'unknown';
    const category = this.normalizeCategory(parsed.category);
    const merchant = isUnknownMerchant
      ? this.categoryToMerchant(category)
      : rawMerchant;

    return {
      merchant,
      amount: typeof parsed.amount === 'number' ? parsed.amount : parseFloat(String(parsed.amount)) || 0,
      currency: this.normalizeCurrency(parsed.currency),
      category: this.normalizeCategory(parsed.category),
      cardLastFour: parsed.cardLastFour ?? 'unknown',
      date: parsed.date ?? today,
      location: parsed.location ?? undefined,
      excludedParticipants: excludedParticipants != null && excludedParticipants.length > 0 ? excludedParticipants : undefined,
      customSplits,
    };
  }

  /**
   * Convert category to a readable merchant name when merchant is unknown
   */
  private categoryToMerchant(category: Category): string {
    const categoryNames: Record<Category, string> = {
      dining: 'Restaurant',
      grocery: 'Grocery',
      gas: 'Gas Station',
      shopping: 'Shopping',
      subscription: 'Subscription',
      travel: 'Travel',
      transport: 'Transport',
      entertainment: 'Entertainment',
      health: 'Health',
      utilities: 'Utilities',
      other: 'Expense',
    };
    return categoryNames[category] ?? 'Expense';
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
  private checkWarnings(parsed: ParsedTransaction, _originalInput: string): readonly string[] {
    // Default merchant names (when merchant couldn't be identified)
    const defaultMerchants = [
      'Restaurant', 'Grocery', 'Gas Station', 'Shopping', 'Subscription',
      'Travel', 'Transport', 'Entertainment', 'Health', 'Utilities', 'Expense',
    ];
    const isDefaultMerchant = defaultMerchants.includes(parsed.merchant);

    const warningChecks: ReadonlyArray<{ condition: boolean; message: string }> = [
      { condition: parsed.amount <= 0, message: 'Amount is zero or negative' },
      { condition: parsed.amount > 10000, message: 'Unusually large amount - please verify' },
      { condition: isDefaultMerchant, message: 'Merchant name not detected' },
      { condition: parsed.cardLastFour === 'unknown', message: 'Card number not detected' },
    ];

    return warningChecks
      .filter(check => check.condition)
      .map(check => check.message);
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
