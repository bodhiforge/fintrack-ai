/**
 * Action Executor
 * Executes actions from the Memory Agent
 */

import type { Action } from '@fintrack-ai/core';
import type { AgentResult, ParsedQuery, LastTransaction } from '@fintrack-ai/core';
import type { Environment } from '../types.js';
import type { User, Project } from '@fintrack-ai/core';
import { executeQuery, findLastTransaction } from './query-executor.js';
import { formatQueryResponse } from './response-formatter.js';
import { setLastTransaction } from './memory-session.js';

// ============================================
// Executor Context
// ============================================

export interface ExecutorContext {
  readonly chatId: number;
  readonly user: User;
  readonly project: Project;
  readonly environment: Environment;
  readonly payerName: string;
  readonly participants: readonly string[];
}

// ============================================
// Main Executor
// ============================================

export async function executeAction(
  action: Action,
  context: ExecutorContext
): Promise<AgentResult> {
  console.log(`[ActionExecutor] Executing action: ${action.action}`);
  console.log(`[ActionExecutor] Reasoning: ${action.reasoning}`);

  switch (action.action) {
    case 'record':
      return executeRecordAction(action, context);

    case 'query':
      return executeQueryAction(action, context);

    case 'modify':
      return executeModifyAction(action, context);

    case 'delete':
      return executeDeleteAction(action, context);

    case 'clarify':
      return executeClarifyAction(action, context);

    case 'respond':
      return executeRespondAction(action, context);

    default:
      return {
        type: 'error',
        message: 'Unknown action type',
      };
  }
}

// ============================================
// Record Action
// ============================================

async function executeRecordAction(
  action: Action,
  context: ExecutorContext
): Promise<AgentResult> {
  const transaction = action.transaction;

  if (transaction == null) {
    return {
      type: 'error',
      message: 'Missing transaction data',
    };
  }

  // Delegate to existing transaction parser
  // The transaction data from LLM needs to be processed by the full parser
  // to handle splits, embeddings, etc.
  return {
    type: 'delegate',
    handler: 'parseTransaction',
    input: `${transaction.merchant} ${transaction.amount}`,
  };
}

// ============================================
// Query Action
// ============================================

