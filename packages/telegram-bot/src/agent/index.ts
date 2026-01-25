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

// Confidence threshold for clarification
const CLARIFICATION_THRESHOLD = 0.7;

async function routeIntent(
  text: string,
  intent: IntentResult,
  context: AgentContext
): Promise<AgentResult> {
  // Low confidence → ask user to clarify (except for chat intent)
  if (intent.confidence < CLARIFICATION_THRESHOLD && intent.intent !== 'chat') {
    return handleLowConfidence(text, intent, context);
  }

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
// Low Confidence Handler
// ============================================

async function handleLowConfidence(
  text: string,
  intent: IntentResult,
  context: AgentContext
): Promise<AgentResult> {
  const { user, environment } = context;

  // Store the original text in session for later use
  await updateSession(environment.DB, user.id, context.chatId, {
    type: 'awaiting_intent_clarification',
    originalText: text,
    suggestedIntent: intent.intent,
  });

  // Build clarification options based on what the text looks like
  const hasNumber = /\d/.test(text);
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  const buttons: Array<{ text: string; callback_data: string }> = [];

  if (hasNumber) {
    buttons.push({ text: '📝 Log expense', callback_data: 'clarify_record' });
  }
  buttons.push({ text: '📊 Query spending', callback_data: 'clarify_query' });
  keyboard.push(buttons);
  keyboard.push([{ text: '❌ Cancel', callback_data: 'clarify_cancel' }]);

  return {
    type: 'select',
    message: `🤔 I'm not sure what you meant by "${text}"\n\nWhat would you like to do?`,
    keyboard,
  };
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
  // Use LLM-generated sqlWhere if available, otherwise build from entities
  // Always fix the year in case LLM used wrong year (common issue)
  const rawSqlWhere = entities.sqlWhere ?? buildSqlWhere(entities);
  const sqlWhere = fixSqlWhereYear(rawSqlWhere);
  const parsedQuery: ParsedQuery = {
    queryType: entities.queryType ?? 'history',
    timeRange: entities.timeRange,
    category: entities.categoryFilter,
    person: entities.personFilter,
    limit: (entities.limit != null && entities.limit > 0) ? entities.limit : 50,
    sqlWhere,
    sqlOrderBy: entities.sqlOrderBy ?? 'created_at DESC',
  };

  console.log('[Agent] === QUERY DEBUG ===');
  console.log('[Agent] entities:', JSON.stringify(entities, null, 2));
  console.log('[Agent] rawSqlWhere:', rawSqlWhere);
  console.log('[Agent] sqlWhere (after year fix):', sqlWhere);
  console.log('[Agent] project.id:', project.id);

  // Execute query
  const result = await executeQuery(parsedQuery, {
    db: environment.DB,
    projectId: project.id,
    defaultCurrency: project.defaultCurrency,
  });

  console.log('[Agent] Query result:', JSON.stringify(result, null, 2));

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

/**
 * Fix year in date string if it's obviously wrong (e.g., 2024 instead of 2026)
 */
function fixDateYear(dateStr: string): string {
  const currentYear = new Date().getFullYear();
  // Replace common wrong years with current year
  return dateStr.replace(/\b(2024|2025)\b/g, currentYear.toString());
}

/**
 * Fix sqlWhere to use correct year
 */
function fixSqlWhereYear(sqlWhere: string): string {
  return fixDateYear(sqlWhere);
}

/**
 * Build SQL WHERE clause from intent entities
 */
function buildSqlWhere(entities: IntentResult['entities']): string {
  const conditions: string[] = ["status IN ('confirmed', 'personal')"];

  // Add time range filter with year fix
  if (entities.timeRange != null) {
    const start = fixDateYear(entities.timeRange.start);
    const end = fixDateYear(entities.timeRange.end);
    conditions.push(`created_at >= '${start}'`);
    conditions.push(`created_at < '${end}T23:59:59'`);
  }

  // Add category filter
  if (entities.categoryFilter != null) {
    conditions.push(`category = '${entities.categoryFilter.toLowerCase()}'`);
  }

  // Add person filter
  if (entities.personFilter != null) {
    conditions.push(`payer = '${entities.personFilter}'`);
  }

  return conditions.join(' AND ');
}

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
