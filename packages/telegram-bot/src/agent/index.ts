/**
 * Agent Orchestrator
 * Main entry point for the FinTrack AI Agent system
 * Uses Memory-First Architecture with OpenAI function calling
 */

import {
  MemoryAgent,
  type AgentResult,
  type Session,
} from '@fintrack-ai/core';
import type { Environment, TelegramUser } from '../types.js';
import type { User, Project } from '@fintrack-ai/core';
import { getSession, clearSession, isIdleSession } from './session.js';
import { getWorkingMemory, addMessage, extendMemoryTTL } from './memory-session.js';
import { getProjectMembers } from '../db/index.js';
import { getToolRegistry } from '../tools/index.js';

// ============================================
// Agent Context
// ============================================

export interface AgentContext {
  readonly chatId: number;
  readonly user: User;
  readonly project: Project;
  readonly environment: Environment;
  readonly telegramUser: TelegramUser;
}

// ============================================
// Main Agent Entry Point
// ============================================

export async function processWithAgent(
  text: string,
  context: AgentContext
): Promise<AgentResult> {
  const { user, project, environment, chatId } = context;

  // Check for active session state (legacy multi-turn conversation)
  const session = await getSession(environment.DB, user.id, chatId);

  // Handle session-based flows first (legacy)
  if (!isIdleSession(session)) {
    return handleSessionFlow(text, session!, context);
  }

  // Get working memory for context
  const workingMemory = await getWorkingMemory(environment.DB, user.id, chatId);

  console.log('[Agent] Working memory:', JSON.stringify({
    hasLastTransaction: workingMemory.lastTransaction != null,
    lastTransactionMerchant: workingMemory.lastTransaction?.merchant,
    recentMessagesCount: workingMemory.recentMessages.length,
  }));

  // Extend memory TTL on interaction
  await extendMemoryTTL(environment.DB, user.id, chatId);

  // Get tool registry and definitions
  const registry = getToolRegistry();
  const toolDefinitions = registry.getForLLM();

  // Use Memory Agent to decide action via function calling
  const memoryAgent = new MemoryAgent(environment.OPENAI_API_KEY);
  const decision = await memoryAgent.decide(text, workingMemory, toolDefinitions);

  console.log(`[Agent] Decision: ${decision.type}${decision.type === 'tool_call' ? ` → ${decision.toolName}` : ''}`);

  // Add user message to memory
  await addMessage(environment.DB, user.id, chatId, 'user', text);

  // Handle text response (greetings, clarify, unknown)
  if (decision.type === 'text') {
    await addMessage(environment.DB, user.id, chatId, 'assistant', decision.message);
    return { type: 'message', message: decision.message };
  }

  // Handle tool call
  const tool = registry.get(decision.toolName);

  if (tool == null) {
    const errorMessage = `Unknown tool: ${decision.toolName}`;
    console.error(`[Agent] ${errorMessage}`);
    return { type: 'error', message: errorMessage };
  }

  // Get project members for tool context
  const participants = await getProjectMembers(environment, project.id);

  // Get payer name
  const membership = await environment.DB.prepare(
    'SELECT display_name FROM project_members WHERE project_id = ? AND user_id = ?'
  ).bind(project.id, user.id).first();
  const payerName = (membership?.display_name as string) ?? user.firstName ?? 'User';

  // Build tool context
  const toolContext = {
    userId: user.id,
    projectId: project.id,
    projectName: project.name,
    participants,
    defaultCurrency: project.defaultCurrency,
    defaultLocation: project.defaultLocation,
    workingMemory,
    db: environment.DB,
    environment,
    chatId,
    payerName,
  };

  // Parse, execute, convert — each tool knows how to present itself
  const args = tool.parameters.parse(decision.toolArguments);
  const toolResult = await tool.execute(args, toolContext);
  const result = tool.toAgentResult(toolResult);

  // Add assistant response to memory (for non-delegate results)
  if (result.type === 'message' || result.type === 'error') {
    await addMessage(environment.DB, user.id, chatId, 'assistant', result.message);
  } else if (result.type === 'confirm') {
    await addMessage(environment.DB, user.id, chatId, 'assistant', result.message);
  }

  return result;
}

// ============================================
// Session Flow Handler (Legacy)
// ============================================

async function handleSessionFlow(
  text: string,
  session: Session,
  context: AgentContext
): Promise<AgentResult> {
  const { user, environment, chatId } = context;
  const { state } = session;

  switch (state.type) {
    case 'awaiting_edit_value': {
      // Clear session first
      await clearSession(environment.DB, user.id, chatId);

      // Trigger edit with the provided value
      const field = state.field;
      const callbackPrefix = getEditCallbackPrefix(field);

      // Return a confirmation
      return {
        type: 'confirm',
        message: `Change ${getFieldName(field)} to ${text}?`,
        keyboard: [
          [
            { text: '\u2705 Confirm', callback_data: `${callbackPrefix}_${state.transactionId}_${text}` },
            { text: '\u274c Cancel', callback_data: 'menu_main' },
          ],
        ],
      };
    }

    case 'awaiting_confirmation': {
      await clearSession(environment.DB, user.id, chatId);

      const lowerText = text.toLowerCase();
      if (lowerText === 'yes' || lowerText === 'y' || lowerText === 'ok') {
        return {
          type: 'confirm',
          message: 'Confirm action?',
          keyboard: [
            [
              { text: '\u2705 Confirm', callback_data: `${state.action}_${state.targetId}` },
              { text: '\u274c Cancel', callback_data: 'menu_main' },
            ],
          ],
        };
      } else {
        return {
          type: 'message',
          message: 'Cancelled',
        };
      }
    }

    case 'awaiting_intent_clarification': {
      // Clear session and re-process with memory agent
      await clearSession(environment.DB, user.id, chatId);
      return processWithAgent(text, context);
    }

    case 'awaiting_category': {
      // User is replying with custom category
      const newCategory = text.trim().toLowerCase();
      await clearSession(environment.DB, user.id, chatId);

      // Update the transaction
      await environment.DB.prepare(
        'UPDATE transactions SET category = ? WHERE id = ?'
      ).bind(newCategory, state.transactionId).run();

      return {
        type: 'message',
        message: `\u2705 Category updated to *${newCategory}* for ${state.merchant}`,
        parseMode: 'Markdown',
      };
    }

    default:
      // Clear invalid session
      await clearSession(environment.DB, user.id, chatId);
      // Re-process as new message
      return processWithAgent(text, context);
  }
}

// ============================================
// Helper Functions
// ============================================

function getEditCallbackPrefix(field: string): string {
  const prefixes: Record<string, string> = {
    amount: 'txe_amt',
    merchant: 'txe_mrc',
    category: 'txe_cat',
    split: 'txe_spl',
  };
  return prefixes[field] ?? 'txe_amt';
}

function getFieldName(field: string): string {
  const names: Record<string, string> = {
    amount: 'amount',
    merchant: 'merchant',
    category: 'category',
    split: 'split',
  };
  return names[field] ?? field;
}
