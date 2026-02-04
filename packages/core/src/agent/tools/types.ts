/**
 * Pi Agent-style Tool System Types
 * Inspired by Pi Agent's design philosophy:
 * 1. Type-safe parameters with Zod schemas
 * 2. Dual return: content (for LLM) + details (for UI)
 * 3. Explicit success/error handling
 *
 * Note: These types are distinct from the legacy ToolResult/ToolContext
 * in agent/types.ts to maintain backward compatibility.
 */

import { z } from 'zod';
import type { WorkingMemory } from '../types.js';

// ============================================
// Pi-style Tool Context (execution environment)
// ============================================

/**
 * Base context for Pi-style tools
 * Extended by telegram-bot with D1Database
 */
export interface PiToolContext {
  readonly userId: number;
  readonly projectId: string;
  readonly projectName: string;
  readonly participants: readonly string[];
  readonly defaultCurrency: string;
  readonly defaultLocation?: string;
  readonly workingMemory: WorkingMemory | null;
}

/**
 * Extended context with database access
 * TDatabase is generic to support D1Database or other types
 */
export interface PiToolContextWithDb<TDatabase = unknown> extends PiToolContext {
  readonly db: TDatabase;
}

// ============================================
// Pi-style Tool Result (dual return pattern)
// ============================================

/**
 * Pi-style tool execution result
 * - content: Text for LLM to use in continued conversation
 * - details: Structured data for UI rendering
 */
export interface PiToolResult<TDetails = unknown> {
  readonly success: boolean;
  readonly content: string;      // For LLM (natural language)
  readonly details?: TDetails;   // For UI (structured data)
  readonly error?: string;       // Error message if success is false
}

// ============================================
// Pi-style Tool Interface
// ============================================

/**
 * Pi Agent-style Tool interface
 *
 * @template TParams - Parameters schema (validated by Zod)
 * @template TDetails - Details returned for UI
 * @template TDatabase - Database type (D1Database, etc.)
 */
export interface Tool<
  TParams = unknown,
  TDetails = unknown,
  TDatabase = unknown
> {
  /** Unique tool name (used in function calling) */
  readonly name: string;

  /** Human-readable description (used in LLM prompts) */
  readonly description: string;

  /** Zod schema for parameter validation */
  readonly parameters: z.ZodSchema<TParams>;

  /**
   * Execute the tool
   * @param args - Validated parameters
   * @param context - Execution context with database access
   * @returns Promise resolving to PiToolResult
   */
  execute(
    args: TParams,
    context: PiToolContextWithDb<TDatabase>
  ): Promise<PiToolResult<TDetails>>;
}

// ============================================
// Tool Definition (for LLM function calling)
// ============================================

/**
 * OpenAI-compatible function definition
 */
export interface ToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

// ============================================
// Tool Registry Interface
// ============================================

/**
 * Registry for managing tools
 */
export interface ToolRegistryInterface {
  /** Register a tool */
  register<TParams, TDetails, TDatabase>(
    tool: Tool<TParams, TDetails, TDatabase>
  ): void;

  /** Get a tool by name */
  get(name: string): Tool | undefined;

  /** Get all registered tools */
  getAll(): readonly Tool[];

  /** Get tool definitions for LLM function calling */
  getForLLM(): readonly ToolDefinition[];
}

// ============================================
// Utility Types
// ============================================

/**
 * Extract the parameters type from a Tool
 */
export type ToolParams<T> = T extends Tool<infer P, unknown, unknown> ? P : never;

/**
 * Extract the details type from a Tool
 */
export type ToolDetails<T> = T extends Tool<unknown, infer D, unknown> ? D : never;

