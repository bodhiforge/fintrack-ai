/**
 * Query Parser
 * Converts natural language queries to SQL-compatible filters
 */

import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import OpenAI from 'openai';
import type { ParsedQuery, QueryType, TimeRange } from './types.js';

// ============================================
// Zod Schema
// ============================================

const QuerySchema = z.object({
  queryType: z.enum(['total', 'breakdown', 'history', 'balance', 'settlement'])
    .describe('Type of query to execute'),
  timeRange: z.object({
    start: z.string().describe('Start date YYYY-MM-DD'),
    end: z.string().describe('End date YYYY-MM-DD'),
    label: z.string().optional().describe('Human-readable label'),
  }).optional(),
  category: z.string().optional()
    .describe('Category filter (lowercase: dining, grocery, etc.)'),
  person: z.string().optional()
    .describe('Person name to filter by'),
  limit: z.number().optional()
    .describe('Max number of results'),
  sqlWhere: z.string()
    .describe('SQL WHERE clause fragment (without WHERE keyword)'),
  sqlOrderBy: z.string().optional()
    .describe('SQL ORDER BY clause (without ORDER BY keyword)'),
});

// ============================================
// System Prompt
// ============================================

const QUERY_SYSTEM_PROMPT = `Parse expense queries into SQL-compatible filters for a D1 (SQLite) database.

## Today
{today}

## Database Schema
Table: transactions
- id TEXT PRIMARY KEY
- project_id TEXT
- user_id INTEGER
- merchant TEXT
- amount DECIMAL
- currency TEXT
- category TEXT (lowercase: dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, sports, education, other)
- payer TEXT (person name)
- status TEXT ('pending', 'confirmed', 'personal', 'deleted')
- is_shared INTEGER (1 = shared, 0 = personal)
- created_at TEXT (ISO timestamp)

## Query Types
- total: Calculate sum of amounts
- breakdown: Group by category and sum
- history: List recent transactions
- balance: Calculate who owes whom (use existing /balance command)
- settlement: Calculate simplified payments (use existing /settle command)

## SQL Rules
1. Always filter by status: status IN ('confirmed', 'personal')
2. Use datetime() for date comparisons: created_at >= datetime('{start}')
3. Category values are lowercase
4. For shared expenses only: is_shared = 1
5. project_id will be added by the caller - do NOT include it in sqlWhere

## Time Range Examples
- "这个月" (January 2024) → start: "2024-01-01", end: "2024-01-31"
- "上个月" → previous month's first and last day
- "今天" → today only
- "这周" → Monday to today
- No time specified → default to last 30 days

## Output Examples

Input: "这个月餐饮花了多少"
Output: {
  "queryType": "total",
  "timeRange": { "start": "2024-01-01", "end": "2024-01-31", "label": "这个月" },
  "category": "dining",
  "sqlWhere": "status IN ('confirmed', 'personal') AND category = 'dining' AND created_at >= datetime('2024-01-01') AND created_at < datetime('2024-02-01')",
  "sqlOrderBy": "created_at DESC"
}

Input: "最近10笔消费"
Output: {
  "queryType": "history",
  "limit": 10,
  "sqlWhere": "status IN ('confirmed', 'personal')",
  "sqlOrderBy": "created_at DESC"
}

Input: "各类消费统计"
Output: {
  "queryType": "breakdown",
  "timeRange": { "start": "2023-12-25", "end": "2024-01-24", "label": "最近30天" },
  "sqlWhere": "status IN ('confirmed', 'personal') AND created_at >= datetime('2023-12-25')",
  "sqlOrderBy": "amount DESC"
}`;

// ============================================
// Query Parser Class
// ============================================

export class QueryParser {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, options?: { readonly model?: string }) {
    this.client = new OpenAI({ apiKey });
    this.model = options?.model ?? 'gpt-4o-mini';
  }

  async parse(text: string): Promise<ParsedQuery> {
    const today = new Date().toISOString().split('T')[0];
    const systemPrompt = QUERY_SYSTEM_PROMPT.replace(/{today}/g, today);

    try {
      const completion = await this.client.beta.chat.completions.parse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        response_format: zodResponseFormat(QuerySchema, 'query'),
        temperature: 0,
      });

      const parsed = completion.choices[0]?.message?.parsed;

      if (parsed == null) {
        return this.defaultQuery();
      }

      return {
        queryType: parsed.queryType as QueryType,
        timeRange: parsed.timeRange as TimeRange | undefined,
        category: parsed.category?.toLowerCase(),
        person: parsed.person,
        limit: parsed.limit,
        sqlWhere: parsed.sqlWhere,
        sqlOrderBy: parsed.sqlOrderBy,
      };
    } catch (error) {
      console.error('Query parsing error:', error);
      return this.defaultQuery();
    }
  }

  private defaultQuery(): ParsedQuery {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const start = thirtyDaysAgo.toISOString().split('T')[0];

    return {
      queryType: 'history',
      timeRange: {
        start,
        end: new Date().toISOString().split('T')[0],
        label: 'Last 30 days',
      },
      limit: 10,
      sqlWhere: "status IN ('confirmed', 'personal')",
      sqlOrderBy: 'created_at DESC',
    };
  }
}
