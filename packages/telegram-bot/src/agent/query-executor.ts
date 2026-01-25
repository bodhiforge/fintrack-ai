/**
 * Query Executor
 * Executes SQL queries against D1 database
 */

import type { Transaction, Currency, Category } from '@fintrack-ai/core';
import type { ParsedQuery, QuerySummary, ToolResult } from '@fintrack-ai/core';

// ============================================
// Types
// ============================================

export interface QueryExecutorContext {
  readonly db: D1Database;
  readonly projectId: string;
  readonly defaultCurrency: string;
}

export interface QueryResult {
  readonly transactions: readonly Transaction[];
  readonly total: number;
  readonly summary: QuerySummary;
}

// ============================================
// Row Mapper
// ============================================

function rowToTransaction(row: Readonly<Record<string, unknown>>): Transaction {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    date: row.created_at as string,
    merchant: row.merchant as string,
    amount: row.amount as number,
    currency: row.currency as Currency,
    category: row.category as Category,
    location: row.location as string | undefined,
    cardLastFour: (row.card_last_four as string) ?? '',
    payer: row.payer as string,
    isShared: row.is_shared === 1,
    splits: row.splits != null ? JSON.parse(row.splits as string) : {},
    createdAt: row.created_at as string,
    confirmedAt: row.confirmed_at as string,
  };
}

// ============================================
// SQL Sanitization
// ============================================

/**
 * Remove ORDER BY, LIMIT, and other clauses from WHERE clause
 * The LLM sometimes includes these in sqlWhere by mistake
 */
function sanitizeSqlWhere(sqlWhere: string): string {
  let result = sqlWhere;

  // Remove semicolons (prevents multiple statement injection)
  result = result.replace(/;/g, '');

  // Remove ORDER BY and everything after it
  const orderByIndex = result.toUpperCase().indexOf('ORDER BY');
  if (orderByIndex !== -1) {
    result = result.substring(0, orderByIndex).trim();
  }

  // Remove LIMIT and everything after it
  const limitIndex = result.toUpperCase().indexOf('LIMIT');
  if (limitIndex !== -1) {
    result = result.substring(0, limitIndex).trim();
  }

  // Remove GROUP BY (should not be in WHERE clause)
  const groupByIndex = result.toUpperCase().indexOf('GROUP BY');
  if (groupByIndex !== -1) {
    result = result.substring(0, groupByIndex).trim();
  }

  // Remove trailing AND/OR
  result = result.replace(/\s+(AND|OR)\s*$/i, '').trim();

  return result;
}

/**
 * Remove LIMIT from ORDER BY clause
 */
function sanitizeSqlOrderBy(sqlOrderBy: string | undefined): string {
  if (sqlOrderBy == null) {
    return 'created_at DESC';
  }

  let result = sqlOrderBy;

  // Remove semicolons
  result = result.replace(/;/g, '');

  // Remove LIMIT and everything after it
  const limitIndex = result.toUpperCase().indexOf('LIMIT');
  if (limitIndex !== -1) {
    result = result.substring(0, limitIndex).trim();
  }

  // If empty after sanitization, use default
  if (result.trim() === '') {
    return 'created_at DESC';
  }

  return result;
}

// ============================================
// Query Execution
// ============================================

