/**
 * Action Schema
 * Unified action schema for Memory Agent (OpenAI structured output compatible)
 */

import { z } from 'zod';

// ============================================
// Transaction Schema (for record action)
// ============================================

export const TransactionDataSchema = z.object({
  merchant: z.string().describe('Merchant name'),
  amount: z.number().describe('Amount spent'),
  currency: z.string().describe('Currency code'),
  category: z.string().describe('Transaction category'),
  date: z.string().describe('Date in YYYY-MM-DD format'),
  location: z.string().nullable().describe('Location if specified'),
});

// ============================================
// Query Schema (for query action)
// ============================================

export const QueryDataSchema = z.object({
  queryType: z.enum(['balance', 'history', 'total', 'breakdown', 'settlement'])
    .describe('Type of query'),
  timeRange: z.object({
    start: z.string(),
    end: z.string(),
    label: z.string().nullable(),
  }).nullable().describe('Time range for query'),
  categoryFilter: z.string().nullable().describe('Category to filter by'),
  personFilter: z.string().nullable().describe('Person to filter by'),
  limit: z.number().nullable().describe('Max results'),
  sqlWhere: z.string().describe('SQL WHERE clause (without WHERE keyword)'),
  sqlOrderBy: z.string().nullable().describe('SQL ORDER BY clause'),
});

// ============================================
// Modify Schema (for modify action)
// ============================================

export const ModifyDataSchema = z.object({
  target: z.enum(['last', 'specific']).describe('Target transaction'),
  transactionId: z.string().nullable().describe('ID if target is specific'),
  field: z.enum(['amount', 'merchant', 'category', 'split'])
    .describe('Field to modify'),
  newValue: z.union([z.string(), z.number()]).describe('New value'),
});

// ============================================
// Delete Schema (for delete action)
// ============================================

export const DeleteDataSchema = z.object({
  target: z.enum(['last', 'specific']).describe('Target transaction'),
  transactionId: z.string().nullable().describe('ID if target is specific'),
});

// ============================================
// Clarify Schema (for clarify action)
// ============================================

export const ClarifyDataSchema = z.object({
  question: z.string().describe('Question to ask user'),
  options: z.array(z.string()).describe('Options to present'),
  context: z.string().nullable().describe('Context for the clarification'),
});

// ============================================
// Respond Schema (for respond action)
// ============================================

export const RespondDataSchema = z.object({
  message: z.string().describe('Response message to user'),
});

// ============================================
// Unified Action Schema (OpenAI compatible)
// ============================================

export const ActionSchema = z.object({
  action: z.enum(['record', 'query', 'modify', 'delete', 'clarify', 'respond'])
    .describe('The action to take'),
  reasoning: z.string().describe('Why this action was chosen'),

  // Optional data for each action type (only one should be filled based on action)
  transaction: TransactionDataSchema.nullable()
    .describe('Transaction data (required when action is "record")'),
  query: QueryDataSchema.nullable()
    .describe('Query data (required when action is "query")'),
  modify: ModifyDataSchema.nullable()
    .describe('Modify data (required when action is "modify")'),
  delete: DeleteDataSchema.nullable()
    .describe('Delete data (required when action is "delete")'),
  clarify: ClarifyDataSchema.nullable()
    .describe('Clarify data (required when action is "clarify")'),
  respond: RespondDataSchema.nullable()
    .describe('Respond data (required when action is "respond")'),
});

// ============================================
// Type Exports
// ============================================

export type TransactionData = z.infer<typeof TransactionDataSchema>;
export type QueryData = z.infer<typeof QueryDataSchema>;
export type ModifyData = z.infer<typeof ModifyDataSchema>;
export type DeleteData = z.infer<typeof DeleteDataSchema>;
export type ClarifyData = z.infer<typeof ClarifyDataSchema>;
export type RespondData = z.infer<typeof RespondDataSchema>;

export type Action = z.infer<typeof ActionSchema>;

// Type guards for action types
export function isRecordAction(action: Action): action is Action & { action: 'record'; transaction: TransactionData } {
  return action.action === 'record' && action.transaction != null;
}

export function isQueryAction(action: Action): action is Action & { action: 'query'; query: QueryData } {
  return action.action === 'query' && action.query != null;
}

export function isModifyAction(action: Action): action is Action & { action: 'modify'; modify: ModifyData } {
  return action.action === 'modify' && action.modify != null;
}

export function isDeleteAction(action: Action): action is Action & { action: 'delete'; delete: DeleteData } {
  return action.action === 'delete' && action.delete != null;
}

export function isClarifyAction(action: Action): action is Action & { action: 'clarify'; clarify: ClarifyData } {
  return action.action === 'clarify' && action.clarify != null;
}

export function isRespondAction(action: Action): action is Action & { action: 'respond'; respond: RespondData } {
  return action.action === 'respond' && action.respond != null;
}
