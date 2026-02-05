/**
 * Tool System Types
 * Simplified for agentic loop architecture:
 * - Tools return ToolExecutionResult (content for LLM + optional keyboard)
 * - LLM sees tool results and generates natural responses
 */

import { z } from 'zod';
import type { WorkingMemory } from '../types.js';

// ============================================
// Keyboard Types
// ============================================

export interface KeyboardButton {
  readonly text: string;
  readonly callback_data: string;
}

export type Keyboard = readonly (readonly KeyboardButton[])[];

// ============================================
// Tool Execution Result
// ============================================

/**
 * Result returned by tool.execute()
 * - content: Text the LLM sees (fed back as tool role message)
 * - keyboard: Optional UI buttons attached to the final response
 */
export interface ToolExecutionResult {
  readonly content: string;
  readonly keyboard?: Keyboard;
}

// ============================================
// Tool Interface
// ============================================

export interface Tool<TParams = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodSchema<TParams>;
  execute(args: TParams, context: ToolContext): Promise<ToolExecutionResult>;
}

// ============================================
// Tool Context
// ============================================

export interface ToolContext {
  readonly db: unknown;
  readonly openaiApiKey: string;
  readonly userId: number;
  readonly chatId: number;
  readonly projectId: string;
  readonly projectName: string;
  readonly participants: readonly string[];
  readonly defaultCurrency: string;
  readonly defaultLocation?: string;
  readonly payerName: string;
  readonly workingMemory: WorkingMemory | null;
}

// ============================================
// Tool Definition (for LLM function calling)
// ============================================

export interface ToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}
