/**
 * Response Formatter
 * Formats query results for Telegram messages
 */

import type { Transaction } from '@fintrack-ai/core';
import type { ParsedQuery, QuerySummary } from './query-executor.js';

// ============================================
// Category Display Names
// ============================================

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  dining: 'Dining',
  grocery: 'Grocery',
  gas: 'Gas',
  shopping: 'Shopping',
  subscription: 'Subscription',
  travel: 'Travel',
  transport: 'Transport',
  entertainment: 'Entertainment',
  health: 'Health',
  utilities: 'Utilities',
  sports: 'Sports',
  education: 'Education',
  other: 'Other',
};

function getCategoryName(category: string): string {
  return CATEGORY_NAMES[category] ?? category;
}

// ============================================
// Date Formatting
// ============================================

function formatDateRange(
  start: string,
  end: string,
  label?: string
): string {
  if (label != null) {
    return label;
  }

  const startDate = new Date(start);
  const endDate = new Date(end);

  const formatDate = (d: Date): string => {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

// ============================================
// Total Query Response
// ============================================

export function formatTotalResponse(
  query: ParsedQuery,
  summary: QuerySummary,
  currency: string
): string {
  const title = query.category != null
    ? `📊 *${getCategoryName(query.category)} Summary*`
    : '📊 *Spending Summary*';

  const dateRange = query.timeRange != null
    ? formatDateRange(query.timeRange.start, query.timeRange.end, query.timeRange.label)
    : 'All time';

  const lines = [
    title,
    `📅 ${dateRange}`,
    '',
    `💰 Total: $${summary.totalAmount.toFixed(2)} ${currency}`,
    `📝 ${summary.transactionCount} transactions`,
  ];

  return lines.join('\n');
}

// ============================================
// Top/Extreme Query Response (most expensive, cheapest, etc.)
// ============================================

export function formatTopResponse(
  query: ParsedQuery,
  transactions: readonly Transaction[],
  currency: string,
  isDescending: boolean
): string {
  if (transactions.length === 0) {
    return '📝 No transactions found';
  }

  const transaction = transactions[0];
  const title = isDescending ? '💎 *Most Expensive*' : '🪙 *Cheapest*';

  const dateRange = query.timeRange != null
    ? formatDateRange(query.timeRange.start, query.timeRange.end, query.timeRange.label)
    : 'All time';

  const date = new Date(transaction.createdAt);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const lines = [
    title,
    `📅 ${dateRange}`,
    '',
    `🏪 ${transaction.merchant}`,
    `💰 $${transaction.amount.toFixed(2)} ${currency}`,
    `📁 ${getCategoryName(transaction.category)}`,
    `📆 ${dateStr}`,
  ];

  if (transaction.location != null) {
    lines.push(`📍 ${transaction.location}`);
  }

  return lines.join('\n');
}

// ============================================
// Breakdown Query Response
// ============================================

export function formatBreakdownResponse(
  query: ParsedQuery,
  summary: QuerySummary,
  currency: string
): string {
  const dateRange = query.timeRange != null
    ? formatDateRange(query.timeRange.start, query.timeRange.end, query.timeRange.label)
    : 'All time';

  const lines = [
    '📊 *Spending by Category*',
    `📅 ${dateRange}`,
    '',
  ];

  // Sort categories by amount descending
  const sortedCategories = Object.entries(summary.byCategory ?? {})
    .sort(([, amountA], [, amountB]) => amountB - amountA);

  sortedCategories.forEach(([category, amount]) => {
    const percentage = summary.totalAmount > 0
      ? ((amount / summary.totalAmount) * 100).toFixed(0)
      : '0';
    lines.push(`${getCategoryName(category)}: $${amount.toFixed(2)} (${percentage}%)`);
  });

  lines.push('');
  lines.push(`💰 Total: $${summary.totalAmount.toFixed(2)} ${currency}`);

  return lines.join('\n');
}

// ============================================
// History Query Response
// ============================================

export function formatHistoryResponse(
  query: ParsedQuery,
  transactions: readonly Transaction[],
  total: number,
  currency: string
): string {
  if (transactions.length === 0) {
    return '📝 No transactions found';
  }

  const dateRange = query.timeRange != null
    ? formatDateRange(query.timeRange.start, query.timeRange.end, query.timeRange.label)
    : '';

  const lines = [
    '📝 *Transaction History*',
  ];

  if (dateRange !== '') {
    lines.push(`📅 ${dateRange}`);
  }

  lines.push('');

  // Format each transaction
  transactions.slice(0, 10).forEach((transaction, index) => {
    const date = new Date(transaction.createdAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
    const categoryName = getCategoryName(transaction.category);

    lines.push(
      `${index + 1}. ${transaction.merchant} - $${transaction.amount.toFixed(2)} [${categoryName}] ${dateStr}`
    );
  });

  if (total > 10) {
    lines.push('');
    lines.push(`_Showing 10 of ${total}. Use /history for more._`);
  }

  return lines.join('\n');
}

// ============================================
// Main Format Function
// ============================================

export interface QueryFormatResult {
  readonly message: string;
  readonly parseMode: 'Markdown';
}

/**
 * Detect if this is a "top" query (most expensive, cheapest, etc.)
 */
function isTopQuery(query: ParsedQuery): { isTop: boolean; isDescending: boolean } {
  // Check for limit=1 with ORDER BY amount
  if (query.limit === 1 && query.sqlOrderBy != null) {
    const orderBy = query.sqlOrderBy.toUpperCase();
    if (orderBy.includes('AMOUNT')) {
      return {
        isTop: true,
        isDescending: orderBy.includes('DESC'),
      };
    }
  }
  return { isTop: false, isDescending: false };
}

export function formatQueryResponse(
  query: ParsedQuery,
  transactions: readonly Transaction[],
  summary: QuerySummary,
  currency: string
): QueryFormatResult {
  let message: string;

  // Check if this is a "top" query (most expensive, cheapest)
  const { isTop, isDescending } = isTopQuery(query);
  if (isTop && transactions.length > 0) {
    message = formatTopResponse(query, transactions, currency, isDescending);
    return { message, parseMode: 'Markdown' };
  }

  switch (query.queryType) {
    case 'total':
      message = formatTotalResponse(query, summary, currency);
      break;
    case 'breakdown':
      message = formatBreakdownResponse(query, summary, currency);
      break;
    case 'history':
      message = formatHistoryResponse(query, transactions, summary.transactionCount, currency);
      break;
    default:
      message = formatTotalResponse(query, summary, currency);
  }

  return { message, parseMode: 'Markdown' };
}
