/**
 * @fintrack-ai/core
 * Core business logic for FinTrack AI expense tracker
 */

// Types
export * from './types.js';

// Constants
export * from './constants.js';

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
  convertCurrency,
  DEFAULT_RATES,
} from './splitter.js';

// Cards & Recommendation
export * from './cards.js';
export {
  recommendCard,
  detectForeignByLocation,
  formatRecommendation,
  formatRecommendationWithValue,
  formatBenefits,
  formatCardSuggestion,
  type UserCardWithDetails,
  type RecommendationResult,
  type CardSuggestion,
} from './cardRecommender.js';

// Agent
export * from './agent/index.js';
