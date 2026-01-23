/**
 * Expense splitting and debt simplification logic
 */

import type {
  SplitRequest,
  SplitResult,
  Settlement,
  Balance,
  Transaction,
  Currency,
} from './types.js';

// ============================================
// Basic Splitting
// ============================================

/**
 * Split an expense among participants
 */
export function splitExpense(request: SplitRequest): SplitResult {
  const {
    totalAmount,
    currency,
    payer,
    participants,
    excludedParticipants = [],
    customSplits,
  } = request;

  // Filter out excluded participants
  const activeParticipants = participants.filter(
    (participant) => !excludedParticipants.includes(participant)
  );

  if (activeParticipants.length === 0) {
    throw new Error('No participants to split among');
  }

  const shares = customSplits != null
    ? validateCustomSplits(customSplits, totalAmount)
    : calculateEqualSplits(activeParticipants, totalAmount);

  return {
    shares,
    payer,
    totalAmount,
    currency,
  };
}

function validateCustomSplits(
  customSplits: Readonly<Record<string, number>>,
  totalAmount: number
): Readonly<Record<string, number>> {
  const customTotal = Object.values(customSplits).reduce((sum, value) => sum + value, 0);
  if (Math.abs(customTotal - totalAmount) > 0.01) {
    throw new Error(
      `Custom splits (${customTotal}) don't match total (${totalAmount})`
    );
  }
  return customSplits;
}

function calculateEqualSplits(
  participants: readonly string[],
  totalAmount: number
): Readonly<Record<string, number>> {
  const perPerson = roundCurrency(totalAmount / participants.length);
  const lastIndex = participants.length - 1;

  return participants.reduce<Record<string, number>>((shares, person, index) => {
    const previousTotal = Object.values(shares).reduce((sum, value) => sum + value, 0);
    const share = index === lastIndex
      ? roundCurrency(totalAmount - previousTotal)
      : perPerson;
    return { ...shares, [person]: share };
  }, {});
}

// ============================================
// Debt Simplification
// ============================================

/**
 * Calculate net balances from a list of transactions
 * Positive balance = others owe you
 * Negative balance = you owe others
 */
export function calculateBalances(transactions: readonly Transaction[]): readonly Balance[] {
  const balanceMap = transactions.reduce<Map<string, number>>((map, transaction) => {
    const { payer, splits, amount } = transaction;

    // Payer paid the full amount
    const payerBalance = map.get(payer) ?? 0;
    const updatedMap = new Map(map);
    updatedMap.set(payer, payerBalance + amount);

    // Each person owes their share
    return Object.entries(splits).reduce((accumulator, [person, share]) => {
      const personBalance = accumulator.get(person) ?? 0;
      const result = new Map(accumulator);
      result.set(person, personBalance - share);
      return result;
    }, updatedMap);
  }, new Map<string, number>());

  return Array.from(balanceMap.entries())
    .map(([person, netBalance]) => ({
      person,
      netBalance: roundCurrency(netBalance),
    }))
    .filter((balance) => Math.abs(balance.netBalance) > 0.01);
}

interface PartyBalance {
  readonly person: string;
  readonly amount: number;
}

/**
 * Simplify debts to minimize number of transactions
 * Uses a greedy algorithm to match largest creditor with largest debtor
 */
export function simplifyDebts(
  transactions: readonly Transaction[],
  currency: Currency = 'CAD'
): readonly Settlement[] {
  const balances = calculateBalances(transactions);

  // Separate into creditors (positive) and debtors (negative)
  const { creditors, debtors } = balances.reduce<{
    creditors: readonly PartyBalance[];
    debtors: readonly PartyBalance[];
  }>(
    (accumulator, { person, netBalance }) => {
      if (netBalance > 0.01) {
        return {
          ...accumulator,
          creditors: [...accumulator.creditors, { person, amount: netBalance }],
        };
      }
      if (netBalance < -0.01) {
        return {
          ...accumulator,
          debtors: [...accumulator.debtors, { person, amount: -netBalance }],
        };
      }
      return accumulator;
    },
    { creditors: [], debtors: [] }
  );

  // Sort by amount descending
  const sortedCreditors = [...creditors].sort((a, b) => b.amount - a.amount);
  const sortedDebtors = [...debtors].sort((a, b) => b.amount - a.amount);

  // Recursive greedy matching
  return matchDebts(sortedCreditors, sortedDebtors, currency);
}

