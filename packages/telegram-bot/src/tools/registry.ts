/**
 * Tool Registry
 * Manages tool registration and provides OpenAI-compatible definitions
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool, ToolDefinition } from '@fintrack-ai/core';
import { recordTool } from './record-tool.js';
import { queryTool } from './query-tool.js';
import { modifyAmountTool, modifyMerchantTool, modifyCategoryTool } from './modify-tool-factory.js';
import { deleteTool } from './delete-tool.js';

// ============================================
// Tool Registry Implementation
// ============================================

export class ToolRegistry {
  private readonly tools: Map<string, Tool> = new Map();

  constructor() {
    this.register(recordTool);
    this.register(queryTool);
    this.register(modifyAmountTool);
    this.register(modifyMerchantTool);
    this.register(modifyCategoryTool);
    this.register(deleteTool);
  }

  register<TParams, TDetails, TDatabase>(
    tool: Tool<TParams, TDetails, TDatabase>
  ): void {
    this.tools.set(tool.name, tool as Tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): readonly Tool[] {
    return [...this.tools.values()];
  }

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

  getNames(): readonly string[] {
    return [...this.tools.keys()];
  }
}

// ============================================
// Singleton Instance
// ============================================

let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (registryInstance == null) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}
