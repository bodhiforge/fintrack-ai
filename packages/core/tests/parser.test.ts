/**
 * Parser unit tests with mocked OpenAI responses
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionParser } from '../src/parser.js';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      beta: {
        chat: {
          completions: {
            parse: vi.fn().mockImplementation(async ({ messages }) => {
              const userMessage = messages[1]?.content ?? '';
              return { choices: [{ message: { parsed: getMockResponse(userMessage) } }] };
            }),
          },
        },
      },
    })),
  };
});

// Mock responses based on input patterns
function getMockResponse(input: string): Record<string, unknown> {
  const today = new Date().toISOString().split('T')[0];

  // Basic patterns
  if (input.includes('lunch 50')) {
    return { merchant: 'Lunch', amount: 50, currency: 'CAD', category: 'dining', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: [], customSplits: null };
  }
  if (input.includes('coffee 5.50')) {
    return { merchant: 'Coffee', amount: 5.50, currency: 'CAD', category: 'dining', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: [], customSplits: null };
  }
  if (input.includes('uber 25')) {
    return { merchant: 'Uber', amount: 25, currency: 'CAD', category: 'transport', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: [], customSplits: null };
  }
  if (input.includes('午饭 35')) {
    return { merchant: '午饭', amount: 35, currency: 'CAD', category: 'dining', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: [], customSplits: null };
  }
  if (input.includes('打车 30')) {
    return { merchant: '打车', amount: 30, currency: 'CAD', category: 'transport', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: [], customSplits: null };
  }

  // Currency patterns
  if (input.includes('dinner 80 usd')) {
    return { merchant: 'Dinner', amount: 80, currency: 'USD', category: 'dining', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: [], customSplits: null };
  }
  if (input.includes('costco 150 USD')) {
    return { merchant: 'Costco', amount: 150, currency: 'USD', category: 'grocery', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: [], customSplits: null };
  }

  // Split patterns
  if (input.includes('dinner 120 without Bob')) {
    return { merchant: 'Dinner', amount: 120, currency: 'CAD', category: 'dining', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: ['Bob'], customSplits: null };
  }
  if (input.includes('午饭 88 不算小明')) {
    return { merchant: '午饭', amount: 88, currency: 'CAD', category: 'dining', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: ['小明'], customSplits: null };
  }

  // Default
  return { merchant: 'Unknown', amount: 0, currency: 'CAD', category: 'other', date: today, cardLastFour: 'unknown', location: null, excludedParticipants: [], customSplits: null };
}

describe('TransactionParser', () => {
  let parser: TransactionParser;

  beforeEach(() => {
    parser = new TransactionParser('fake-api-key');
  });

  describe('basic parsing', () => {
    it('parses "lunch 50"', async () => {
      const result = await parser.parseNaturalLanguage('lunch 50');
      expect(result.parsed.merchant).toBe('Lunch');
      expect(result.parsed.amount).toBe(50);
      expect(result.parsed.currency).toBe('CAD');
      expect(result.parsed.category).toBe('dining');
    });

    it('parses "coffee 5.50"', async () => {
      const result = await parser.parseNaturalLanguage('coffee 5.50');
      expect(result.parsed.amount).toBe(5.50);
    });

    it('parses "uber 25"', async () => {
      const result = await parser.parseNaturalLanguage('uber 25');
      expect(result.parsed.merchant).toBe('Uber');
      expect(result.parsed.category).toBe('transport');
    });

    it('parses Chinese input "午饭 35"', async () => {
      const result = await parser.parseNaturalLanguage('午饭 35');
      expect(result.parsed.merchant).toBe('午饭');
      expect(result.parsed.amount).toBe(35);
    });

    it('parses Chinese input "打车 30"', async () => {
      const result = await parser.parseNaturalLanguage('打车 30');
      expect(result.parsed.merchant).toBe('打车');
      expect(result.parsed.category).toBe('transport');
    });
  });

  describe('currency detection', () => {
    it('parses "dinner 80 usd"', async () => {
      const result = await parser.parseNaturalLanguage('dinner 80 usd');
      expect(result.parsed.amount).toBe(80);
      expect(result.parsed.currency).toBe('USD');
    });

    it('parses "costco 150 USD"', async () => {
      const result = await parser.parseNaturalLanguage('costco 150 USD');
      expect(result.parsed.currency).toBe('USD');
      expect(result.parsed.category).toBe('grocery');
    });
  });

  describe('split modifiers', () => {
    it('parses "dinner 120 without Bob"', async () => {
      const result = await parser.parseNaturalLanguage('dinner 120 without Bob', {
        participants: ['Alice', 'Bob', 'Carol'],
      });
      expect(result.parsed.excludedParticipants).toEqual(['Bob']);
    });

    it('parses Chinese exclusion "午饭 88 不算小明"', async () => {
      const result = await parser.parseNaturalLanguage('午饭 88 不算小明', {
        participants: ['小红', '小明', '小华'],
      });
      expect(result.parsed.excludedParticipants).toEqual(['小明']);
    });
  });

  describe('normalization', () => {
    it('normalizes currency to uppercase', async () => {
      const result = await parser.parseNaturalLanguage('dinner 80 usd');
      expect(result.parsed.currency).toBe('USD');
    });

    it('normalizes category to lowercase', async () => {
      const result = await parser.parseNaturalLanguage('lunch 50');
      expect(result.parsed.category).toBe('dining');
    });
  });

  describe('warnings', () => {
    it('returns confidence 1.0 when no warnings', async () => {
      const result = await parser.parseNaturalLanguage('lunch 50');
      expect(result.confidence).toBe(1.0);
    });
  });
});
