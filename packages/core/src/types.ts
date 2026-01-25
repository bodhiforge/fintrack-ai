/**
 * Core types for FinTrack AI
 */

// ============================================
// Transaction Types
// ============================================

export interface Transaction {
  readonly id: string;
  readonly projectId?: string;
  readonly date: string; // ISO 8601 format
  readonly merchant: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly category: Category;
  readonly location?: string;
  readonly cardLastFour: string;
  readonly payer: string;
  readonly isShared: boolean;
  readonly splits: Readonly<Record<string, number>>;
  readonly notes?: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
}

export interface ParsedTransaction {
  readonly merchant: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly category: Category;
  readonly cardLastFour: string;
  readonly date: string;
  readonly location?: string;
  readonly rawText?: string;
  // Split modifiers (extracted by LLM)
  readonly excludedParticipants?: readonly string[];
  readonly customSplits?: Readonly<Record<string, number>>;
}

// ============================================
// User & Project Types
// ============================================

export interface User {
  readonly id: number;                    // Telegram user ID
  readonly username?: string;
  readonly firstName?: string;
  readonly currentProjectId?: string;
  readonly createdAt: string;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly type: 'ongoing' | 'trip' | 'event';
  readonly defaultCurrency: Currency;
  readonly defaultLocation?: string;
  readonly inviteCode?: string;
  readonly inviteExpiresAt?: string;
  readonly ownerId: number;
  readonly isActive: boolean;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly createdAt: string;
}

export interface ProjectMember {
  readonly projectId: string;
  readonly userId: number;
  readonly displayName: string;
  readonly role: 'owner' | 'member';
  readonly joinedAt: string;
}

export type Currency = 'CAD' | 'USD' | 'EUR' | 'GBP' | 'MXN' | 'CRC' | 'JPY' | string;

// Common categories (GPT will use these, but custom values are allowed)
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
  | 'sports'
  | 'education'
  | 'other'
  | string;  // Allow custom categories

// ============================================
// Splitting Types
// ============================================

export interface SplitRequest {
  readonly totalAmount: number;
  readonly currency: Currency;
  readonly payer: string;
  readonly participants: readonly string[];
  readonly excludedParticipants?: readonly string[];
  readonly customSplits?: Readonly<Record<string, number>>; // For unequal splits
}

export interface SplitResult {
  readonly shares: Readonly<Record<string, number>>;
  readonly payer: string;
  readonly totalAmount: number;
  readonly currency: Currency;
}

export interface Settlement {
  readonly from: string;
  readonly to: string;
  readonly amount: number;
  readonly currency: Currency;
}

export interface Balance {
  readonly person: string;
  readonly netBalance: number; // positive = owed money, negative = owes money
}

// ============================================
// Telegram Types
// ============================================

export interface TelegramConfirmation {
  readonly transactionId: string;
  readonly messageText: string;
  readonly keyboard: InlineKeyboard;
}

export interface InlineKeyboard {
  readonly inline_keyboard: ReadonlyArray<readonly InlineKeyboardButton[]>;
}

export interface InlineKeyboardButton {
  readonly text: string;
  readonly callback_data: string;
}

// ============================================
// Configuration Types
// ============================================

export interface Config {
  readonly openaiApiKey: string;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly defaultCurrency: Currency;
  readonly defaultParticipants: readonly string[];
  readonly googleSheetsId?: string;
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface ConfidenceFactors {
  readonly merchant: number;  // 0-1: How clear is the merchant name
  readonly amount: number;    // 0-1: How clear is the amount
  readonly category: number;  // 0-1: How confident is the category match
}

export interface ParserResponse {
  readonly parsed: ParsedTransaction;
  readonly confidence: number;
  readonly confidenceFactors?: ConfidenceFactors;
  readonly warnings?: readonly string[];
}

// ============================================
// Few-shot Learning Types
// ============================================

export interface HistoryExample {
  readonly input: string;
  readonly merchant: string;
  readonly category: string;
  readonly currency: string;
}
