/**
 * Memory Agent
 * Single LLM call with working memory context
 * Uses OpenAI function calling (tools) instead of structured output
 */

import OpenAI from 'openai';
import type { WorkingMemory, AgentDecision, ToolCallDecision, TextDecision } from './types.js';
import type { ToolDefinition } from './tools/types.js';

// ============================================
// System Prompt Template
// ============================================

const MEMORY_AGENT_SYSTEM_PROMPT = `You are an expense tracking assistant that understands context and corrections.

## Working Memory
{workingMemory}

## Date Handling
Today is {today} (year {year}). ALWAYS use year {year} for dates.

## Category Names (lowercase)
dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, sports, education, other

## Common Merchants → Categories
- Coffee shops (Starbucks, Blue Bottle) → dining
- H Mart, Trader Joe's, Whole Foods, Costco → grocery
- Shell, Chevron → gas
- Amazon → shopping
- Uber, Lyft → transport
- Netflix, Spotify → subscription

## Guidelines
- If user provides a NUMBER after a recent transaction, it's likely an amount correction → use modify_amount
- If user provides a NAME after a recent transaction, it's likely a merchant correction → use modify_merchant
- If user provides a CATEGORY word after a recent transaction, it's likely a category correction → use modify_category
- Corrections ONLY apply when lastTransaction exists in working memory
- For greetings, help, or unrecognized requests, just respond with text (no tool call)
- When recording, pass the user's original text as rawText so the parser can handle it
- For queries, generate a SQL WHERE clause with status filter: status IN ('confirmed', 'personal')`;

// ============================================
// Memory Agent Class
// ============================================

export interface MemoryAgentOptions {
  readonly model?: string;
}

export class MemoryAgent {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, options?: MemoryAgentOptions) {
    this.client = new OpenAI({ apiKey });
    this.model = options?.model ?? 'gpt-4o-mini';
  }

  /**
   * Decide what action to take based on user input and working memory
   * Returns either a tool call or a text response
   */
  async decide(
    text: string,
    memory: WorkingMemory,
    toolDefinitions: readonly ToolDefinition[]
  ): Promise<AgentDecision> {
    const systemPrompt = this.buildSystemPrompt(memory);

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...this.buildConversationMessages(memory),
          { role: 'user', content: text },
        ],
        tools: toolDefinitions.map(definition => ({
          type: definition.type,
          function: {
            name: definition.function.name,
            description: definition.function.description,
            parameters: definition.function.parameters,
          },
        })),
        tool_choice: 'auto',
        temperature: 0,
      });

      const message = completion.choices[0]?.message;

      if (message?.tool_calls != null && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0];
        const decision: ToolCallDecision = {
          type: 'tool_call',
          toolName: toolCall.function.name,
          toolArguments: JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
        };
        return decision;
      }

      const decision: TextDecision = {
        type: 'text',
        message: message?.content ?? "I didn't understand that. Please try again.",
      };
      return decision;
    } catch (error) {
      console.error('[MemoryAgent] Error:', error instanceof Error ? error.message : error);
      const fallback: TextDecision = {
        type: 'text',
        message: 'Something went wrong. Please try again.',
      };
      return fallback;
    }
  }

  /**
   * Build system prompt with working memory context
   */
  private buildSystemPrompt(memory: WorkingMemory): string {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const year = now.getFullYear().toString();

    const memorySection = this.formatWorkingMemory(memory);

    return MEMORY_AGENT_SYSTEM_PROMPT
      .replace('{workingMemory}', memorySection)
      .replace(/{today}/g, today)
      .replace(/{year}/g, year);
  }

  /**
   * Format working memory for prompt
   */
  private formatWorkingMemory(memory: WorkingMemory): string {
    const sections: readonly string[] = [
      memory.lastTransaction != null
        ? `### Last Transaction (can be modified/deleted)
- ID: ${memory.lastTransaction.id}
- Merchant: ${memory.lastTransaction.merchant}
- Amount: ${memory.lastTransaction.amount} ${memory.lastTransaction.currency}
- Category: ${memory.lastTransaction.category}
- Created: ${memory.lastTransaction.createdAt}`
        : '### Last Transaction\nNone (no recent transaction to reference)',
      ...(memory.pendingClarification != null
        ? [`### Pending Clarification
- Transaction: ${memory.pendingClarification.transactionId}
- Field: ${memory.pendingClarification.field}
- Original: ${memory.pendingClarification.originalValue}`]
        : []),
    ];

    return sections.join('\n\n');
  }

  /**
   * Build conversation messages from recent history
   */
  private buildConversationMessages(memory: WorkingMemory): ReadonlyArray<{ readonly role: 'user' | 'assistant'; readonly content: string }> {
    return memory.recentMessages.map(message => ({
      role: message.role,
      content: message.content,
    }));
  }
}
