/**
 * Query Tool
 * Queries and analyzes expense data
 */

import { z } from 'zod';
import type { Tool, ToolExecutionResult, ToolContext } from '@fintrack-ai/core';
import { executeQuery } from '../agent/query-executor.js';
import type { ParsedQuery } from '../agent/query-executor.js';
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
// Tool Implementation
// ============================================

export const queryTool: Tool<QueryParams> = {
  name: 'query_expenses',
  description: 'Query and analyze expenses. Use for viewing spending history, totals, breakdowns by category, or checking balances.',
  parameters: QueryParamsSchema,

  async execute(
    args: QueryParams,
    context: ToolContext
  ): Promise<ToolExecutionResult> {
    const db = context.db as D1Database;

    try {
      // Handle special query types that delegate to commands
      if (args.queryType === 'balance') {
        return { content: 'Use /balance command to see who owes whom' };
      }

      if (args.queryType === 'settlement') {
        return { content: 'Use /settle command to see settlement options' };
      }

      // Fix year in dates (LLMs sometimes copy wrong year from examples)
      const currentYear = new Date().getFullYear();
      const fixYear = (str: string): string =>
        str.replace(/\b(202\d)\b/g, match => {
          const year = parseInt(match, 10);
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
        projectId: context.projectId,
        defaultCurrency: context.defaultCurrency,
      });

      if (!result.success || result.data == null) {
        return { content: `Query failed: ${result.error ?? 'Unknown error'}` };
      }

      const { transactions, summary } = result.data;

      // Format response for display
      const formatted = formatQueryResponse(
        parsedQuery,
        transactions,
        summary,
        context.defaultCurrency
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
        return `Found ${result.data.total} transactions. Recent: ${recentTx}${result.data.total > 5 ? '...' : ''}`;
      })();

      // Return content + formatted message for display
      return { content: `${content}\n\nFormatted:\n${formatted.message}` };
    } catch (error) {
      console.error('[QueryTool] Error:', error);
      return {
        content: `Failed to query expenses: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};
