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
    (p) => !excludedParticipants.includes(p)
  );

  if (activeParticipants.length === 0) {
    throw new Error('No participants to split among');
  }

  let shares: Record<string, number>;

  if (customSplits) {
    // Use custom split amounts
    shares = { ...customSplits };

    // Validate custom splits sum to total
    const customTotal = Object.values(shares).reduce((sum, v) => sum + v, 0);
    if (Math.abs(customTotal - totalAmount) > 0.01) {
      throw new Error(
        `Custom splits (${customTotal}) don't match total (${totalAmount})`
      );
    }
  } else {
    // Equal split
    const perPerson = roundCurrency(totalAmount / activeParticipants.length);
    shares = {};

    // Handle rounding: give remainder to first person
    let remaining = totalAmount;
    activeParticipants.forEach((person, index) => {
      if (index === activeParticipants.length - 1) {
        shares[person] = roundCurrency(remaining);
      } else {
        shares[person] = perPerson;
        remaining -= perPerson;
      }
    });
  }

  return {
    shares,
    payer,
    totalAmount,
    currency,
  };
}

// ============================================
// Debt Simplification
// ============================================

/**
 * Calculate net balances from a list of transactions
 * Positive balance = others owe you
 * Negative balance = you owe others
 */
export function calculateBalances(transactions: Transaction[]): Balance[] {
  const balanceMap = new Map<string, number>();

  transactions.forEach((tx) => {
    const { payer, splits, amount } = tx;

    // Payer paid the full amount
    balanceMap.set(payer, (balanceMap.get(payer) || 0) + amount);

    // Each person owes their share
    Object.entries(splits).forEach(([person, share]) => {
      balanceMap.set(person, (balanceMap.get(person) || 0) - share);
    });
  });

  return Array.from(balanceMap.entries())
    .map(([person, netBalance]) => ({
      person,
      netBalance: roundCurrency(netBalance),
    }))
    .filter((b) => Math.abs(b.netBalance) > 0.01);
}

/**
 * Simplify debts to minimize number of transactions
 * Uses a greedy algorithm to match largest creditor with largest debtor
 */
export function simplifyDebts(
  transactions: Transaction[],
  currency: Currency = 'CAD'
): Settlement[] {
  const balances = calculateBalances(transactions);

  // Separate into creditors (positive) and debtors (negative)
  const creditors: Array<{ person: string; amount: number }> = [];
  const debtors: Array<{ person: string; amount: number }> = [];

  balances.forEach(({ person, netBalance }) => {
    if (netBalance > 0.01) {
      creditors.push({ person, amount: netBalance });
    } else if (netBalance < -0.01) {
      debtors.push({ person, amount: -netBalance });
    }
  });

  // Sort by amount descending
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const settlements: Settlement[] = [];

  // Greedy matching
  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = creditors[0];
    const debtor = debtors[0];

    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0.01) {
      settlements.push({
        from: debtor.person,
        to: creditor.person,
        amount: roundCurrency(amount),
        currency,
      });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;

    // Remove settled parties
    if (creditor.amount < 0.01) {
      creditors.shift();
    }
    if (debtor.amount < 0.01) {
      debtors.shift();
    }
  }

  return settlements;
}

/**
 * Generate human-readable settlement summary
 */
export function formatSettlements(settlements: Settlement[]): string {
  if (settlements.length === 0) {
    return 'All settled up! No payments needed.';
  }

  const lines = settlements.map(
    (s) => `${s.from} → ${s.to}: $${s.amount.toFixed(2)} ${s.currency}`
  );

  return `To settle up:\n${lines.join('\n')}`;
}

// ============================================
// Natural Language Split Parsing
// ============================================

export interface NaturalLanguageSplitResult {
  excludedParticipants: string[];
  customSplits?: Record<string, number>;
  notes?: string;
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
  allParticipants: string[]
): NaturalLanguageSplitResult {
  const lowerText = text.toLowerCase();
  const excluded: string[] = [];

  // Patterns for exclusion
  const exclusionPatterns = [
    /(?:exclude|without|except|not including|minus)\s+(\w+)/gi,
    /(\w+)\s+(?:didn't|didnt|did not|wasn't|wasnt|was not|isn't|isnt|is not)\s+(?:join|participate|there|included|eating|drinking)/gi,
    /(?:no|not)\s+(\w+)/gi,
  ];

  for (const pattern of exclusionPatterns) {
    let match;
    while ((match = pattern.exec(lowerText)) !== null) {
      const name = match[1];
      // Find matching participant (case-insensitive)
      const participant = allParticipants.find(
        (p) => p.toLowerCase() === name.toLowerCase()
      );
      if (participant && !excluded.includes(participant)) {
        excluded.push(participant);
      }
    }
  }

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
  const fromRate = rates[fromCurrency] || 1;
  const toRate = rates[toCurrency] || 1;

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
