/**
 * Agent Orchestrator
 * Main entry point for the FinTrack AI Agent system
 */

import {
  IntentClassifier,
  type AgentResult,
  type IntentResult,
  type ParsedQuery,
  type Session,
  type SessionState,
} from '@fintrack-ai/core';
import type { Environment, TelegramUser } from '../types.js';
import type { User, Project } from '@fintrack-ai/core';
import { getSession, updateSession, clearSession, isIdleSession } from './session.js';
import { executeQuery, findLastTransaction } from './query-executor.js';
import { formatQueryResponse } from './response-formatter.js';
import { getProjectMembers } from '../db/index.js';

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
  const { user, project, environment } = context;

  // Check for active session state (multi-turn conversation)
  const session = await getSession(environment.DB, user.id, context.chatId);

  // Handle session-based flows first
  if (!isIdleSession(session)) {
    return handleSessionFlow(text, session!, context);
  }

  // Classify intent using LLM
  const classifier = new IntentClassifier(environment.OPENAI_API_KEY);
  const intentResult = await classifier.classify(text);

  console.log(`[Agent] Intent: ${intentResult.intent}, confidence: ${intentResult.confidence}, text: "${text}"`);

  // Route based on intent
  return routeIntent(text, intentResult, context);
}

// ============================================
// Intent Routing
// ============================================

async function routeIntent(
  text: string,
  intent: IntentResult,
  context: AgentContext
): Promise<AgentResult> {
  switch (intent.intent) {
    case 'record':
      // Delegate to existing parser for recording expenses
      return {
        type: 'delegate',
        handler: 'parseTransaction',
        input: text,
      };

    case 'query':
      return handleQueryIntent(text, intent, context);

    case 'modify':
      return handleModifyIntent(text, intent, context);

    case 'chat':
      return handleChatIntent(text, context);

    default:
      return {
        type: 'delegate',
        handler: 'parseTransaction',
        input: text,
      };
  }
}

// ============================================
// Query Intent Handler
// ============================================

async function handleQueryIntent(
  text: string,
  intent: IntentResult,
  context: AgentContext
): Promise<AgentResult> {
  const { project, environment } = context;
  const { entities } = intent;

  // For balance/settlement, delegate to existing commands
  if (entities.queryType === 'balance') {
    return {
      type: 'delegate',
      handler: 'handleBalance',
      input: null,
    };
  }

  if (entities.queryType === 'settlement') {
    return {
      type: 'message',
      message: 'Use /settle to see settlement options',
    };
  }

  // Build ParsedQuery directly from intent entities (no second LLM call)
  const parsedQuery: ParsedQuery = {
    queryType: entities.queryType ?? 'history',
    timeRange: entities.timeRange,
    category: entities.categoryFilter,
    person: entities.personFilter,
    limit: entities.limit,
    sqlWhere: entities.sqlWhere ?? "status IN ('confirmed', 'personal')",
    sqlOrderBy: entities.sqlOrderBy ?? 'created_at DESC',
  };

  console.log('[Agent] Query from intent:', JSON.stringify(parsedQuery, null, 2));

  // Execute query
  const result = await executeQuery(parsedQuery, {
    db: environment.DB,
    projectId: project.id,
    defaultCurrency: project.defaultCurrency,
  });

  if (!result.success || result.data == null) {
    return {
      type: 'error',
      message: `❌ Query failed: ${result.error ?? 'Unknown error'}`,
    };
  }

  // Format response
  const formatted = formatQueryResponse(
    parsedQuery,
    result.data.transactions,
    result.data.summary,
    project.defaultCurrency
  );

  return {
    type: 'message',
    message: formatted.message,
    parseMode: formatted.parseMode,
  };
}

// ============================================
// Modify Intent Handler
// ============================================