async function executeQueryAction(
  action: Action,
  context: ExecutorContext
): Promise<AgentResult> {
  const { project, environment } = context;
  const query = action.query;

  if (query == null) {
    return {
      type: 'error',
      message: 'Missing query data',
    };
  }

  // Handle balance/settlement
  if (query.queryType === 'balance') {
    return {
      type: 'delegate',
      handler: 'handleBalance',
      input: null,
    };
  }

  if (query.queryType === 'settlement') {
    return {
      type: 'message',
      message: 'Use /settle to see settlement options',
    };
  }

  // Build ParsedQuery
  const parsedQuery: ParsedQuery = {
    queryType: query.queryType,
    timeRange: query.timeRange != null ? {
      start: fixDateYear(query.timeRange.start),
      end: fixDateYear(query.timeRange.end),
      label: query.timeRange.label ?? undefined,
    } : undefined,
    category: query.categoryFilter ?? undefined,
    person: query.personFilter ?? undefined,
    limit: query.limit ?? 50,
    sqlWhere: fixDateYear(query.sqlWhere),
    sqlOrderBy: query.sqlOrderBy ?? 'created_at DESC',
  };

  // Execute query
  const result = await executeQuery(parsedQuery, {
    db: environment.DB,
    projectId: project.id,
    defaultCurrency: project.defaultCurrency,
  });

  if (!result.success || result.data == null) {
    return {
      type: 'error',
      message: `Query failed: ${result.error ?? 'Unknown error'}`,
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
// Modify Action
// ============================================

async function executeModifyAction(
  action: Action,
  context: ExecutorContext
): Promise<AgentResult> {
  const { user, project, environment, chatId } = context;
  const modify = action.modify;

  if (modify == null) {
    return {
      type: 'error',
      message: 'Missing modify data',
    };
  }

  // Find target transaction
  let transactionId: string | null = null;

  if (modify.target === 'last') {
    const lastTx = await findLastTransaction(
      environment.DB,
      project.id,
      user.id
    );

    if (lastTx == null) {
      return {
        type: 'message',
        message: 'No recent transaction found to modify',
      };
    }

    transactionId = lastTx.id;
  } else if (modify.transactionId != null) {
    transactionId = modify.transactionId;
  }

  if (transactionId == null) {
    return {
      type: 'message',
      message: 'Could not find transaction to modify. Please specify which transaction.',
    };
  }

  // Verify transaction exists and user has access
  const transaction = await environment.DB.prepare(`
    SELECT id, merchant, amount, currency, category
    FROM transactions
    WHERE id = ? AND project_id = ? AND status IN ('pending', 'confirmed', 'personal')
  `).bind(transactionId, project.id).first();

  if (transaction == null) {
    return {
      type: 'message',
      message: 'Transaction not found or already deleted',
    };
  }

  // Execute the modification
  const field = modify.field;
  const newValue = modify.newValue;

  let updateColumn: string;
  let formattedValue: string;

  switch (field) {
    case 'amount':
      updateColumn = 'amount';
      formattedValue = `$${Number(newValue).toFixed(2)}`;
      break;
    case 'merchant':
      updateColumn = 'merchant';
      formattedValue = String(newValue);
      break;
    case 'category':
      updateColumn = 'category';
      formattedValue = String(newValue).toLowerCase();
      break;
    default:
      return {
        type: 'message',
        message: `Cannot modify field: ${field}`,
      };
  }

  // Update the transaction
  await environment.DB.prepare(`
    UPDATE transactions SET ${updateColumn} = ? WHERE id = ?
  `).bind(field === 'amount' ? Number(newValue) : String(newValue), transactionId).run();

  // Update working memory with the modified transaction
  const updatedTx = await environment.DB.prepare(`
    SELECT id, merchant, amount, currency, category, created_at
    FROM transactions WHERE id = ?
  `).bind(transactionId).first();

  if (updatedTx != null) {
    const lastTransaction: LastTransaction = {
      id: updatedTx.id as string,
      merchant: updatedTx.merchant as string,
      amount: updatedTx.amount as number,
      currency: updatedTx.currency as string,
      category: updatedTx.category as string,
      createdAt: updatedTx.created_at as string,
    };

    await setLastTransaction(environment.DB, user.id, chatId, lastTransaction);
  }

  const oldValue = field === 'amount'
    ? `$${(transaction.amount as number).toFixed(2)}`
    : transaction[field] as string;

  // Return with confirm/edit buttons for convenience
  return {
    type: 'confirm',
    message: `✅ Updated *${field}*: ${oldValue} → ${formattedValue}\n\n_${updatedTx?.merchant} • $${(updatedTx?.amount as number).toFixed(2)}_`,
    keyboard: [
      [
        { text: '✅ Confirm', callback_data: `confirm_${transactionId}` },
        { text: '✏️ Edit', callback_data: `edit_${transactionId}` },
      ],
      [
        { text: '👤 Personal', callback_data: `personal_${transactionId}` },
        { text: '❌ Delete', callback_data: `delete_${transactionId}` },
      ],
      [
        { text: '🏠 Menu', callback_data: 'menu_main' },
      ],
    ],
  };
}

// ============================================
// Delete Action
// ============================================

async function executeDeleteAction(
  action: Action,
  context: ExecutorContext
): Promise<AgentResult> {
  const { user, project, environment } = context;
  const deleteData = action.delete;

  if (deleteData == null) {
    return {
      type: 'error',
      message: 'Missing delete data',
    };
  }

  // Find target transaction
  let transactionId: string | null = null;

  if (deleteData.target === 'last') {
    const lastTx = await findLastTransaction(
      environment.DB,
      project.id,
      user.id
    );

    if (lastTx == null) {
      return {
        type: 'message',
        message: 'No recent transaction found to delete',
      };
    }

    transactionId = lastTx.id;
  } else if (deleteData.transactionId != null) {
    transactionId = deleteData.transactionId;
  }

  if (transactionId == null) {
    return {
      type: 'message',
      message: 'Could not find transaction to delete. Please specify which transaction.',
    };
  }

  // Get transaction details for confirmation message
  const transaction = await environment.DB.prepare(`
    SELECT merchant, amount
    FROM transactions
    WHERE id = ? AND project_id = ? AND status IN ('pending', 'confirmed', 'personal')
  `).bind(transactionId, project.id).first();

  if (transaction == null) {
    return {
      type: 'message',
      message: 'Transaction not found or already deleted',
    };
  }

  // Return confirmation prompt
  return {
    type: 'confirm',
    message: `Delete *${transaction.merchant}* ($${(transaction.amount as number).toFixed(2)})?`,
    keyboard: [
      [
        { text: '✅ Yes, Delete', callback_data: `delete_${transactionId}` },
        { text: '❌ Cancel', callback_data: 'menu_main' },
      ],
      [
        { text: '🏠 Menu', callback_data: 'menu_main' },
      ],
    ],
  };
}

// ============================================
// Clarify Action
// ============================================

async function executeClarifyAction(
  action: Action,
  context: ExecutorContext
): Promise<AgentResult> {
  const clarify = action.clarify;

  if (clarify == null) {
    return {
      type: 'error',
      message: 'Missing clarify data',
    };
  }

  // Build keyboard from options
  const keyboard: Array<Array<{ text: string; callback_data: string }>> = clarify.options.map(
    (option, index) => [
      {
        text: option,
        callback_data: `clarify_${index}_${option.slice(0, 20)}`,
      },
    ]
  );

  keyboard.push([{ text: '❌ Cancel', callback_data: 'menu_main' }]);

  return {
    type: 'select',
    message: clarify.question,
    keyboard,
  };
}

// ============================================
// Respond Action
// ============================================

async function executeRespondAction(
  action: Action,
  context: ExecutorContext
): Promise<AgentResult> {
  const respond = action.respond;

  if (respond == null) {
    return {
      type: 'error',
      message: 'Missing respond data',
    };
  }

  return {
    type: 'message',
    message: respond.message,
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Fix year in date string if it's obviously wrong
 */
function fixDateYear(dateStr: string): string {
  const currentYear = new Date().getFullYear();
  return dateStr.replace(/\b(2024|2025)\b/g, currentYear.toString());
}
