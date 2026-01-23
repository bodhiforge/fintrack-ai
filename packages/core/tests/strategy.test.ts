/**
 * Tests for credit card strategy engine
 */

import { describe, it, expect } from 'vitest';
import {
  CardStrategyEngine,
  checkCardStrategy,
  formatStrategyResult,
} from '../src/strategy.js';
import type { ParsedTransaction, CardStrategy } from '../src/types.js';

const testStrategies: CardStrategy[] = [
  {
    cardName: 'Amex Cobalt',
    lastFourDigits: '1234',
    bestFor: ['dining', 'grocery'],
    multiplier: '5x MR points',
    foreignTxFee: 2.5,
  },
  {
    cardName: 'Rogers World Elite MC',
    lastFourDigits: '5678',
    bestFor: ['costco', 'foreign'],
    multiplier: '1.5% cashback',
    foreignTxFee: 0,
  },
];

describe('CardStrategyEngine', () => {
  const engine = new CardStrategyEngine(testStrategies);

  describe('checkStrategy', () => {
    it('should approve Cobalt for dining', () => {
      const tx: ParsedTransaction = {
        merchant: 'Sushi Restaurant',
        amount: 50,
        currency: 'CAD',
        category: 'dining',
        cardLastFour: '1234',
        date: '2026-01-15',
      };

      const result = engine.checkStrategy(tx);
      expect(result.isOptimal).toBe(true);
      expect(result.cardUsed).toBe('Amex Cobalt');
    });

    it('should flag Amex at Costco as suboptimal', () => {
      const tx: ParsedTransaction = {
        merchant: 'Costco Wholesale',
        amount: 150,
        currency: 'CAD',
        category: 'shopping',
        cardLastFour: '1234', // Amex Cobalt
        date: '2026-01-15',
      };

      const result = engine.checkStrategy(tx);
      expect(result.isOptimal).toBe(false);
      expect(result.suggestion).toContain('Mastercard');
    });

    it('should approve Rogers MC at Costco', () => {
      const tx: ParsedTransaction = {
        merchant: 'COSTCO WHOLESALE',
        amount: 150,
        currency: 'CAD',
        category: 'shopping',
        cardLastFour: '5678', // Rogers MC
        date: '2026-01-15',
      };

      const result = engine.checkStrategy(tx);
      expect(result.isOptimal).toBe(true);
    });

    it('should recommend no-FX card for foreign transactions', () => {
      const tx: ParsedTransaction = {
        merchant: 'Amazon US',
        amount: 50,
        currency: 'USD',
        category: 'shopping',
        cardLastFour: '1234', // Amex Cobalt with 2.5% FX fee
        date: '2026-01-15',
      };

      const result = engine.checkStrategy(tx);
      expect(result.isOptimal).toBe(false);
      expect(result.suggestion).toContain('no FX fee');
    });
  });

  describe('recommendCard', () => {
    it('should recommend Cobalt for dining', () => {
      const card = engine.recommendCard('Restaurant', 'dining');
      expect(card?.cardName).toBe('Amex Cobalt');
    });

    it('should recommend Rogers MC for Costco', () => {
      const card = engine.recommendCard('Costco', 'shopping');
      expect(card?.cardName).toBe('Rogers World Elite MC');
    });

    it('should recommend no-FX card for foreign', () => {
      const card = engine.recommendCard('Any Store', 'shopping', true);
      expect(card?.foreignTxFee).toBe(0);
    });
  });
});

describe('checkCardStrategy (utility function)', () => {
  it('should work without instantiating engine', () => {
    const tx: ParsedTransaction = {
      merchant: 'Restaurant',
      amount: 50,
      currency: 'CAD',
      category: 'dining',
      cardLastFour: 'unknown',
      date: '2026-01-15',
    };

    const result = checkCardStrategy(tx, testStrategies);
    expect(result).toBeDefined();
  });
});

describe('formatStrategyResult', () => {
  it('should format optimal result', () => {
    const result = formatStrategyResult({
      isOptimal: true,
      cardUsed: 'Amex Cobalt',
    });

    expect(result).toContain('✅');
    expect(result).toContain('Optimal');
  });

  it('should format suboptimal result with suggestion', () => {
    const result = formatStrategyResult({
      isOptimal: false,
      cardUsed: 'Amex Cobalt',
      suggestion: 'Use Rogers MC for Costco',
    });

    expect(result).toContain('⚠️');
    expect(result).toContain('Rogers MC');
  });
});
