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

// Strategy
export {
  CardStrategyEngine,
  DEFAULT_CARD_STRATEGIES,
  checkCardStrategy,
  formatStrategyResult,
} from './strategy.js';
