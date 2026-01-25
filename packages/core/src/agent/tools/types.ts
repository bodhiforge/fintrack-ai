/**
 * Tool System Types
 * Note: Actual tool implementations are in telegram-bot package (has D1 types)
 */

import type { ToolContext, ToolResult } from '../types.js';

/**
 * Generic Tool interface
 * TDatabase is a generic to allow D1Database or other database types
 */
export interface Tool<TInput, TOutput, TDatabase = unknown> {
  readonly name: string;
  readonly description: string;
  execute(
    input: TInput,
    context: ToolContext & { readonly db: TDatabase }
  ): Promise<ToolResult<TOutput>>;
}

/**
 * Tool registry for dynamic tool lookup
 */
export type ToolRegistry = Map<string, Tool<unknown, unknown, unknown>>;
