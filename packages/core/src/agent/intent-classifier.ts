/**
 * Intent Classifier
 * Uses LLM (gpt-4o-mini) to classify user intent
 */

import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import OpenAI from 'openai';
import type { Intent, IntentResult, IntentEntities, TimeRange } from './types.js';

// ============================================
// Zod Schema
// ============================================

const TimeRangeSchema = z.object({
  start: z.string().describe('Start date in YYYY-MM-DD format'),
  end: z.string().describe('End date in YYYY-MM-DD format'),
  label: z.string().optional().describe('Human-readable label like "this month"'),
});

const IntentSchema = z.object({
  intent: z.enum(['record', 'query', 'modify', 'chat']).describe('User intent category'),
  confidence: z.number().min(0).max(1).describe('Confidence score 0-1'),
  entities: z.object({
    // Query entities
    queryType: z.enum(['balance', 'history', 'total', 'breakdown', 'settlement']).optional()
      .describe('Type of query'),
    timeRange: TimeRangeSchema.optional()
      .describe('Time range for query'),
    categoryFilter: z.string().optional()
      .describe('Category to filter by (lowercase)'),
    personFilter: z.string().optional()
      .describe('Person to filter by'),
    limit: z.number().optional()
      .describe('Max results for history query'),
    sqlWhere: z.string().optional()
      .describe('SQL WHERE clause for query intent (without WHERE keyword)'),
    sqlOrderBy: z.string().optional()
      .describe('SQL ORDER BY clause (without ORDER BY keyword)'),
    // Modify entities
    modifyAction: z.enum(['edit', 'delete', 'undo']).optional()
      .describe('Type of modification'),
    targetField: z.enum(['amount', 'merchant', 'category', 'split']).optional()
      .describe('Field to modify'),
    newValue: z.union([z.string(), z.number()]).optional()
      .describe('New value for the field'),
    targetReference: z.string().optional()
      .describe('"last" for most recent, or transaction ID'),
  }),
});

// ============================================
// System Prompt
// ============================================

const INTENT_SYSTEM_PROMPT = `You classify user messages for an expense tracking bot and generate SQL for queries.

## Intents

1. **record** - User wants to log a NEW expense
   - Contains: item/merchant + amount (explicit or implicit)
   - Examples: "coffee 5", "午饭 30", "uber 15", "买菜 120"

2. **query** - User wants to VIEW or ANALYZE existing expenses
   - Examples: "这个月花了多少", "how much this month", "餐饮统计", "spending breakdown"
   - Query types:
     - total: Sum of amounts ("这个月花了多少", "how much spent")
     - breakdown: Group by category ("餐饮统计", "spending by category")
     - history: Transaction list ("最近消费", "recent transactions")
     - balance: Who owes whom ("谁欠谁钱", "balance")
     - settlement: Settlement plan ("怎么结算", "settle")
   - **IMPORTANT**: For query intent, you MUST generate sqlWhere and sqlOrderBy

3. **modify** - User wants to CHANGE or DELETE existing data
   - Examples: "改成50", "change to 50", "删掉上一笔", "delete the last one"
   - Use targetReference: "last" for most recent transaction

4. **chat** - Greeting, unclear, or off-topic
   - Examples: "你好", "hi", "thanks", "how to use"

## CRITICAL: Today's Date
Today is {today} (year {year}). You MUST use year {year} for ALL date calculations.

## Time Range Parsing
Parse relative dates into YYYY-MM-DD using today's date ({today}):
- "这个月" / "this month" → first day of month to today
- "上个月" / "last month" → first to last day of previous month
- "今天" / "today" → today only
- "这周" / "this week" → Monday to today
- No time specified → default to last 30 days

## SQL Generation Rules (for query intent only)
Database table: transactions
Columns: id, merchant, amount, currency, category, payer, status, is_shared, created_at

1. Always include: status IN ('confirmed', 'personal')
2. Date format: created_at >= '{start}' AND created_at < '{end+1day}'
3. Category is lowercase: category = 'dining'
4. Do NOT include project_id (added by caller)
5. Default order: created_at DESC

## Category Names
Use lowercase: dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, sports, education, other

## Examples (use today = {today}, year = {year})

Input: "coffee 5"
→ intent: "record", entities: {}

Input: "这个月餐饮花了多少" or "how much on dining this month"
→ intent: "query", queryType: "total", categoryFilter: "dining"
→ timeRange: first day of current month to today (use year {year}!)
→ sqlWhere: include status filter, category, and date range

Input: "最近10笔" / "last 10 transactions"
→ intent: "query", queryType: "history", limit: 10

Input: "spending by category"
→ intent: "query", queryType: "breakdown"

Input: "改成50" / "change to 50"
→ intent: "modify", modifyAction: "edit", targetField: "amount", newValue: 50, targetReference: "last"

Input: "删掉上一笔" / "delete the last one"
→ intent: "modify", modifyAction: "delete", targetReference: "last"

Input: "你好" / "hi"
→ intent: "chat"

REMEMBER: Always use year {year} for dates!`;

// ============================================
// Intent Classifier Class
// ============================================

export class IntentClassifier {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, options?: { readonly model?: string }) {
    this.client = new OpenAI({ apiKey });
    this.model = options?.model ?? 'gpt-4o-mini';
  }

  async classify(text: string): Promise<IntentResult> {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const year = now.getFullYear().toString();
    const systemPrompt = INTENT_SYSTEM_PROMPT
      .replace(/{today}/g, today)
      .replace(/{year}/g, year);

    try {
      const completion = await this.client.beta.chat.completions.parse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        response_format: zodResponseFormat(IntentSchema, 'intent'),
        temperature: 0,
      });

      const parsed = completion.choices[0]?.message?.parsed;

      if (parsed == null) {
        return this.fallbackResult();
      }

      return {
        intent: parsed.intent as Intent,
        confidence: parsed.confidence,
        entities: this.normalizeEntities(parsed.entities),
      };
    } catch (error) {
      console.error('[IntentClassifier] Error:', error instanceof Error ? error.message : error);
      console.error('[IntentClassifier] Stack:', error instanceof Error ? error.stack : 'no stack');
      return this.fallbackResult();
    }
  }

  private normalizeEntities(entities: z.infer<typeof IntentSchema>['entities']): IntentEntities {
    return {
      queryType: entities.queryType,
      timeRange: entities.timeRange as TimeRange | undefined,
      categoryFilter: entities.categoryFilter?.toLowerCase(),
      personFilter: entities.personFilter,
      limit: entities.limit,
      sqlWhere: entities.sqlWhere,
      sqlOrderBy: entities.sqlOrderBy,
      modifyAction: entities.modifyAction,
      targetField: entities.targetField,
      newValue: entities.newValue,
      targetReference: entities.targetReference,
    };
  }

  private fallbackResult(): IntentResult {
    return {
      intent: 'chat',
      confidence: 0.5,
      entities: {},
    };
  }
}
