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

## CRITICAL: Today's Date
Today is {today} (year {year}). You MUST use this exact year ({year}) for ALL date calculations. Do NOT use any other year.

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

## Time Range Calculation
Use today's date ({today}) to calculate ranges:
- "这个月" / "this month" → first day of current month to today
- "上个月" / "last month" → first to last day of previous month
- "今天" / "today" → today only
- "这周" / "this week" → Monday of current week to today
- No time specified → last 30 days from today

## Output Examples (using today = {today})

Input: "这个月餐饮花了多少"
→ queryType: "total", category: "dining", timeRange with current month dates

Input: "最近10笔消费"
→ queryType: "history", limit: 10, no timeRange filter

Input: "各类消费统计"
→ queryType: "breakdown", timeRange for last 30 days

Remember: Always use year {year} for dates!`;

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
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const year = now.getFullYear().toString();
    const systemPrompt = QUERY_SYSTEM_PROMPT
      .replace(/{today}/g, today)
      .replace(/{year}/g, year);

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
