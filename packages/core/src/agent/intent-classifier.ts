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
      .describe('Category to filter by'),
    personFilter: z.string().optional()
      .describe('Person to filter by'),
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

const INTENT_SYSTEM_PROMPT = `You classify user messages for an expense tracking bot.

## Intents

1. **record** - User wants to log a NEW expense
   - Contains: item/merchant + amount (explicit or implicit)
   - Examples: "coffee 5", "午饭 30", "uber 15", "买菜 120"
   - Keywords: numbers with items/places

2. **query** - User wants to VIEW or ANALYZE existing expenses
   - Examples: "这个月花了多少", "餐饮统计", "谁欠谁钱", "show balance", "历史"
   - Keywords: 多少, 统计, balance, history, 欠, settlement, 看看, 查询
   - Query types:
     - total: 总花费 ("这个月花了多少")
     - breakdown: 按类别分组 ("餐饮统计", "各类消费")
     - history: 交易列表 ("最近消费", "历史记录")
     - balance: 谁欠谁 ("谁欠我钱", "balance")
     - settlement: 结算方案 ("怎么结算", "settle")

3. **modify** - User wants to CHANGE or DELETE existing data
   - Examples: "改成50", "删掉上一笔", "撤销", "把金额改成30"
   - Keywords: 改, 删, 撤销, undo, delete, 修改
   - Use targetReference: "last" for 上一笔/最近的

4. **chat** - Greeting, unclear, or off-topic
   - Examples: "你好", "hi", "谢谢", "怎么用"

## Time Range Parsing
Today is {today}. Parse relative dates into YYYY-MM-DD:
- "这个月" / "this month" → first day to today
- "上个月" / "last month" → first to last day of previous month
- "今天" / "today" → today only
- "这周" / "this week" → Monday to today
- "上周" / "last week" → previous Monday to Sunday

## Category Names
Use lowercase: dining, grocery, gas, shopping, subscription, travel, transport, entertainment, health, utilities, sports, education, other

## Examples

Input: "coffee 5"
Output: { intent: "record", confidence: 0.95, entities: {} }

Input: "这个月餐饮花了多少"
Output: { intent: "query", confidence: 0.95, entities: { queryType: "total", categoryFilter: "dining", timeRange: { start: "2024-01-01", end: "2024-01-24", label: "这个月" } } }

Input: "改成50"
Output: { intent: "modify", confidence: 0.9, entities: { modifyAction: "edit", targetField: "amount", newValue: 50, targetReference: "last" } }

Input: "删掉上一笔"
Output: { intent: "modify", confidence: 0.95, entities: { modifyAction: "delete", targetReference: "last" } }

Input: "你好"
Output: { intent: "chat", confidence: 0.95, entities: {} }`;

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
    const today = new Date().toISOString().split('T')[0];
    const systemPrompt = INTENT_SYSTEM_PROMPT.replace('{today}', today);

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
      console.error('Intent classification error:', error);
      return this.fallbackResult();
    }
  }

  private normalizeEntities(entities: z.infer<typeof IntentSchema>['entities']): IntentEntities {
    return {
      queryType: entities.queryType,
      timeRange: entities.timeRange as TimeRange | undefined,
      categoryFilter: entities.categoryFilter?.toLowerCase(),
      personFilter: entities.personFilter,
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
