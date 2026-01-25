/**
 * Response Formatter
 * Formats query results for Telegram messages
 */

import type { ParsedQuery, QuerySummary, Transaction } from '@fintrack-ai/core';

// ============================================
// Category Display Names
// ============================================

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  dining: '餐饮',
  grocery: '超市',
  gas: '加油',
  shopping: '购物',
  subscription: '订阅',
  travel: '旅行',
  transport: '交通',
  entertainment: '娱乐',
  health: '健康',
  utilities: '水电',
  sports: '运动',
  education: '教育',
  other: '其他',
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
    return `${d.getMonth() + 1}月${d.getDate()}日`;
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
    ? `📊 *${getCategoryName(query.category)}统计*`
    : '📊 *消费统计*';

  const dateRange = query.timeRange != null
    ? formatDateRange(query.timeRange.start, query.timeRange.end, query.timeRange.label)
    : '全部';

  const lines = [
    title,
    `📅 ${dateRange}`,
    '',
    `💰 总计: $${summary.totalAmount.toFixed(2)} ${currency}`,
    `📝 ${summary.transactionCount} 笔交易`,
  ];

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
    : '全部';

  const lines = [
    '📊 *各类消费统计*',
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
  lines.push(`💰 总计: $${summary.totalAmount.toFixed(2)} ${currency}`);

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
    return '📝 没有找到交易记录';
  }

  const dateRange = query.timeRange != null
    ? formatDateRange(query.timeRange.start, query.timeRange.end, query.timeRange.label)
    : '';

  const lines = [
    '📝 *交易记录*',
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
    lines.push(`_显示 10/${total} 条，使用 /history 查看更多_`);
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

export function formatQueryResponse(
  query: ParsedQuery,
  transactions: readonly Transaction[],
  summary: QuerySummary,
  currency: string
): QueryFormatResult {
  let message: string;

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
