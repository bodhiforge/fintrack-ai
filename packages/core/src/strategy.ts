/**
 * Credit card strategy engine
 * Determines optimal card usage and identifies missed rewards
 */

import type {
  CardStrategy,
  StrategyCheckResult,
  ParsedTransaction,
  Category,
} from './types.js';

// ============================================
// Default Card Strategies (Canadian Cards)
// ============================================

export const DEFAULT_CARD_STRATEGIES: CardStrategy[] = [
  {
    cardName: 'Amex Cobalt',
    lastFourDigits: '0000', // Replace with actual
    bestFor: ['dining', 'grocery', 'streaming'],
    multiplier: '5x MR points',
    foreignTxFee: 2.5,
    notes: 'Best for dining and groceries. 2.5% FX fee on foreign transactions.',
  },
  {
    cardName: 'Rogers World Elite Mastercard',
    lastFourDigits: '0000', // Replace with actual
    bestFor: ['costco', 'foreign', 'usd'],
    multiplier: '1.5% cashback (foreign), 1% domestic',
    foreignTxFee: 0,
    notes: 'No FX fee. Only MC accepted at Costco Canada.',
  },
  {
    cardName: 'TD Cash Back Visa Infinite',
    lastFourDigits: '0000', // Replace with actual
    bestFor: ['gas', 'recurring'],
    multiplier: '3% gas, 1% other',
    foreignTxFee: 2.5,
    notes: 'Good for gas stations.',
  },
];

// ============================================
// Strategy Engine
// ============================================

export class CardStrategyEngine {
  private strategies: CardStrategy[];
  private merchantRules: Map<string, string[]>; // merchant pattern -> best card names

  constructor(strategies: CardStrategy[] = DEFAULT_CARD_STRATEGIES) {
    this.strategies = strategies;
    this.merchantRules = new Map();
    this.initMerchantRules();
  }

  /**
   * Initialize merchant-specific rules
   */
  private initMerchantRules(): void {
    // Costco rule: Only Mastercard accepted
    this.merchantRules.set('costco', ['Rogers World Elite Mastercard']);

    // Add more merchant-specific rules as needed
    this.merchantRules.set('amazon', ['Amex Cobalt']); // For groceries via Amazon
  }

  /**
   * Check if the card used was optimal for the transaction
   */
  checkStrategy(transaction: ParsedTransaction): StrategyCheckResult {
    const { merchant, category, cardLastFour, currency } = transaction;
    const merchantLower = merchant.toLowerCase();

    // Find which card was used
    const cardUsed = this.findCardByLastFour(cardLastFour);
    const cardUsedName = cardUsed?.cardName ?? `Card ****${cardLastFour}`;

    // Check merchant-specific rules first
    for (const [pattern, bestCards] of this.merchantRules) {
      if (merchantLower.includes(pattern)) {
        const isOptimal = bestCards.some(
          (cardName) => cardUsed?.cardName === cardName
        );

        if (!isOptimal) {
          // Special case: Costco with Amex is impossible
          if (pattern === 'costco' && cardUsed?.cardName.includes('Amex')) {
            return {
              isOptimal: false,
              cardUsed: cardUsedName,
              recommendedCard: bestCards[0],
              suggestion: `Costco only accepts Mastercard. Amex won't work here.`,
            };
          }

          return {
            isOptimal: false,
            cardUsed: cardUsedName,
            recommendedCard: bestCards[0],
            suggestion: `${merchant} is best with ${bestCards[0]}.`,
          };
        }

        return { isOptimal: true, cardUsed: cardUsedName };
      }
    }

    // Check category-based rules
    const bestCardForCategory = this.findBestCardForCategory(category);

    if (bestCardForCategory && cardUsed?.cardName !== bestCardForCategory.cardName) {
      // Check if it's a foreign transaction
      const isForeign = currency !== 'CAD';

      if (isForeign) {
        // For foreign transactions, consider FX fees
        const bestForeignCard = this.findBestCardForForeign();
        if (bestForeignCard && cardUsed?.cardName !== bestForeignCard.cardName) {
          return {
            isOptimal: false,
            cardUsed: cardUsedName,
            recommendedCard: bestForeignCard.cardName,
            suggestion: `Foreign transaction. ${bestForeignCard.cardName} has no FX fee.`,
          };
        }
      }

      return {
        isOptimal: false,
        cardUsed: cardUsedName,
        recommendedCard: bestCardForCategory.cardName,
        suggestion: `${category} purchases earn more with ${bestCardForCategory.cardName} (${bestCardForCategory.multiplier}).`,
      };
    }

    return { isOptimal: true, cardUsed: cardUsedName };
  }

  /**
   * Find card by last 4 digits
   */
  private findCardByLastFour(lastFour: string): CardStrategy | undefined {
    if (lastFour === 'unknown') return undefined;
    return this.strategies.find((s) => s.lastFourDigits === lastFour);
  }

  /**
   * Find the best card for a given category
   */
  private findBestCardForCategory(category: Category): CardStrategy | undefined {
    return this.strategies.find((s) =>
      s.bestFor.includes(category as any)
    );
  }

  /**
   * Find the best card for foreign transactions (lowest FX fee)
   */
  private findBestCardForForeign(): CardStrategy | undefined {
    return this.strategies
      .filter((s) => s.foreignTxFee !== undefined)
      .sort((a, b) => (a.foreignTxFee ?? 99) - (b.foreignTxFee ?? 99))[0];
  }

  /**
   * Get recommendation before a transaction
   */
  recommendCard(
    merchant: string,
    category: Category,
    isForeign: boolean = false
  ): CardStrategy | undefined {
    const merchantLower = merchant.toLowerCase();

    // Check merchant rules first
    for (const [pattern, bestCards] of this.merchantRules) {
      if (merchantLower.includes(pattern)) {
        return this.strategies.find((s) => s.cardName === bestCards[0]);
      }
    }

    // Foreign transaction priority
    if (isForeign) {
      return this.findBestCardForForeign();
    }

    // Category-based
    return this.findBestCardForCategory(category);
  }

  /**
   * Add a new card strategy
   */
  addCard(strategy: CardStrategy): void {
    // Remove existing card with same last 4 digits
    this.strategies = this.strategies.filter(
      (s) => s.lastFourDigits !== strategy.lastFourDigits
    );
    this.strategies.push(strategy);
  }

  /**
   * Update card's last 4 digits
   */
  updateCardDigits(cardName: string, newLastFour: string): void {
    const card = this.strategies.find((s) => s.cardName === cardName);
    if (card) {
      card.lastFourDigits = newLastFour;
    }
  }

  /**
   * Get all configured cards
   */
  getCards(): CardStrategy[] {
    return [...this.strategies];
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Quick strategy check without instantiating
 */
export function checkCardStrategy(
  transaction: ParsedTransaction,
  strategies?: CardStrategy[]
): StrategyCheckResult {
  const engine = new CardStrategyEngine(strategies);
  return engine.checkStrategy(transaction);
}

/**
 * Format strategy check result for display
 */
export function formatStrategyResult(result: StrategyCheckResult): string {
  if (result.isOptimal) {
    return `✅ ${result.cardUsed} - Optimal choice`;
  }

  return `⚠️ ${result.cardUsed}\n💡 ${result.suggestion}`;
}