async function handleModifyIntent(
  text: string,
  intent: IntentResult,
  context: AgentContext
): Promise<AgentResult> {
  const { user, project, environment } = context;
  const { entities } = intent;

  // Handle undo
  if (entities.modifyAction === 'undo') {
    return {
      type: 'delegate',
      handler: 'handleUndo',
      input: null,
    };
  }

  // Handle delete/edit with "last" reference
  if (entities.targetReference === 'last') {
    const lastTransaction = await findLastTransaction(
      environment.DB,
      project.id,
      user.id
    );

    if (lastTransaction == null) {
      return {
        type: 'message',
        message: '❌ No recent transaction found',
      };
    }

    // Handle delete
    if (entities.modifyAction === 'delete') {
      return {
        type: 'confirm',
        message: `Delete *${lastTransaction.merchant}* ($${lastTransaction.amount.toFixed(2)})?`,
        keyboard: [
          [
            { text: '✅ Confirm', callback_data: `delete_${lastTransaction.id}` },
            { text: '❌ Cancel', callback_data: 'menu_main' },
          ],
        ],
      };
    }

    // Handle edit with value
    if (entities.modifyAction === 'edit' && entities.newValue != null) {
      const field = entities.targetField ?? 'amount';
      const callbackPrefix = getEditCallbackPrefix(field);

      // For direct value edits, trigger the edit callback
      return {
        type: 'confirm',
        message: `Change ${getFieldName(field)} of *${lastTransaction.merchant}* to ${entities.newValue}?`,
        keyboard: [
          [
            { text: '✅ Confirm', callback_data: `${callbackPrefix}_${lastTransaction.id}_${entities.newValue}` },
            { text: '❌ Cancel', callback_data: 'menu_main' },
          ],
        ],
      };
    }

    // Handle edit without value - need to ask
    if (entities.modifyAction === 'edit') {
      const field = entities.targetField ?? 'amount';

      // Set session state to await value
      await updateSession(environment.DB, user.id, context.chatId, {
        type: 'awaiting_edit_value',
        transactionId: lastTransaction.id,
        field,
      });

      return {
        type: 'message',
        message: `✏️ Edit *${lastTransaction.merchant}* ($${lastTransaction.amount.toFixed(2)})\n\nEnter new ${getFieldName(field)}:`,
        parseMode: 'Markdown',
      };
    }
  }

  // Generic modify request without clear target
  return {
    type: 'message',
    message: '🤔 Please specify which transaction to modify\n\nExamples:\n- "change to 50" (edit last amount)\n- "delete the last one"\n- Use /history to see transactions',
  };
}

// ============================================
// Chat Intent Handler
// ============================================

async function handleChatIntent(
  text: string,
  context: AgentContext
): Promise<AgentResult> {
  const { project } = context;

  return {
    type: 'message',
    message: `👋 Hi! I'm your expense tracking assistant\n\n` +
      `📁 Current project: *${project.name}*\n\n` +
      `Log expenses like "coffee 5" or "lunch 30"\n` +
      `Query spending like "how much this month"\n\n` +
      `Use /help for more commands`,
    parseMode: 'Markdown',
  };
}

// ============================================
// Session Flow Handler
// ============================================

async function handleSessionFlow(
  text: string,
  session: Session,
  context: AgentContext
): Promise<AgentResult> {
  const { user, environment } = context;
  const { state } = session;

  switch (state.type) {
    case 'awaiting_edit_value': {
      // Clear session first
      await clearSession(environment.DB, user.id, context.chatId);

      // Trigger edit with the provided value
      const field = state.field;
      const callbackPrefix = getEditCallbackPrefix(field);

      // Return a confirmation
      return {
        type: 'confirm',
        message: `Change ${getFieldName(field)} to ${text}?`,
        keyboard: [
          [
            { text: '✅ Confirm', callback_data: `${callbackPrefix}_${state.transactionId}_${text}` },
            { text: '❌ Cancel', callback_data: 'menu_main' },
          ],
        ],
      };
    }

    case 'awaiting_confirmation': {
      await clearSession(environment.DB, user.id, context.chatId);

      const lowerText = text.toLowerCase();
      if (lowerText === 'yes' || lowerText === 'y' || lowerText === 'ok') {
        return {
          type: 'confirm',
          message: 'Confirm action?',
          keyboard: [
            [
              { text: '✅ Confirm', callback_data: `${state.action}_${state.targetId}` },
              { text: '❌ Cancel', callback_data: 'menu_main' },
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

    default:
      // Clear invalid session
      await clearSession(environment.DB, user.id, context.chatId);
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
