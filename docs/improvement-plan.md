# FinTrack AI Architecture Improvement Plan

## Problem Diagnosis

### 1. Few-shot Semantic Irrelevance
```
User input: "tt 50"
Current: Returns last 10 records (may be uber, starbucks...)
Ideal: Returns "tt 45" → T&T Supermarket (semantically similar)
```

### 2. Missing Intent Router
```
User: "how much this month"
Current: Tries to parse as expense → fails
Ideal: Recognize as query intent → call Query Tool
```

### 3. No Proactive Insights
```
User: "coffee 50"
Current: Just records
Ideal: "This is 3x your usual coffee price, confirm?"
```

---

## Phase 1: Semantic Few-shot (RAG)

### Solution Comparison

| Solution | Pros | Cons | Rating |
|----------|------|------|--------|
| Cloudflare Vectorize | Native integration | Requires paid plan | ⭐⭐⭐ |
| D1 + sqlite-vss | Free | Needs extension compilation | ⭐⭐ |
| Embedding + Cosine similarity | Simple | Full calculation | ⭐ |
| OpenAI Embedding API | Simplest | Per-call cost | ⭐⭐⭐⭐ |

### Recommended: OpenAI Embedding + D1 Storage

```sql
-- migrations/006_add_embedding.sql
ALTER TABLE transactions ADD COLUMN input_embedding TEXT; -- JSON array
```