export async function executeQuery(
  query: ParsedQuery,
  context: QueryExecutorContext
): Promise<ToolResult<QueryResult>> {
  const { db, projectId } = context;

  // Sanitize sqlWhere to remove any ORDER BY/LIMIT that LLM might have included
  const sanitizedWhere = sanitizeSqlWhere(query.sqlWhere);
  console.log('[QueryExecutor] === SQL DEBUG ===');
  console.log('[QueryExecutor] projectId:', projectId);
  console.log('[QueryExecutor] queryType:', query.queryType);
  console.log('[QueryExecutor] Original sqlWhere:', query.sqlWhere);
  console.log('[QueryExecutor] Sanitized sqlWhere:', sanitizedWhere);

  try {
    // For balance/settlement, delegate to existing commands
    if (query.queryType === 'balance' || query.queryType === 'settlement') {
      return {
        success: true,
        data: {
          transactions: [],
          total: 0,
          summary: { totalAmount: 0, transactionCount: 0 },
        },
        followUp: {
          type: 'clarify',
          message: query.queryType === 'balance'
            ? 'Use /balance to see who owes whom'
            : 'Use /settle to see settlement options',
        },
      };
    }

    // For breakdown query, use GROUP BY
    if (query.queryType === 'breakdown') {
      return executeBreakdownQuery(query, context);
    }

    // Build count query
    const countSql = `
      SELECT COUNT(*) as total
      FROM transactions
      WHERE project_id = ? AND ${sanitizedWhere}
    `;

    // Build data query
    const limit = query.limit ?? 50;
    const orderBy = sanitizeSqlOrderBy(query.sqlOrderBy);
    console.log('[QueryExecutor] Original sqlOrderBy:', query.sqlOrderBy);
    console.log('[QueryExecutor] Sanitized sqlOrderBy:', orderBy);
    const dataSql = `
      SELECT *
      FROM transactions
      WHERE project_id = ? AND ${sanitizedWhere}
      ORDER BY ${orderBy}
      LIMIT ?
    `;

    console.log('[QueryExecutor] Full countSql:', countSql.replace('?', `'${projectId}'`));
    console.log('[QueryExecutor] Full dataSql:', dataSql.replace(/\?/g, (_, i) => i === 0 ? `'${projectId}'` : String(limit)));

    // Execute queries
    const countResult = await db.prepare(countSql).bind(projectId).first();
    const dataResult = await db.prepare(dataSql).bind(projectId, limit).all();

    console.log('[QueryExecutor] countResult:', JSON.stringify(countResult));
    console.log('[QueryExecutor] dataResult count:', dataResult.results?.length ?? 0);

    const transactions = (dataResult.results ?? []).map(rowToTransaction);
    const total = (countResult?.total as number) ?? 0;
    const summary = calculateSummary(transactions);

    return {
      success: true,
      data: { transactions, total, summary },
    };
  } catch (error) {
    console.error('Query execution error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Query failed',
    };
  }
}

// ============================================
// Breakdown Query
// ============================================

async function executeBreakdownQuery(
  query: ParsedQuery,
  context: QueryExecutorContext
): Promise<ToolResult<QueryResult>> {
  const { db, projectId } = context;
  const sanitizedWhere = sanitizeSqlWhere(query.sqlWhere);

  try {
    const breakdownSql = `
      SELECT category, SUM(amount) as total_amount, COUNT(*) as count
      FROM transactions
      WHERE project_id = ? AND ${sanitizedWhere}
      GROUP BY category
      ORDER BY total_amount DESC
    `;

    const result = await db.prepare(breakdownSql).bind(projectId).all();

    const byCategory: Record<string, number> = {};
    let totalAmount = 0;
    let transactionCount = 0;

    (result.results ?? []).forEach(row => {
      const category = row.category as string;
      const amount = row.total_amount as number;
      const count = row.count as number;
      byCategory[category] = amount;
      totalAmount += amount;
      transactionCount += count;
    });

    return {
      success: true,
      data: {
        transactions: [],
        total: transactionCount,
        summary: {
          totalAmount,
          transactionCount,
          byCategory,
        },
      },
    };
  } catch (error) {
    console.error('Breakdown query error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Query failed',
    };
  }
}

// ============================================
// Summary Calculation
// ============================================

function calculateSummary(transactions: readonly Transaction[]): QuerySummary {
  const initial: {
    totalAmount: number;
    byCategory: Record<string, number>;
    byPerson: Record<string, number>;
  } = {
    totalAmount: 0,
    byCategory: {},
    byPerson: {},
  };

  const result = transactions.reduce((accumulator, transaction) => ({
    totalAmount: accumulator.totalAmount + transaction.amount,
    byCategory: {
      ...accumulator.byCategory,
      [transaction.category]:
        (accumulator.byCategory[transaction.category] ?? 0) + transaction.amount,
    },
    byPerson: {
      ...accumulator.byPerson,
      [transaction.payer]:
        (accumulator.byPerson[transaction.payer] ?? 0) + transaction.amount,
    },
  }), initial);

  return {
    totalAmount: result.totalAmount,
    transactionCount: transactions.length,
    byCategory: result.byCategory,
    byPerson: result.byPerson,
  };
}

// ============================================
// Find Last Transaction
// ============================================

export async function findLastTransaction(
  db: D1Database,
  projectId: string,
  userId: number
): Promise<Transaction | null> {
  const row = await db.prepare(`
    SELECT *
    FROM transactions
    WHERE project_id = ? AND user_id = ? AND status IN ('pending', 'confirmed', 'personal')
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(projectId, userId).first();

  if (row == null) {
    return null;
  }

  return rowToTransaction(row);
}
