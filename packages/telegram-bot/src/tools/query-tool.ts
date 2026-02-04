/**
 * Query Tool
 * Queries and analyzes expense data
 *
 * Pi Agent-inspired implementation with:
 * - Zod schema for type-safe parameters
 * - Dual return: content (for LLM) + details (for UI)
 */

import { z } from 'zod';
import type { Tool, PiToolResult, PiToolContextWithDb, QueryType, ParsedQuery, QuerySummary, Transaction } from '@fintrack-ai/core';
import { executeQuery } from '../agent/query-executor.js';
import { formatQueryResponse } from '../agent/response-formatter.js';

// ============================================
// Parameter Schema
// ============================================

const TimeRangeSchema = z.object({
  start: z.string().describe('Start date in YYYY-MM-DD format'),
  end: z.string().describe('End date in YYYY-MM-DD format'),
  label: z.string().nullable().describe('Human-readable label like "this month" or "last week"'),
});

const QueryParamsSchema = z.object({
  queryType: z.enum(['balance', 'history', 'total', 'breakdown', 'settlement'])
    .describe('Type of query to execute'),
  timeRange: TimeRangeSchema.nullable()
    .describe('Time range filter for the query'),
  categoryFilter: z.string().nullable()
    .describe('Category to filter by'),
  personFilter: z.string().nullable()
    .describe('Person to filter by'),
  limit: z.number().nullable()
    .describe('Maximum number of results'),
  sqlWhere: z.string()
    .describe('SQL WHERE clause (without WHERE keyword)'),
  sqlOrderBy: z.string().nullable()
    .describe('SQL ORDER BY clause'),
});

type QueryParams = z.infer<typeof QueryParamsSchema>;

// ============================================
// Result Details Schema
// ============================================

interface QueryDetails {
  readonly queryType: QueryType;
  readonly transactions: readonly Transaction[];
  readonly total: number;
  readonly summary: QuerySummary;
  readonly formattedMessage: string;
}

// ============================================
// Tool Implementation
// ============================================

export const queryTool: Tool<QueryParams, QueryDetails, D1Database> = {
  name: 'query_expenses',
  description: 'Query and analyze expenses. Use for viewing spending history, totals, breakdowns by category, or checking balances.',
  parameters: QueryParamsSchema,

  async execute(
    args: QueryParams,
    context: PiToolContextWithDb<D1Database>
  ): Promise<PiToolResult<QueryDetails>> {
    const { db, projectId, defaultCurrency } = context;

    try {
      // Handle special query types that delegate to commands
      if (args.queryType === 'balance') {
        return {
          success: true,
          content: 'Use /balance command to see who owes whom',
          details: {
            queryType: 'balance',
            transactions: [],
            total: 0,
            summary: { totalAmount: 0, transactionCount: 0 },
            formattedMessage: 'Use /balance to see settlement details',
          },
        };
      }

      if (args.queryType === 'settlement') {
        return {
          success: true,
          content: 'Use /settle command to see settlement options',
          details: {
            queryType: 'settlement',
            transactions: [],
            total: 0,
            summary: { totalAmount: 0, transactionCount: 0 },
            formattedMessage: 'Use /settle to see settlement options',
          },
        };
      }

      // Fix year in dates (LLMs sometimes copy wrong year from examples)
      const currentYear = new Date().getFullYear();
      const fixYear = (str: string): string =>
        str.replace(/\b(202\d)\b/g, match => {
          const year = parseInt(match, 10);
          // Only fix if year is in the past or too far in future (likely a copy error)
          return year < currentYear || year > currentYear + 1
            ? currentYear.toString()
            : match;
        });

      // Build ParsedQuery from args
      const parsedQuery: ParsedQuery = {
        queryType: args.queryType,
        timeRange: args.timeRange != null ? {
          start: fixYear(args.timeRange.start),
          end: fixYear(args.timeRange.end),
          label: args.timeRange.label ?? undefined,
        } : undefined,
        category: args.categoryFilter ?? undefined,
        person: args.personFilter ?? undefined,
        limit: args.limit ?? 50,
        sqlWhere: fixYear(args.sqlWhere),
        sqlOrderBy: args.sqlOrderBy ?? 'created_at DESC',
      };

      // Execute query
      const result = await executeQuery(parsedQuery, {
        db,
        projectId,
        defaultCurrency,
      });

      if (!result.success || result.data == null) {
        return {
          success: false,
          content: `Query failed: ${result.error ?? 'Unknown error'}`,
          error: result.error,
        };
      }

      const { transactions, total, summary } = result.data;

      // Format response for display
      const formatted = formatQueryResponse(
        parsedQuery,
        transactions,
        summary,
        defaultCurrency
      );

      // Build content for LLM
      const content = (() => {
        if (args.queryType === 'breakdown') {
          const categoryBreakdown = summary.byCategory != null
            ? Object.entries(summary.byCategory)
                .map(([cat, amount]) => `${cat}: $${amount.toFixed(2)}`)
                .join(', ')
            : 'No data';
          return `Spending breakdown: Total $${summary.totalAmount.toFixed(2)} from ${summary.transactionCount} transactions. ${categoryBreakdown}`;
        }
        if (args.queryType === 'total') {
          const timeLabel = args.timeRange?.label ?? 'selected period';
          return `Total spending for ${timeLabel}: $${summary.totalAmount.toFixed(2)} (${summary.transactionCount} transactions)`;
        }
        // history
        const recentTx = transactions.slice(0, 5)
          .map(tx => `${tx.merchant}: $${tx.amount.toFixed(2)}`)
          .join(', ');
        return `Found ${total} transactions. Recent: ${recentTx}${total > 5 ? '...' : ''}`;
      })();

      return {
        success: true,
        content,
        details: {
          queryType: args.queryType,
          transactions,
          total,
          summary,
          formattedMessage: formatted.message,
        },
      };
    } catch (error) {
      console.error('[QueryTool] Error:', error);
      return {
        success: false,
        content: 'Failed to query expenses',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
