/**
 * Prompt Builder
 * Builds system prompt and conversation messages for the agentic loop
 */

import type { WorkingMemory } from '@fintrack-ai/core';

// ============================================
// System Prompt
// ============================================

export function buildSystemPrompt(memory: WorkingMemory, projectName: string): string {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const year = now.getFullYear().toString();

  const memorySection = formatWorkingMemory(memory);

  return `You are an expense tracking assistant for project "${projectName}".
Be concise but warm. Respond naturally, not with templates.

## Working Memory
${memorySection}

## Date Handling
Today is ${today} (year ${year}). ALWAYS use year ${year} for dates.

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
- When recording, pass the user's original text as rawText so the parser can handle it
- For queries, generate a SQL WHERE clause with status filter: status IN ('confirmed', 'personal')
- Corrections ONLY apply when lastTransaction exists in working memory
- Use modify_expense for corrections — it can update amount, merchant, and/or category in one call
- For greetings, help, or unrecognized requests, just respond with text (no tool call)
- Keep responses short. Use bold for merchant names and amounts
- Only mention split details when the project has multiple participants

## Response Style
- "Got it! Recorded $5.00 at Starbucks under dining" (not a formatted template)
- "Updated the amount to $25.00" (not "✅ Updated *amount*: $15.00 → $25.00")
- "Here's your spending this week:" followed by data (not raw SQL results)`;
}

// ============================================
// Working Memory Formatting
// ============================================

function formatWorkingMemory(memory: WorkingMemory): string {
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

// ============================================
// Conversation Messages
// ============================================

export function buildConversationMessages(
  memory: WorkingMemory
): readonly { readonly role: 'user' | 'assistant'; readonly content: string }[] {
  return memory.recentMessages.map(message => ({
    role: message.role,
    content: message.content,
  }));
}
