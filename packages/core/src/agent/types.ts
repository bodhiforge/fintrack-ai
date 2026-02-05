/**
 * Agent Types
 * Core type definitions for the FinTrack AI Agent system
 */

// ============================================
// Working Memory Types
// ============================================

export interface LastTransaction {
  readonly id: string;
  readonly merchant: string;
  readonly amount: number;
  readonly currency: string;
  readonly category: string;
  readonly createdAt: string;
}

export interface ConversationMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly timestamp: string;
}

export interface PendingClarification {
  readonly transactionId: string;
  readonly field: 'amount' | 'merchant' | 'category';
  readonly originalValue: string | number;
}

export interface WorkingMemory {
  readonly lastTransaction: LastTransaction | null;
  readonly pendingClarification: PendingClarification | null;
  readonly recentMessages: readonly ConversationMessage[];
}
