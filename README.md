# FinTrack AI

> Proactive expense tracking powered by AI.
> Don't log expenses — let AI detect and confirm them for you.

## The Problem

Traditional expense tracking apps require manual entry:

```
Open app → Select group → Fill form → Choose category → Select who paid → Save
```

This friction means most people give up after a week.

## The Solution

**FinTrack AI flips the model**:

```
Bank sends email → AI parses it → You tap to confirm (1 second)
```

For travel with friends:
```
You: "dinner 50 USD in Tokyo, Alice didn't join"
AI: "Got it. $50 split between you and Bob. Alice excluded.
     ✅ Use Amex Cobalt - Earn 250 pts (~$5)
     🛡️ Don't forget: Mobile Device Insurance
     ✓ Confirm?"
```

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| **AI Agent** | ✅ | Agentic loop with function calling + natural responses |
| **Semantic Few-shot** | ✅ | Embedding-based retrieval for personalized parsing |
| **Voice Input** | ✅ | Whisper transcription → Agent routing |
| **AI Parsing** | ✅ | Natural language → structured transaction via GPT-4o-mini |
| **Natural Language Query** | ✅ | "how much this month" → instant answer |
| **Multi-Project** | ✅ | Separate expenses by trip/event with invite codes |
| **Smart Splitting** | ✅ | "dinner 50, exclude Alice" → auto-split |
| **Multi-Currency** | ✅ | Per-project currency, grouped balance/settle |
| **Location Tracking** | ✅ | AI extracts location or uses project default |
| **Card Recommendation** | 🚧 | Shows best card per transaction + relevant benefits |
| **One-Tap Confirm** | ✅ | Telegram inline keyboards, not forms |
| **Transaction Edit** | ✅ | Edit amount, merchant, category, split inline |
| **Debt Simplification** | ✅ | Minimizes end-of-trip transactions |
| **Gmail Integration** | 🚧 | Auto-parse bank email notifications |

## AI Agent Architecture

The bot uses an **Agentic Loop** pattern with **OpenAI function calling**. Tool results feed back to the LLM, which generates natural, conversational responses — no templates.

```
User: "hmark 62.64"
         ↓
┌─────────────────────────┐
│    Working Memory       │ → lastTransaction: null
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│    LLM (Agentic Loop)   │ → tool_call: record_expense
│    (function calling)   │ → {rawText: "hmark 62.64"}
└─────────────────────────┘
         ↓
   Tool executes → result fed back to LLM → natural response
         ↓
Bot: "Got it! Recorded $62.64 at hmark under grocery 🛒
      [Confirm] [Edit] [Personal] [Delete]"

User: "no I mean H Mart, and it was 65"
         ↓
┌─────────────────────────┐
│    Working Memory       │ → lastTransaction: {merchant: "hmark", ...}
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│    LLM (Agentic Loop)   │ → tool_call: modify_expense
│    (understands context)│ → {target: "last", merchant: "H Mart", amount: 65}
└─────────────────────────┘
         ↓
Bot: "Updated to H Mart, $65.00 👍
      [Confirm] [Edit] [Personal] [Delete]"

User: "record lunch 15 and show me this week's total"
         ↓
┌─────────────────────────┐
│    LLM (Agentic Loop)   │ → tool_calls: [record_expense, query_expenses]
│    (multi-tool in 1 turn)│   executed in parallel
└─────────────────────────┘
         ↓
Bot: "Recorded $15.00 lunch under dining. This week you've spent
      $142.50 across 8 transactions."
```

### Working Memory

The agent maintains context for natural corrections:
- **lastTransaction**: Most recent transaction (10-min TTL)
- **recentMessages**: Last 5 conversation messages
- Recognizes: "No, I mean X", "Actually 25", "That was at Costco"

### Tools (Function Calling)

| Tool | Trigger | Description |
|------|---------|-------------|
| `record_expense` | "coffee 5" | Log new expense via parser |
| `query_expenses` | "how much this month" | View/analyze expenses |
| `modify_expense` | "change to H Mart" / "actually 25" | Correct amount, merchant, and/or category |
| `delete_expense` | "delete that" | Remove transaction |
| _(no tool)_ | "hello", "help" | Text response — greetings, unknown requests |

### Semantic Few-shot Learning

New transactions are parsed with context from similar historical data:

```
User: "basketball fee 26"
         ↓
┌─────────────────────────┐
│   Vectorize Search      │ → Find "basketball fee $26 (sports)"
│   (text-embedding-3)    │ → similarity: 0.95
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│   Parser + few-shot     │ → category: sports ✓ (not "other")
└─────────────────────────┘
```

## Card Strategy System

The card recommendation engine helps maximize credit card rewards:

```
💳 New Transaction
📁 Costa Rica Trip
📍 Restaurant La Casona (San José)
💰 $50.00 USD

✅ Use Amex Cobalt
💰 Earn 250 pts (~$5.00)

🎁 Benefits with this card:
  🛡️ Mobile Device Insurance
  💵 Monthly Uber Credit

💡 Consider Rogers WE MC for foreign transactions (no FX fee)
```

### Preset Cards (Canada)

| Card | Best For | Key Benefit |
|------|----------|-------------|
| Amex Cobalt | Dining, Grocery (5x) | Uber credit, phone insurance |
| Amex Gold | Travel (2x) | Lounge access, travel insurance |
| TD Aeroplan VI | Flights (3x) | Free checked bag, delay insurance |
| Rogers WE MC | Foreign (No FX) | 4% cashback on USD |
| Tangerine MC | Custom 2% | No annual fee |

