/**
 * OpenAI GPT-4o Vision Service for Receipt OCR
 * Uses Structured Outputs for reliable parsing
 */

import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import OpenAI from 'openai';

// ============================================
// Zod Schema
// ============================================

const ReceiptSchema = z.object({
  merchant: z.string().describe('Store/business name (NOT address or transaction ID)'),
  amount: z.number().describe('Total amount paid (after tax, tips, discounts)'),
  currency: z.string().describe('Currency code: CAD, USD, EUR, etc.'),
  date: z.string().describe('Transaction date in YYYY-MM-DD format'),
  category: z.enum([
    'dining', 'grocery', 'gas', 'shopping', 'subscription',
    'travel', 'transport', 'entertainment', 'health', 'utilities',
    'sports', 'education', 'other'
  ]).describe('Expense category'),
  items: z.array(z.string()).nullable().describe('2-5 main items if visible'),
  confidence: z.object({
    merchant: z.number().min(0).max(1).describe('Confidence for merchant extraction'),
    amount: z.number().min(0).max(1).describe('Confidence for amount extraction'),
    category: z.number().min(0).max(1).describe('Confidence for category classification'),
  }).describe('Confidence scores (1.0=clear, 0.5=guessing, 0.1=very unclear)'),
});

// ============================================
// Types
// ============================================

export interface ReceiptData {
  readonly merchant: string;
  readonly amount: number;
  readonly currency: string;
  readonly date: string;
  readonly category: string;
  readonly items?: readonly string[];
  readonly confidence: {
    readonly merchant: number;
    readonly amount: number;
    readonly category: number;
  };
}

// ============================================
// System Prompt
// ============================================

const SYSTEM_PROMPT = `You analyze receipt/payment images to extract transaction details.

## Guidelines
- merchant: Store/business name (NOT address or transaction ID)
- amount: TOTAL paid (after tax, tips, discounts). Look for "Total", "Grand Total", "Amount Due"
- currency: Infer from $ (CAD/USD), €, £, ¥ or country context. Default CAD if unclear
- date: Transaction date as YYYY-MM-DD. Use today ({today}) if not visible
- category: Best matching category for the merchant type
- items: List 2-5 main items if clearly visible, null if not

## Confidence Scoring (0-1)
- 1.0: Perfectly clear, unambiguous
- 0.7-0.9: Slightly blurry but readable
- 0.5-0.7: Educated guesses needed
- 0.3-0.5: Very unclear
- 0.1-0.3: Mostly guessing

## Multi-language Support
Handle receipts in English, Chinese (中文), Japanese (日本語), Korean (한국어), French, Spanish.
Extract merchant names in their original language or transliterate if needed.`;

// ============================================
// Vision Service
// ============================================

/**
 * Parse receipt image using GPT-4o Vision with Structured Outputs
 */
export async function parseReceipt(
  imageBase64: string,
  apiKey: string,
  mimeType: string = 'image/jpeg'
): Promise<ReceiptData> {
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = SYSTEM_PROMPT.replace('{today}', today);

  const client = new OpenAI({ apiKey });

  const completion = await client.beta.chat.completions.parse({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Today: ${today}\n\nExtract transaction details from this receipt.`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${imageBase64}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    response_format: zodResponseFormat(ReceiptSchema, 'receipt'),
    temperature: 0,
    max_tokens: 1000,
  });

  const parsed = completion.choices[0]?.message?.parsed;

  if (parsed == null) {
    throw new Error('Failed to parse receipt: no structured output returned');
  }

  return {
    merchant: parsed.merchant,
    amount: parsed.amount,
    currency: parsed.currency.toUpperCase(),
    date: parsed.date,
    category: parsed.category.toLowerCase(),
    items: parsed.items ?? undefined,
    confidence: parsed.confidence,
  };
}

/**
 * Convert image blob to base64 string
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/**
 * Get MIME type from file path
 */
export function getMimeType(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
  };
  return mimeTypes[extension ?? ''] ?? 'image/jpeg';
}
