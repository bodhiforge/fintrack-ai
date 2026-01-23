/**
 * @fintrack-ai/core
 * Core business logic for FinTrack AI expense tracker
 */

// Types
export * from './types.js';

// Parser
export {
  TransactionParser,
  parseTransaction,
  parseBankEmail,
} from './parser.js';

// Splitter
export {
  splitExpense,
  calculateBalances,
  simplifyDebts,
  formatSettlements,
  parseNaturalLanguageSplit,
  convertCurrency,
  DEFAULT_RATES,
} from './splitter.js';

// Strategy (legacy - use cards.ts for new implementations)
export {
  CardStrategyEngine,
  DEFAULT_CARD_STRATEGIES,
  checkCardStrategy,
  formatStrategyResult,
} from './strategy.js';

// Cards & Recommendation
export * from './cards.js';
export {
  recommendCard,
  formatRecommendation,
  formatBenefits,
  formatCardSuggestion,
  type UserCardWithDetails,
  type RecommendationResult,
  type CardSuggestion,
} from './cardRecommender.js';
