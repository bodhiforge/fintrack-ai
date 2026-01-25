/**
 * Agent Orchestrator
 * Main entry point for the FinTrack AI Agent system
 */

import {
  IntentClassifier,
  QueryParser,
  type AgentResult,
  type IntentResult,
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
      message: '使用 /settle 查看结算方案',
    };
  }

  // Parse query with LLM
  const queryParser = new QueryParser(environment.OPENAI_API_KEY);
  const parsedQuery = await queryParser.parse(text);

  // Execute query
  const result = await executeQuery(parsedQuery, {
    db: environment.DB,
    projectId: project.id,
    defaultCurrency: project.defaultCurrency,
  });

  if (!result.success || result.data == null) {
    return {
      type: 'error',
      message: `❌ 查询失败: ${result.error ?? 'Unknown error'}`,
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
        message: '❌ 没有找到最近的交易记录',
      };
    }

    // Handle delete
    if (entities.modifyAction === 'delete') {
      return {
        type: 'confirm',
        message: `删除 *${lastTransaction.merchant}* ($${lastTransaction.amount.toFixed(2)})?`,
        keyboard: [
          [
            { text: '✅ 确认删除', callback_data: `delete_${lastTransaction.id}` },
            { text: '❌ 取消', callback_data: 'menu_main' },
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
        message: `修改 *${lastTransaction.merchant}* 的${getFieldName(field)}为 ${entities.newValue}?`,
        keyboard: [
          [
            { text: '✅ 确认', callback_data: `${callbackPrefix}_${lastTransaction.id}_${entities.newValue}` },
            { text: '❌ 取消', callback_data: 'menu_main' },
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
        message: `✏️ 编辑 *${lastTransaction.merchant}* ($${lastTransaction.amount.toFixed(2)})\n\n请输入新的${getFieldName(field)}:`,
        parseMode: 'Markdown',
      };
    }
  }

  // Generic modify request without clear target
  return {
    type: 'message',
    message: '🤔 请指定要修改的交易\n\n例如:\n- "改成50" (修改上一笔金额)\n- "删掉上一笔"\n- 使用 /history 查看交易列表',
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
    message: `👋 Hi! 我是记账助手\n\n` +
      `📁 当前项目: *${project.name}*\n\n` +
      `发送消费记录，如 "coffee 5" 或 "午饭 30"\n` +
      `查询消费，如 "这个月花了多少"\n\n` +
      `使用 /help 查看更多命令`,
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
        message: `确认将${getFieldName(field)}改为 ${text}?`,
        keyboard: [
          [
            { text: '✅ 确认', callback_data: `${callbackPrefix}_${state.transactionId}_${text}` },
            { text: '❌ 取消', callback_data: 'menu_main' },
          ],
        ],
      };
    }

    case 'awaiting_confirmation': {
      await clearSession(environment.DB, user.id, context.chatId);

      const lowerText = text.toLowerCase();
      if (lowerText === 'yes' || lowerText === '是' || lowerText === '确认' || lowerText === 'y') {
        return {
          type: 'confirm',
          message: '确认执行?',
          keyboard: [
            [
              { text: '✅ 确认', callback_data: `${state.action}_${state.targetId}` },
              { text: '❌ 取消', callback_data: 'menu_main' },
            ],
          ],
        };
      } else {
        return {
          type: 'message',
          message: '已取消',
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
    amount: '金额',
    merchant: '商家',
    category: '类别',
    split: '分账',
  };
  return names[field] ?? field;
}