```typescript
// packages/core/src/embedding.ts
export async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });
  const data = await response.json();
  return data.data[0].embedding;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

```typescript
// packages/telegram-bot/src/db/transactions.ts
export async function getSimilarExamples(
  database: D1Database,
  userId: number,
  inputEmbedding: number[],
  limit: number = 5
): Promise<readonly HistoryExample[]> {
  // Get user's last 100 records with embedding
  const result = await database.prepare(`
    SELECT raw_input, merchant, category, currency, input_embedding
    FROM transactions
    WHERE user_id = ?
      AND raw_input IS NOT NULL
      AND input_embedding IS NOT NULL
      AND status IN ('confirmed', 'personal')
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(userId).all();

  // Calculate similarity and sort
  const scored = result.results
    .map(row => ({
      input: row.raw_input as string,
      merchant: row.merchant as string,
      category: row.category as string,
      currency: row.currency as string,
      similarity: cosineSimilarity(
        inputEmbedding,
        JSON.parse(row.input_embedding as string)
      ),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored;
}
```

### Flow Changes

```
Before:
  Input → getRecentExamples() → Parser

After:
  Input → getEmbedding(input) → getSimilarExamples(embedding) → Parser
```

---

## Phase 2: Intent Router

### Architecture Diagram

```
User Input
    ↓
┌─────────────────┐
│  Intent Router  │ ← LLM classification
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    ↓         ↓          ↓          ↓
 record    query      modify      chat
    ↓         ↓          ↓          ↓
 Parser   QueryTool  EditFlow   ChatHandler
```

### Intent Definition

```typescript
// packages/core/src/intent.ts
const IntentSchema = z.object({
  intent: z.enum(['record', 'query', 'modify', 'chat', 'help']),
  confidence: z.number().min(0).max(1),
  // Optional: extracted key parameters
  params: z.object({
    timeRange: z.string().optional(),  // "this month", "last week"
    category: z.string().optional(),   // "dining", "transport"
    transactionId: z.string().optional(),
  }).optional(),
});

const INTENT_PROMPT = `Classify user intent for an expense tracking app.

Intents:
- record: User wants to log a new expense (e.g., "lunch 30", "uber 15")
- query: User wants to know spending stats (e.g., "how much this month", "dining stats")
- modify: User wants to change/delete existing record (e.g., "delete last one", "change to 50")
- chat: General conversation or unclear (e.g., "hello", "thanks")
- help: User needs help (e.g., "how to use", "help")

Examples:
- "tt 50" → record
- "how much on dining this week" → query
- "change last one to 30" → modify
- "hello" → chat`;
```

### Router Implementation

```typescript
// packages/core/src/router.ts
export async function classifyIntent(
  input: string,
  apiKey: string
): Promise<IntentResult> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: INTENT_PROMPT },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_schema', json_schema: intentJsonSchema },
      temperature: 0,
    }),
  });

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}
```

### Handler Routing

```typescript
// packages/telegram-bot/src/handlers/message.ts
async function processMessage(text: string, ...): Promise<void> {
  const intent = await classifyIntent(text, env.OPENAI_API_KEY);

  switch (intent.intent) {
    case 'record':
      return processTransactionText(text, ...);
    case 'query':
      return handleQueryIntent(text, intent.params, ...);
    case 'modify':
      return handleModifyIntent(text, intent.params, ...);
    case 'chat':
      return handleChatIntent(text, ...);
    case 'help':
      return handleHelp(...);
  }
}
```

---

## Phase 3: Query Tool

### Natural Language Query

```typescript
// packages/telegram-bot/src/handlers/query.ts
const QuerySchema = z.object({
  type: z.enum(['sum', 'count', 'list', 'average']),
  category: z.string().optional(),
  timeRange: z.object({
    start: z.string(),  // YYYY-MM-DD
    end: z.string(),
  }),
  groupBy: z.enum(['category', 'merchant', 'day', 'week']).optional(),
});

async function handleQueryIntent(
  text: string,
  params: IntentParams,
  environment: Environment
): Promise<void> {
  // Let LLM parse query parameters
  const query = await parseQuery(text, environment.OPENAI_API_KEY);

  // Execute SQL query
  const result = await executeQuery(query, environment.DB);

  // Format output
  const response = formatQueryResult(query, result);
  await sendMessage(chatId, response, ...);
}
```

### Query Examples

| Input | Parsed | SQL |
|-------|--------|-----|
| "how much this month" | {type: 'sum', timeRange: thisMonth} | `SELECT SUM(amount) FROM transactions WHERE created_at >= ?` |
| "dining stats" | {type: 'sum', category: 'dining'} | `SELECT SUM(amount) FROM ... WHERE category = 'dining'` |
| "daily spending last week" | {type: 'sum', groupBy: 'day'} | `SELECT date, SUM(amount) GROUP BY date` |

---

## Phase 4: Proactive AI

### Anomaly Detection

```typescript
// packages/core/src/anomaly.ts
interface AnomalyCheck {
  readonly type: 'high_amount' | 'unusual_merchant' | 'frequency';
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'alert';
}

export async function detectAnomalies(
  transaction: ParsedTransaction,
  history: readonly Transaction[],
): Promise<readonly AnomalyCheck[]> {
  const anomalies: AnomalyCheck[] = [];

  // 1. Amount anomaly (exceeds 3x category average)
  const categoryAvg = calculateCategoryAverage(history, transaction.category);
  if (transaction.amount > categoryAvg * 3) {
    anomalies.push({
      type: 'high_amount',
      message: `This expense ($${transaction.amount}) is much higher than your usual ${transaction.category}`,
      severity: 'warning',
    });
  }

  // 2. First-time merchant
  const knownMerchants = new Set(history.map(t => t.merchant.toLowerCase()));
  if (!knownMerchants.has(transaction.merchant.toLowerCase())) {
    anomalies.push({
      type: 'unusual_merchant',
      message: `First time at "${transaction.merchant}"`,
      severity: 'info',
    });
  }

  return anomalies;
}
```

### Integration into Confirmation Flow

```typescript
// In processTransactionText
const anomalies = await detectAnomalies(parsed, userHistory);

if (anomalies.some(a => a.severity === 'warning')) {
  // Display warning and require confirmation
  const warningSection = anomalies.map(a => `⚠️ ${a.message}`);
  // Modify keyboard to require explicit confirmation
}
```

---

## Phase 5: Small Model Optimization

### OCR Downgrade

```typescript
// packages/telegram-bot/src/services/vision.ts
// Change model to gpt-4o-mini
model: 'gpt-4o-mini',  // Changed from gpt-4o to mini
```

### Cost Comparison

| Scenario | Current | Optimized | Savings |
|----------|---------|-----------|---------|
| Text parsing | gpt-4o-mini | No change | 0% |
| OCR | gpt-4o | gpt-4o-mini | 90% |
| Intent routing | - | gpt-4o-mini | New |
| Embedding | - | text-embedding-3-small | New |

---

## Implementation Priority

| Phase | Content | Complexity | Value | Priority |
|-------|---------|------------|-------|----------|
| 1a | OCR use gpt-4o-mini | Low | High (cost) | P0 |
| 1b | Semantic Few-shot | Medium | High | P1 |
| 2 | Intent Router | Medium | High | P1 |
| 3 | Query Tool | Medium | Medium | P2 |
| 4 | Proactive AI | High | High | P2 |

---

## Key Files List

```
packages/core/src/
├── embedding.ts         # New - Embedding API
├── router.ts            # New - Intent Router
├── anomaly.ts           # New - Anomaly Detection

packages/telegram-bot/
├── migrations/006_add_embedding.sql  # New
├── src/db/transactions.ts            # Add getSimilarExamples
├── src/handlers/message.ts           # Add intent routing
├── src/handlers/query.ts             # New - Query handler
└── src/services/vision.ts            # Use gpt-4o-mini
```

---

## Validation

### Phase 1: Semantic Few-shot
```bash
# Create history: "tt 45" → T&T Supermarket
# Input: "tt 50"
# Expected: Infer T&T Supermarket (not other merchants)
```

### Phase 2: Intent Router
```bash
# Input: "how much this month"
# Expected: Returns stats result, not parse failure
```

### Phase 4: Proactive AI
```bash
# Create history: average coffee $5
# Input: "coffee 50"
# Expected: Shows warning "This is 10x your usual coffee price"
```
