/**
 * Tests for expense splitting logic
 */

import { describe, it, expect } from 'vitest';
import {
  splitExpense,
  calculateBalances,
  simplifyDebts,
  parseNaturalLanguageSplit,
  convertCurrency,
  DEFAULT_RATES,
} from '../src/splitter.js';
import type { Transaction } from '../src/types.js';

describe('splitExpense', () => {
  it('should split equally among participants', () => {
    const result = splitExpense({
      totalAmount: 100,
      currency: 'CAD',
      payer: 'Alice',
      participants: ['Alice', 'Bob', 'Carol'],
    });

    expect(result.shares).toEqual({
      Alice: 33.34,
      Bob: 33.33,
      Carol: 33.33,
    });
    expect(result.payer).toBe('Alice');
  });

  it('should exclude specified participants', () => {
    const result = splitExpense({
      totalAmount: 100,
      currency: 'CAD',
      payer: 'Alice',
      participants: ['Alice', 'Bob', 'Carol'],
      excludedParticipants: ['Carol'],
    });

    expect(result.shares).toEqual({
      Alice: 50,
      Bob: 50,
    });
  });

  it('should handle custom splits', () => {
    const result = splitExpense({
      totalAmount: 100,
      currency: 'CAD',
      payer: 'Alice',
      participants: ['Alice', 'Bob'],
      customSplits: { Alice: 70, Bob: 30 },
    });

    expect(result.shares).toEqual({
      Alice: 70,
      Bob: 30,
    });
  });

  it('should throw error if custom splits dont match total', () => {
    expect(() =>
      splitExpense({
        totalAmount: 100,
        currency: 'CAD',
        payer: 'Alice',
        participants: ['Alice', 'Bob'],
        customSplits: { Alice: 60, Bob: 30 },
      })
    ).toThrow();
  });
});

describe('calculateBalances', () => {
  it('should calculate net balances correctly', () => {
    const transactions: Transaction[] = [
      {
        id: '1',
        date: '2026-01-15',
        merchant: 'Restaurant',
        amount: 100,
        currency: 'CAD',
        category: 'dining',
        cardLastFour: '1234',
        payer: 'Alice',
        isShared: true,
        splits: { Alice: 50, Bob: 50 },
        createdAt: '2026-01-15T12:00:00Z',
      },
    ];

    const balances = calculateBalances(transactions);

    // Alice paid 100, owes 50 → net +50 (Bob owes her)
    // Bob paid 0, owes 50 → net -50 (he owes Alice)
    const aliceBalance = balances.find((b) => b.person === 'Alice');
    const bobBalance = balances.find((b) => b.person === 'Bob');

    expect(aliceBalance?.netBalance).toBe(50);
    expect(bobBalance?.netBalance).toBe(-50);
  });
});

describe('simplifyDebts', () => {
  it('should minimize number of transactions', () => {
    // Alice paid for dinner (100, split 3 ways)
    // Bob paid for lunch (60, split 3 ways)
    const transactions: Transaction[] = [
      {
        id: '1',
        date: '2026-01-15',
        merchant: 'Dinner',
        amount: 90,
        currency: 'CAD',
        category: 'dining',
        cardLastFour: '1234',
        payer: 'Alice',
        isShared: true,
        splits: { Alice: 30, Bob: 30, Carol: 30 },
        createdAt: '2026-01-15T12:00:00Z',
      },
      {
        id: '2',
        date: '2026-01-16',
        merchant: 'Lunch',
        amount: 60,
        currency: 'CAD',
        category: 'dining',
        cardLastFour: '5678',
        payer: 'Bob',
        isShared: true,
        splits: { Alice: 20, Bob: 20, Carol: 20 },
        createdAt: '2026-01-16T12:00:00Z',
      },
    ];

    const settlements = simplifyDebts(transactions);

    // Alice: paid 90, owes 50 → net +40
    // Bob: paid 60, owes 50 → net +10
    // Carol: paid 0, owes 50 → net -50
    // Simplified: Carol pays Alice 40, Carol pays Bob 10
    expect(settlements).toHaveLength(2);

    const totalSettled = settlements.reduce((sum, s) => sum + s.amount, 0);
    expect(totalSettled).toBe(50);
  });

  it('should return empty array when already settled', () => {
    const transactions: Transaction[] = [
      {
        id: '1',
        date: '2026-01-15',
        merchant: 'Dinner',
        amount: 50,
        currency: 'CAD',
        category: 'dining',
        cardLastFour: '1234',
        payer: 'Alice',
        isShared: true,
        splits: { Alice: 50 }, // Alice pays for herself only
        createdAt: '2026-01-15T12:00:00Z',
      },
    ];

    const settlements = simplifyDebts(transactions);
    expect(settlements).toHaveLength(0);
  });
});

describe('parseNaturalLanguageSplit', () => {
  const participants = ['Alice', 'Bob', 'Carol'];

  it('should parse "exclude Alice"', () => {
    const result = parseNaturalLanguageSplit('exclude Alice', participants);
    expect(result.excludedParticipants).toContain('Alice');
  });

  it('should parse "Bob didnt join"', () => {
    const result = parseNaturalLanguageSplit('Bob didnt join', participants);
    expect(result.excludedParticipants).toContain('Bob');
  });

  it('should parse "without Carol"', () => {
    const result = parseNaturalLanguageSplit('dinner without Carol', participants);
    expect(result.excludedParticipants).toContain('Carol');
  });

  it('should handle case insensitivity', () => {
    const result = parseNaturalLanguageSplit('exclude ALICE', participants);
    expect(result.excludedParticipants).toContain('Alice');
  });
});

describe('convertCurrency', () => {
  it('should convert USD to CAD', () => {
    const result = convertCurrency(100, 'USD', 'CAD', DEFAULT_RATES);
    expect(result).toBeCloseTo(135, 0); // 100 USD ≈ 135 CAD
  });

  it('should return same amount for same currency', () => {
    const result = convertCurrency(100, 'CAD', 'CAD', DEFAULT_RATES);
    expect(result).toBe(100);
  });

  it('should handle Costa Rican Colones', () => {
    // 10000 CRC should be about 25 CAD
    const result = convertCurrency(10000, 'CRC', 'CAD', DEFAULT_RATES);
    expect(result).toBeCloseTo(25, 0);
  });
});