function matchDebts(
  creditors: readonly PartyBalance[],
  debtors: readonly PartyBalance[],
  currency: Currency
): readonly Settlement[] {
  if (creditors.length === 0 || debtors.length === 0) {
    return [];
  }

  const [creditor, ...remainingCreditors] = creditors;
  const [debtor, ...remainingDebtors] = debtors;

  const amount = Math.min(creditor.amount, debtor.amount);

  const settlement: Settlement | null = amount > 0.01
    ? {
        from: debtor.person,
        to: creditor.person,
        amount: roundCurrency(amount),
        currency,
      }
    : null;

  const newCreditorAmount = creditor.amount - amount;
  const newDebtorAmount = debtor.amount - amount;

  const updatedCreditors = newCreditorAmount > 0.01
    ? [{ person: creditor.person, amount: newCreditorAmount }, ...remainingCreditors]
    : remainingCreditors;

  const updatedDebtors = newDebtorAmount > 0.01
    ? [{ person: debtor.person, amount: newDebtorAmount }, ...remainingDebtors]
    : remainingDebtors;

  const futureSettlements = matchDebts(updatedCreditors, updatedDebtors, currency);

  return settlement != null
    ? [settlement, ...futureSettlements]
    : futureSettlements;
}

/**
 * Generate human-readable settlement summary
 */
export function formatSettlements(settlements: readonly Settlement[]): string {
  if (settlements.length === 0) {
    return 'All settled up! No payments needed.';
  }

  const lines = settlements.map(
    (settlement) => `${settlement.from} → ${settlement.to}: $${settlement.amount.toFixed(2)} ${settlement.currency}`
  );

  return `To settle up:\n${lines.join('\n')}`;
}

// ============================================
// Natural Language Split Parsing
// ============================================

export interface NaturalLanguageSplitResult {
  readonly excludedParticipants: readonly string[];
  readonly customSplits?: Readonly<Record<string, number>>;
  readonly notes?: string;
}

/**
 * Parse natural language modifiers for splitting
 * Examples:
 * - "Alice didn't join" → exclude Alice
 * - "exclude Bob from beer" → partial exclude
 * - "Alice pays double" → custom split
 */
export function parseNaturalLanguageSplit(
  text: string,
  allParticipants: readonly string[]
): NaturalLanguageSplitResult {
  const lowerText = text.toLowerCase();

  // Patterns for exclusion
  const exclusionPatterns = [
    /(?:exclude|without|except|not including|minus)\s+(\w+)/gi,
    /(\w+)\s+(?:didn't|didnt|did not|wasn't|wasnt|was not|isn't|isnt|is not)\s+(?:join|participate|there|included|eating|drinking)/gi,
    /(?:no|not)\s+(\w+)/gi,
  ];

  const excluded = exclusionPatterns.reduce<readonly string[]>((accumulator, pattern) => {
    const matches = Array.from(lowerText.matchAll(pattern));
    return matches.reduce<readonly string[]>((innerAccumulator, match) => {
      const name = match[1];
      // Find matching participant (case-insensitive)
      const participant = allParticipants.find(
        (p) => p.toLowerCase() === name.toLowerCase()
      );
      if (participant != null && !innerAccumulator.includes(participant)) {
        return [...innerAccumulator, participant];
      }
      return innerAccumulator;
    }, accumulator);
  }, []);

  return {
    excludedParticipants: excluded,
  };
}

// ============================================
// Currency Helpers
// ============================================

/**
 * Round to 2 decimal places for currency
 */
function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Convert amount between currencies
 */
export function convertCurrency(
  amount: number,
  fromCurrency: Currency,
  toCurrency: Currency,
  rates: Record<string, number>
): number {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  // Rates are "1 unit of currency = X CAD"
  // e.g., rate[USD] = 1.35 means 1 USD = 1.35 CAD
  const fromRate = rates[fromCurrency] ?? 1;
  const toRate = rates[toCurrency] ?? 1;

  // Convert: amount in fromCurrency -> CAD -> toCurrency
  // 100 USD * 1.35 = 135 CAD, 135 CAD / 1 = 135 CAD
  const inBase = amount * fromRate;
  const inTarget = inBase / toRate;

  return roundCurrency(inTarget);
}

/**
 * Default exchange rates (CAD as base)
 * Update these or fetch from API for accuracy
 */
export const DEFAULT_RATES: Record<string, number> = {
  CAD: 1,
  USD: 1.35,
  EUR: 1.47,
  GBP: 1.71,
  MXN: 0.078,
  CRC: 0.0025, // Costa Rican Colones
  JPY: 0.0091,
};
