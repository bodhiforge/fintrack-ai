/**
 * Tool Registry
 * Manages tool registration and provides OpenAI-compatible definitions
 *
 * Pi Agent-inspired implementation with:
 * - Centralized tool management
 * - OpenAI function calling format export
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool, ToolDefinition } from '@fintrack-ai/core';
import { recordTool } from './record-tool.js';
import { queryTool } from './query-tool.js';
import { modifyTool } from './modify-tool.js';
import { deleteTool } from './delete-tool.js';

// ============================================
// Tool Registry Implementation
// ============================================

export class ToolRegistry {
  private readonly tools: Map<string, Tool> = new Map();

  constructor() {
    // Register built-in tools
    this.register(recordTool);
    this.register(queryTool);
    this.register(modifyTool);
    this.register(deleteTool);
  }

  /**
   * Register a tool
   */
  register<TParams, TDetails, TDatabase>(
    tool: Tool<TParams, TDetails, TDatabase>
  ): void {
    this.tools.set(tool.name, tool as Tool);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): readonly Tool[] {
    return [...this.tools.values()];
  }

  /**
   * Get tool definitions for OpenAI function calling
   */
  getForLLM(): readonly ToolDefinition[] {
    return this.getAll().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters, {
          $refStrategy: 'none',
          target: 'openApi3',
        }) as Record<string, unknown>,
      },
    }));
  }

  /**
   * Get tool names
   */
  getNames(): readonly string[] {
    return [...this.tools.keys()];
  }
}

// ============================================
// Singleton Instance
// ============================================

let registryInstance: ToolRegistry | null = null;

/**
 * Get the global tool registry instance
 */
export function getToolRegistry(): ToolRegistry {
  if (registryInstance == null) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}

/**
 * Create a new tool registry (for testing)
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
