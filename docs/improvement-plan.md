# FinTrack AI 架构改进方案

## 问题诊断

### 1. Few-shot 语义不相关
```
用户输入: "tt 50"
当前: 返回最近10条 (可能都是 uber, starbucks...)
理想: 返回 "tt 45" → T&T Supermarket (语义相似)
```

### 2. 缺乏 Intent Router
```
用户: "这个月花了多少"
当前: 尝试解析为 expense → 失败
理想: 识别为 query intent → 调用 Query Tool
```

### 3. 没有主动洞察
```
用户: "咖啡 50"
当前: 只记录
理想: "这比你平时咖啡贵3倍，确认吗？"
```

---

## Phase 1: 语义 Few-shot (RAG)

### 方案选择

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| Cloudflare Vectorize | 原生集成 | 需要 paid plan | ⭐⭐⭐ |
| D1 + sqlite-vss | 免费 | 需要编译 extension | ⭐⭐ |
| Embedding + 余弦相似度 | 简单 | 全量计算 | ⭐ |
| OpenAI Embedding API | 最简单 | 每次调用有成本 | ⭐⭐⭐⭐ |

### 推荐: OpenAI Embedding + D1 存储

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
  // 获取用户最近 100 条有 embedding 的记录
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

  // 计算相似度并排序
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

### 流程变更

```
Before:
  Input → getRecentExamples() → Parser

After:
  Input → getEmbedding(input) → getSimilarExamples(embedding) → Parser
```

---

## Phase 2: Intent Router

### 架构图

```
User Input
    ↓
┌─────────────────┐
│  Intent Router  │ ← LLM 分类
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    ↓         ↓          ↓          ↓
 record    query      modify      chat
    ↓         ↓          ↓          ↓
 Parser   QueryTool  EditFlow   ChatHandler
```

### Intent 定义

```typescript
// packages/core/src/intent.ts
const IntentSchema = z.object({
  intent: z.enum(['record', 'query', 'modify', 'chat', 'help']),
  confidence: z.number().min(0).max(1),
  // 可选: 提取的关键参数
  params: z.object({
    timeRange: z.string().optional(),  // "这个月", "上周"
    category: z.string().optional(),   // "餐饮", "交通"
    transactionId: z.string().optional(),
  }).optional(),
});

const INTENT_PROMPT = `Classify user intent for an expense tracking app.

Intents:
- record: User wants to log a new expense (e.g., "午饭 30", "uber 15")
- query: User wants to know spending stats (e.g., "这个月花了多少", "餐饮统计")
- modify: User wants to change/delete existing record (e.g., "删掉上一笔", "改成50")
- chat: General conversation or unclear (e.g., "你好", "谢谢")
- help: User needs help (e.g., "怎么用", "帮助")

Examples:
- "tt 50" → record
- "本周餐饮多少" → query
- "上一笔改成 30" → modify
- "你好" → chat`;
```

### Router 实现

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

### Handler 路由

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

### 自然语言查询

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
  // 让 LLM 解析查询参数
  const query = await parseQuery(text, environment.OPENAI_API_KEY);

  // 执行 SQL 查询
  const result = await executeQuery(query, environment.DB);

  // 格式化输出
  const response = formatQueryResult(query, result);
  await sendMessage(chatId, response, ...);
}
```

### 查询示例

| 输入 | 解析 | SQL |
|------|------|-----|
| "这个月花了多少" | {type: 'sum', timeRange: thisMonth} | `SELECT SUM(amount) FROM transactions WHERE created_at >= ?` |
| "餐饮统计" | {type: 'sum', category: 'dining'} | `SELECT SUM(amount) FROM ... WHERE category = 'dining'` |
| "上周每天消费" | {type: 'sum', groupBy: 'day'} | `SELECT date, SUM(amount) GROUP BY date` |

---

## Phase 4: Proactive AI

### 异常检测

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

  // 1. 金额异常 (超过该类别平均值 3 倍)
  const categoryAvg = calculateCategoryAverage(history, transaction.category);
  if (transaction.amount > categoryAvg * 3) {
    anomalies.push({
      type: 'high_amount',
      message: `这笔消费 ($${transaction.amount}) 比你平时${transaction.category}高很多`,
      severity: 'warning',
    });
  }

  // 2. 首次商家
  const knownMerchants = new Set(history.map(t => t.merchant.toLowerCase()));
  if (!knownMerchants.has(transaction.merchant.toLowerCase())) {
    anomalies.push({
      type: 'unusual_merchant',
      message: `首次在 "${transaction.merchant}" 消费`,
      severity: 'info',
    });
  }

  return anomalies;
}
```

### 集成到确认流程

```typescript
// 在 processTransactionText 中
const anomalies = await detectAnomalies(parsed, userHistory);

if (anomalies.some(a => a.severity === 'warning')) {
  // 显示警告并要求确认
  const warningSection = anomalies.map(a => `⚠️ ${a.message}`);
  // 修改 keyboard 为需要明确确认
}
```

---

## Phase 5: 小模型优化

### OCR 降级

```typescript
// packages/telegram-bot/src/services/vision.ts
// 修改模型为 gpt-4o-mini
model: 'gpt-4o-mini',  // 从 gpt-4o 改为 mini
```

### 成本对比

| 场景 | 当前 | 优化后 | 节省 |
|------|------|--------|------|
| Text parsing | gpt-4o-mini | 不变 | 0% |
| OCR | gpt-4o | gpt-4o-mini | 90% |
| Intent routing | - | gpt-4o-mini | 新增 |
| Embedding | - | text-embedding-3-small | 新增 |

---

## 实施优先级

| Phase | 内容 | 复杂度 | 价值 | 优先级 |
|-------|------|--------|------|--------|
| 1a | OCR 改用 gpt-4o-mini | 低 | 高 (省钱) | P0 |
| 1b | 语义 Few-shot | 中 | 高 | P1 |
| 2 | Intent Router | 中 | 高 | P1 |
| 3 | Query Tool | 中 | 中 | P2 |
| 4 | Proactive AI | 高 | 高 | P2 |

---

## 关键文件清单

```
packages/core/src/
├── embedding.ts         # 新建 - Embedding API
├── router.ts            # 新建 - Intent Router
├── anomaly.ts           # 新建 - 异常检测

packages/telegram-bot/
├── migrations/006_add_embedding.sql  # 新建
├── src/db/transactions.ts            # 添加 getSimilarExamples
├── src/handlers/message.ts           # 添加 intent routing
├── src/handlers/query.ts             # 新建 - Query handler
└── src/services/vision.ts            # 改用 gpt-4o-mini
```

---

## 验证方式

### Phase 1: 语义 Few-shot
```bash
# 创建历史: "tt 45" → T&T Supermarket
# 输入: "tt 50"
# 期望: 推断出 T&T Supermarket (而非其他商家)
```

### Phase 2: Intent Router
```bash
# 输入: "这个月花了多少"
# 期望: 返回统计结果, 而非解析失败
```

### Phase 4: Proactive AI
```bash
# 创建历史: 平均咖啡 $5
# 输入: "咖啡 50"
# 期望: 显示警告 "这比你平时咖啡贵10倍"
```
