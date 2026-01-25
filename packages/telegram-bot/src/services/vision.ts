/**
 * OpenAI GPT-4o Vision Service for Receipt OCR
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

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

interface OpenAIResponse {
  readonly choices: readonly {
    readonly message: {
      readonly content: string;
    };
  }[];
}

// ============================================
// System Prompt
// ============================================

const SYSTEM_PROMPT = `You are analyzing a receipt or payment screenshot to extract transaction details.

## Task
Extract the merchant name, total amount, currency, date, category, and main items from the image.

## Guidelines
- merchant: The store/business name (NOT the address or transaction ID)
- amount: The TOTAL amount paid (after tax, tips, discounts)
- currency: Infer from symbols ($, €, £) or country context. Default to CAD if unclear.
- date: The transaction date in YYYY-MM-DD format. Default to today if not visible.
- category: One of: dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, sports, education, other
- items: List 2-5 main items if visible, omit if not clear

## Confidence Scoring (0-1)
- 1.0: Text is perfectly clear and unambiguous
- 0.7-0.9: Slightly blurry but readable
- 0.5-0.7: Had to make educated guesses
- 0.3-0.5: Very unclear, low confidence
- 0.1-0.3: Mostly guessing

## Response Format
You MUST respond with valid JSON only. No markdown, no explanation.
{
  "merchant": "Store Name",
  "amount": 25.99,
  "currency": "CAD",
  "date": "2024-01-15",
  "category": "grocery",
  "items": ["item1", "item2"],
  "confidence": {
    "merchant": 0.9,
    "amount": 0.95,
    "category": 0.8
  }
}`;

// ============================================
// Vision Service
// ============================================

/**
 * Parse receipt image using GPT-4o Vision
 */
export async function parseReceipt(
  imageBase64: string,
  apiKey: string,
  mimeType: string = 'image/jpeg'
): Promise<ReceiptData> {
  const today = new Date().toISOString().split('T')[0];

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',  // mini is sufficient for OCR, 90% cost reduction
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Today's date: ${today}\n\nPlease extract the transaction details from this receipt image.`,
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
      temperature: 0,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Vision API error: ${response.status} - ${error}`);
  }

  const result = await response.json() as OpenAIResponse;
  const content = result.choices[0]?.message?.content;

  if (content == null) {
    throw new Error('Failed to parse receipt from image');
  }

  // Parse JSON response
  const parsed = JSON.parse(content) as {
    merchant: string;
    amount: number;
    currency: string;
    date: string;
    category: string;
    items?: string[];
    confidence: {
      merchant: number;
      amount: number;
      category: number;
    };
  };

  return {
    merchant: parsed.merchant,
    amount: parsed.amount,
    currency: parsed.currency.toUpperCase(),
    date: parsed.date,
    category: parsed.category.toLowerCase(),
    items: parsed.items,
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
