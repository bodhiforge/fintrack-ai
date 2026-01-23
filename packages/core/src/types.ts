/**
 * Core types for FinTrack AI
 */

// ============================================
// Transaction Types
// ============================================

export interface Transaction {
  id: string;
  date: string; // ISO 8601 format
  merchant: string;
  amount: number;
  currency: Currency;
  category: Category;
  cardLastFour: string;
  payer: string;
  isShared: boolean;
  splits: Record<string, number>;
  notes?: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface ParsedTransaction {
  merchant: string;
  amount: number;
  currency: Currency;
  category: Category;
  cardLastFour: string;
  date: string;
  rawText?: string;
}

export type Currency = 'CAD' | 'USD' | 'EUR' | 'GBP' | 'MXN' | 'CRC' | 'JPY' | string;

export type Category =
  | 'dining'
  | 'grocery'
  | 'gas'
  | 'shopping'
  | 'subscription'
  | 'travel'
  | 'transport'
  | 'entertainment'
  | 'health'
  | 'utilities'
  | 'streaming'
  | 'costco'
  | 'foreign'
  | 'usd'
  | 'recurring'
  | 'other';

// ============================================
// Card Strategy Types
// ============================================

export interface CardStrategy {
  cardName: string;
  lastFourDigits: string;
  bestFor: Category[];
  multiplier: string;
  foreignTxFee?: number; // percentage, e.g., 2.5
  notes?: string;
}

export interface StrategyCheckResult {
  isOptimal: boolean;
  cardUsed: string;
  recommendedCard?: string;
  pointsMissed?: number;
  suggestion?: string;
}

// ============================================
// Splitting Types
// ============================================

export interface SplitRequest {
  totalAmount: number;
  currency: Currency;
  payer: string;
  participants: string[];
  excludedParticipants?: string[];
  customSplits?: Record<string, number>; // For unequal splits
}

export interface SplitResult {
  shares: Record<string, number>;
  payer: string;
  totalAmount: number;
  currency: Currency;
}

export interface Settlement {
  from: string;
  to: string;
  amount: number;
  currency: Currency;
}

export interface Balance {
  person: string;
  netBalance: number; // positive = owed money, negative = owes money
}

// ============================================
// Telegram Types
// ============================================

export interface TelegramConfirmation {
  transactionId: string;
  messageText: string;
  keyboard: InlineKeyboard;
}

export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

// ============================================
// Configuration Types
// ============================================

export interface Config {
  openaiApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  defaultCurrency: Currency;
  defaultParticipants: string[];
  cardStrategies: CardStrategy[];
  googleSheetsId?: string;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ParserResponse {
  parsed: ParsedTransaction;
  confidence: number;
  warnings?: string[];
}