## Bot Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `/menu` | `/m` | Main menu |
| `/balance` | `/b` | Show who owes whom |
| `/settle` | `/s` | Settlement instructions |
| `/history` | `/hi` | Recent transactions |
| `/cards` | `/c` | My credit cards |
| `/addcard` | | Add a card |
| `/removecard` | | Remove a card |
| `/projects` | `/p` | List my projects |
| `/new <name>` | | Create project |
| `/join <code>` | | Join via invite code |
| `/invite` | | Generate invite code (7-day expiry) |

## Quick Start

```bash
# Clone and install
git clone https://github.com/bodhiforge/fintrack-ai.git
cd fintrack-ai && pnpm install

# Deploy to Cloudflare
cd packages/telegram-bot
npx wrangler d1 execute fintrack-db --file=schema.sql --remote
npx wrangler d1 execute fintrack-db --file=migrations/004_user_cards.sql --remote
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler deploy

# Set webhook
curl https://your-worker.workers.dev/setup-webhook
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Processing Layer                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Cloudflare Workers (Edge)              │    │
│  │  ┌───────────────┐  ┌─────────┐  ┌─────────────┐  │    │
│  │  │ Agentic Loop  │  │ Parser  │  │  Splitter   │  │    │
│  │  │ (Fn Calling)  │  │  (AI)   │  │   (Algo)    │  │    │
│  │  └───────────────┘  └─────────┘  └─────────────┘  │    │
│  │  ┌───────────────┐  ┌─────────┐  ┌─────────────┐  │    │
│  │  │   Whisper     │  │ Vision  │  │  Embedding  │  │    │
│  │  │   (Voice)     │  │  (OCR)  │  │  (Few-shot) │  │    │
│  │  └───────────────┘  └─────────┘  └─────────────┘  │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │              Cloudflare D1 (SQLite)               │      │
│  │  users | projects | transactions | working_memory │      │
│  └──────────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────────┐      │
│  │           Cloudflare Vectorize                    │      │
│  │  transaction embeddings (1536-dim, cosine)        │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
packages/
├── core/                     # Shared business logic
│   ├── agent/                # AI Agent system
│   │   ├── tools/types.ts        # Tool, ToolExecutionResult, ToolContext
│   │   └── types.ts              # WorkingMemory, LastTransaction types
│   ├── parser.ts             # AI transaction parsing
│   ├── splitter.ts           # Expense splitting & debt simplification
│   └── types.ts              # TypeScript types
├── telegram-bot/             # Telegram bot worker
│   └── src/
│       ├── index.ts          # Entry point (HTTP routing)
│       ├── agent/            # Agent orchestration
│       │   ├── index.ts          # Agentic loop (recursive LLM ↔ tools)
│       │   ├── prompt-builder.ts # System prompt + conversation builder
│       │   ├── memory-session.ts # Working memory CRUD
│       │   ├── query-executor.ts # D1 query execution + query types
│       │   └── response-formatter.ts
│       ├── tools/            # Self-contained tools
│       │   ├── registry.ts       # Tool registry + getForLLM()
│       │   ├── record-tool.ts    # record_expense
│       │   ├── query-tool.ts     # query_expenses
│       │   ├── modify-tool.ts    # modify_expense (unified)
│       │   ├── delete-tool.ts    # delete_expense
│       │   └── keyboards.ts      # Shared keyboard builders
│       ├── services/         # AI services
│       │   ├── embedding.ts      # Vectorize for few-shot
│       │   ├── whisper.ts        # Voice transcription
│       │   └── vision.ts         # Receipt OCR
│       ├── handlers/         # Request handlers
│       │   ├── commands/     # /menu, /balance, etc.
│       │   └── callbacks/    # Inline button handlers
│       ├── db/               # Database helpers
│       └── telegram/         # Telegram API helpers
└── gmail-worker/             # Gmail webhook processor (WIP)
```

## Roadmap

- [x] **Phase 1: MVP** - AI parsing, splitting, multi-project
- [x] **Phase 2: Card Strategy** - Recommend best card, show benefits
- [x] **Phase 2.5: Code Quality** - Modular architecture, immutability
- [x] **Phase 3: Agent Architecture** - Intent routing, natural language queries
- [x] **Phase 3.5: Semantic Few-shot** - Embedding-based personalized parsing
- [x] **Phase 4: Memory-First Agent** - Context-aware corrections, working memory
- [x] **Phase 4.5: Pi Agent Tool System** - OpenAI function calling, discrete tools, result converter
- [x] **Phase 5: Agentic Loop** - Tool results feed back to LLM, natural responses, multi-tool turns
- [ ] **Phase 6: Proactive Suggestions** - Anomaly detection, spending insights
- [ ] **Phase 7: Gmail Integration** - Auto-parse bank emails

## Recent Commits

| Commit | Description |
|--------|-------------|
| `ebb8c82` | refactor: switch from structured output to OpenAI function calling |
| `76f7e40` | feat: add Pi Agent-style tool system with bug fixes |
| `74c50a9` | feat: improve project management and menu UX |
| `0d15270` | feat: implement memory-first agent architecture |
| `6560410` | feat: add embedding-based semantic few-shot retrieval |

## License

MIT
