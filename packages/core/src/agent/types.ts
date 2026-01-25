/**
 * Agent Types
 * Core type definitions for the FinTrack AI Agent system
 */

// ============================================
// Intent Classification
// ============================================

export type Intent = 'record' | 'query' | 'modify' | 'chat';

export interface TimeRange {
  readonly start: string; // ISO date YYYY-MM-DD
  readonly end: string;   // ISO date YYYY-MM-DD
  readonly label?: string; // "this month", "last week"
}

export interface IntentEntities {
  // Query entities
  readonly queryType?: 'balance' | 'history' | 'total' | 'breakdown' | 'settlement';
  readonly timeRange?: TimeRange;
  readonly categoryFilter?: string;
  readonly personFilter?: string;
  readonly limit?: number;
  readonly sqlWhere?: string;
  readonly sqlOrderBy?: string;

  // Modify entities
  readonly modifyAction?: 'edit' | 'delete' | 'undo';
  readonly targetField?: 'amount' | 'merchant' | 'category' | 'split';
  readonly newValue?: string | number;
  readonly targetReference?: 'last' | string; // "last" or transaction ID
}

export interface IntentResult {
  readonly intent: Intent;
  readonly confidence: number;
  readonly entities: IntentEntities;
}

// ============================================
// Query Types
// ============================================

export type QueryType = 'total' | 'breakdown' | 'history' | 'balance' | 'settlement';

export interface ParsedQuery {
  readonly queryType: QueryType;
  readonly timeRange?: TimeRange;
  readonly category?: string;
  readonly person?: string;
  readonly limit?: number;
  readonly sqlWhere: string;
  readonly sqlOrderBy?: string;
}

export interface QuerySummary {
  readonly totalAmount: number;
  readonly transactionCount: number;
  readonly byCategory?: Readonly<Record<string, number>>;
  readonly byPerson?: Readonly<Record<string, number>>;
}

// ============================================
// Tool Types
// ============================================

export interface ToolContext {
  readonly userId: number;
  readonly projectId: string;
  readonly projectName: string;
  readonly participants: readonly string[];
  readonly defaultCurrency: string;
  readonly defaultLocation?: string;
}

export interface ToolResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly followUp?: FollowUpAction;
}

export interface FollowUpAction {
  readonly type: 'clarify' | 'confirm' | 'select';
  readonly message: string;
  readonly options?: readonly string[];
}

// ============================================
// Agent Result Types
// ============================================

export type AgentResultType = 'message' | 'confirm' | 'select' | 'delegate' | 'error';

interface BaseAgentResult {
  readonly type: AgentResultType;
}

export interface MessageResult extends BaseAgentResult {
  readonly type: 'message';
  readonly message: string;
  readonly parseMode?: 'Markdown' | 'HTML';
}

export interface ConfirmResult extends BaseAgentResult {
  readonly type: 'confirm';
  readonly message: string;
  readonly keyboard: ReadonlyArray<ReadonlyArray<{ text: string; callback_data: string }>>;
}

export interface SelectResult extends BaseAgentResult {
  readonly type: 'select';
  readonly message: string;
  readonly keyboard: ReadonlyArray<ReadonlyArray<{ text: string; callback_data: string }>>;
}

export interface DelegateResult extends BaseAgentResult {
  readonly type: 'delegate';
  readonly handler: 'parseTransaction' | 'handleUndo' | 'handleBalance' | 'handleHistory';
  readonly input: string | null;
}

export interface ErrorResult extends BaseAgentResult {
  readonly type: 'error';
  readonly message: string;
}

export type AgentResult =
  | MessageResult
  | ConfirmResult
  | SelectResult
  | DelegateResult
  | ErrorResult;

// ============================================
// Session Types
// ============================================

export interface IdleState {
  readonly type: 'idle';
}

export interface AwaitingEditValueState {
  readonly type: 'awaiting_edit_value';
  readonly transactionId: string;
  readonly field: 'amount' | 'merchant' | 'category' | 'split';
}

export interface AwaitingConfirmationState {
  readonly type: 'awaiting_confirmation';
  readonly action: 'delete' | 'settle';
  readonly targetId: string;
}

export interface AwaitingIntentClarificationState {
  readonly type: 'awaiting_intent_clarification';
  readonly originalText: string;
  readonly suggestedIntent: Intent;
}

export type SessionState =
  | IdleState
  | AwaitingEditValueState
  | AwaitingConfirmationState
  | AwaitingIntentClarificationState;

export interface Session {
  readonly userId: number;
  readonly chatId: number;
  readonly state: SessionState;
  readonly createdAt: string;
  readonly expiresAt: string;
}

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
