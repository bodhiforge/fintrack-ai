/**
 * Result Converter
 * Converts PiToolResult from tool execution into AgentResult for Telegram display
 */

import type { AgentResult, PiToolResult } from '@fintrack-ai/core';

// ============================================
// Record Result Details
// ============================================

interface RecordDetails {
  readonly transactionId: string;
  readonly merchant: string;
  readonly amount: number;
  readonly currency: string;
  readonly category: string;
  readonly splits: Readonly<Record<string, number>>;
  readonly needsClarification: boolean;
  readonly lowConfidenceFields?: readonly string[];
}

// ============================================
// Modify Result Details
// ============================================

interface ModifyDetails {
  readonly transactionId: string;
  readonly field: string;
  readonly oldValue: string | number;
  readonly newValue: string | number;
  readonly merchant: string;
  readonly amount: number;
}

// ============================================
// Delete Result Details
// ============================================

interface DeleteDetails {
  readonly transactionId: string;
  readonly merchant: string;
  readonly amount: number;
  readonly deleted: boolean;
  readonly needsConfirmation: boolean;
}

// ============================================
// Query Result Details
// ============================================

interface QueryDetails {
  readonly formattedMessage: string;
}

// ============================================
// Main Converter
// ============================================

export function convertToolResult(toolName: string, result: PiToolResult): AgentResult {
  if (!result.success) {
    return { type: 'error', message: result.content };
  }

  switch (toolName) {
    case 'record_expense':
      return convertRecordResult(result as PiToolResult<RecordDetails>);
    case 'query_expenses':
      return convertQueryResult(result as PiToolResult<QueryDetails>);
    case 'modify_amount':
    case 'modify_merchant':
    case 'modify_category':
      return convertModifyResult(result as PiToolResult<ModifyDetails>);
    case 'delete_expense':
      return convertDeleteResult(result as PiToolResult<DeleteDetails>);
    default:
      return { type: 'message', message: result.content };
  }
}

// ============================================
// Record Converter
// ============================================

function convertRecordResult(result: PiToolResult<RecordDetails>): AgentResult {
  const details = result.details;

  if (details == null) {
    return { type: 'message', message: result.content };
  }

  const splitSummary = Object.entries(details.splits)
    .map(([person, share]) => `${person}: $${share.toFixed(2)}`)
    .join(', ');

  const message = `*${details.merchant}* $${details.amount.toFixed(2)} ${details.currency}\n${details.category} | ${splitSummary}`;

  return {
    type: 'confirm',
    message,
    keyboard: [
      [
        { text: '\u2705 Confirm', callback_data: `confirm_${details.transactionId}` },
        { text: '\u270f\ufe0f Edit', callback_data: `edit_${details.transactionId}` },
      ],
      [
        { text: '\ud83d\udc64 Personal', callback_data: `personal_${details.transactionId}` },
        { text: '\u274c Delete', callback_data: `delete_${details.transactionId}` },
      ],
      [
        { text: '\ud83c\udfe0 Menu', callback_data: 'menu_main' },
      ],
    ],
  };
}

// ============================================
// Query Converter
// ============================================

function convertQueryResult(result: PiToolResult<QueryDetails>): AgentResult {
  const details = result.details;

  if (details?.formattedMessage != null) {
    return {
      type: 'message',
      message: details.formattedMessage,
      parseMode: 'Markdown',
    };
  }

  return { type: 'message', message: result.content };
}

// ============================================
// Modify Converter
// ============================================

function convertModifyResult(result: PiToolResult<ModifyDetails>): AgentResult {
  const details = result.details;

  if (details == null) {
    return { type: 'message', message: result.content };
  }

  const formattedNew = details.field === 'amount'
    ? `$${Number(details.newValue).toFixed(2)}`
    : String(details.newValue);

  const message = `\u2705 Updated *${details.field}*: ${details.oldValue} \u2192 ${formattedNew}\n\n_${details.merchant} \u2022 $${details.amount.toFixed(2)}_`;

  return {
    type: 'confirm',
    message,
    keyboard: [
      [
        { text: '\u2705 Confirm', callback_data: `confirm_${details.transactionId}` },
        { text: '\u270f\ufe0f Edit', callback_data: `edit_${details.transactionId}` },
      ],
      [
        { text: '\ud83d\udc64 Personal', callback_data: `personal_${details.transactionId}` },
        { text: '\u274c Delete', callback_data: `delete_${details.transactionId}` },
      ],
      [
        { text: '\ud83c\udfe0 Menu', callback_data: 'menu_main' },
      ],
    ],
  };
}

// ============================================
// Delete Converter
// ============================================

function convertDeleteResult(result: PiToolResult<DeleteDetails>): AgentResult {
  const details = result.details;

  if (details == null) {
    return { type: 'message', message: result.content };
  }

  if (details.needsConfirmation) {
    return {
      type: 'confirm',
      message: `Delete *${details.merchant}* ($${details.amount.toFixed(2)})?`,
      keyboard: [
        [
          { text: '\u2705 Yes, Delete', callback_data: `delete_${details.transactionId}` },
          { text: '\u274c Cancel', callback_data: 'menu_main' },
        ],
        [
          { text: '\ud83c\udfe0 Menu', callback_data: 'menu_main' },
        ],
      ],
    };
  }

  return {
    type: 'message',
    message: `\u2705 Deleted: ${details.merchant} ($${details.amount.toFixed(2)})`,
  };
}
