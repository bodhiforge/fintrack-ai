/**
 * Memory Agent
 * Single LLM call with working memory context for better understanding of corrections
 */

import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import OpenAI from 'openai';
import type { WorkingMemory, LastTransaction } from './types.js';
import { ActionSchema, type Action } from './action-schema.js';

// ============================================
// System Prompt Template
// ============================================

const MEMORY_AGENT_SYSTEM_PROMPT = `You are an expense tracking assistant that understands context and corrections.

## Your Capabilities
1. Record new expenses
2. Query spending data
3. Modify existing transactions
4. Delete transactions
5. Ask for clarification when needed
6. Respond to general chat

## Working Memory
{workingMemory}

## CRITICAL: Understanding Corrections

When user says something that references a previous transaction, they're likely correcting it:
- "No, I mean X" → Modify merchant to X
- "Actually it was Y" → Modify amount/merchant to Y
- "H Mart" after "hmark" → Modify merchant to "H Mart"
- "Wrong, it was 6" → Modify amount to 6
- "That was at Costco" → Modify merchant to Costco
- "25 not 20" → Modify amount to 25

If there's a lastTransaction and user input looks like a correction:
1. Use action: "modify" with target: "last"
2. Determine which field to modify (amount, merchant, category)
3. Extract the new value

## Date Handling
Today is {today} (year {year}). ALWAYS use year {year} for dates.

## Action Guidelines

### record
Use when user wants to log a NEW expense:
- Must have: merchant + amount
- Examples: "coffee 5", "lunch 30", "uber to airport 45"

### query
Use when user wants to VIEW/ANALYZE expenses:
- Types: total, breakdown, history, balance, settlement
- Generate SQL WHERE clause with status filter: status IN ('confirmed', 'personal')

### modify
Use when user wants to CHANGE an existing transaction:
- If lastTransaction exists and input references it, use target: "last"
- Fields: amount, merchant, category, split

### delete
Use when user explicitly wants to REMOVE a transaction:
- Keywords: "delete", "remove", "取消", "删除"

### clarify
Use when you need more information to proceed:
- Ambiguous input
- Multiple possible interpretations

### respond
Use for greetings, help requests, or general chat:
- "Hi", "Hello", "你好"
- "How to use this?"
- Off-topic messages

## Category Names (lowercase)
dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, sports, education, other

## Common Merchants → Categories
- Coffee shops (Starbucks, Blue Bottle) → dining
- H Mart, Trader Joe's, Whole Foods, Costco → grocery
- Shell, Chevron → gas
- Amazon → shopping
- Uber, Lyft → transport
- Netflix, Spotify → subscription

## Examples

### New Expense
User: "coffee 5"
→ action: record, transaction: {merchant: "Coffee", amount: 5, category: "dining", ...}

### Query
User: "how much this month"
→ action: query, query: {queryType: "total", sqlWhere: "status IN ('confirmed', 'personal') AND ...", ...}

### Correction (with lastTransaction)
lastTransaction: {merchant: "hmark", amount: 62.64, category: "other"}
User: "No, I mean H Mart"
→ action: modify, modify: {target: "last", field: "merchant", newValue: "H Mart"}

### Amount Correction
lastTransaction: {merchant: "Lunch", amount: 20}
User: "Actually 25"
→ action: modify, modify: {target: "last", field: "amount", newValue: 25}

### Greeting
User: "Hi"
→ action: respond, respond: {message: "Hello! I can help you track expenses..."}`;

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
   */
  async decide(text: string, memory: WorkingMemory): Promise<Action> {
    const systemPrompt = this.buildSystemPrompt(memory);

    try {
      const completion = await this.client.beta.chat.completions.parse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...this.buildConversationMessages(memory),
          { role: 'user', content: text },
        ],
        response_format: zodResponseFormat(ActionSchema, 'action'),
        temperature: 0,
      });

      const parsed = completion.choices[0]?.message?.parsed;

      if (parsed == null) {
        return this.fallbackResponse('I didn\'t understand that. Please try again.');
      }

      return parsed as Action;
    } catch (error) {
      console.error('[MemoryAgent] Error:', error instanceof Error ? error.message : error);
      return this.fallbackResponse('Something went wrong. Please try again.');
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
    const sections: string[] = [];

    // Last transaction
    if (memory.lastTransaction != null) {
      const tx = memory.lastTransaction;
      sections.push(`### Last Transaction (can be modified/deleted)
- ID: ${tx.id}
- Merchant: ${tx.merchant}
- Amount: ${tx.amount} ${tx.currency}
- Category: ${tx.category}
- Created: ${tx.createdAt}`);
    } else {
      sections.push('### Last Transaction\nNone (no recent transaction to reference)');
    }

    // Pending clarification
    if (memory.pendingClarification != null) {
      const pc = memory.pendingClarification;
      sections.push(`### Pending Clarification
- Transaction: ${pc.transactionId}
- Field: ${pc.field}
- Original: ${pc.originalValue}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Build conversation messages from recent history
   */
  private buildConversationMessages(memory: WorkingMemory): Array<{ role: 'user' | 'assistant'; content: string }> {
    return memory.recentMessages.map(message => ({
      role: message.role,
      content: message.content,
    }));
  }

  /**
   * Fallback response for errors
   */
  private fallbackResponse(message: string): Action {
    return {
      action: 'respond',
      reasoning: 'Fallback due to error',
      transaction: null,
      query: null,
      modify: null,
      delete: null,
      clarify: null,
      respond: { message },
    };
  }
}
