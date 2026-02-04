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
| **AI Agent** | ✅ | OpenAI function calling + natural language queries |
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

The bot uses **OpenAI function calling** with a **Memory-First** pattern. Each capability is a self-contained tool — the LLM naturally picks the right tool or responds with text when no tool fits.

```
User: "hmark 62.64"
         ↓
┌─────────────────────────┐
│    Working Memory       │ → lastTransaction: null
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│    Memory Agent         │ → tool_call: record_expense
│    (function calling)   │ → {rawText: "hmark 62.64"}
└─────────────────────────┘
         ↓
   Tool Execution → Result Converter → Telegram Keyboard
         ↓
Bot: "💳 hmark $62.64  [Confirm] [Edit]"

User: "H Mart"
         ↓
┌─────────────────────────┐
│    Working Memory       │ → lastTransaction: {merchant: "hmark", ...}
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│    Memory Agent         │ → tool_call: modify_merchant
│    (understands context)│ → {target: "last", newMerchant: "H Mart"}
└─────────────────────────┘
         ↓
Bot: "✅ Updated merchant: hmark → H Mart"

User: "hello"
         ↓
┌─────────────────────────┐
│    Memory Agent         │ → text response (no tool call)
└─────────────────────────┘
         ↓
Bot: "Hello! I can help you track expenses..."
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
| `modify_amount` | "40.81" (a number) | Correct amount of last transaction |
| `modify_merchant` | "H Mart" (a name) | Correct merchant of last transaction |
| `modify_category` | "grocery" (a category) | Correct category of last transaction |
| `delete_expense` | "delete that" | Remove transaction |
| _(no tool)_ | "hello", "set default..." | Text response — greetings, unknown requests |

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
│  │  │ Memory Agent  │  │ Parser  │  │  Splitter   │  │    │
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
│   │   ├── memory-agent.ts       # LLM decision via function calling
│   │   ├── tools/types.ts        # Tool, ToolDefinition, PiToolResult
│   │   ├── intent-classifier.ts  # Legacy intent classifier
│   │   └── types.ts              # Agent + memory + AgentDecision types
│   ├── parser.ts             # AI transaction parsing
│   ├── splitter.ts           # Expense splitting & debt simplification
│   └── types.ts              # TypeScript types
├── telegram-bot/             # Telegram bot worker
│   └── src/
│       ├── index.ts          # Entry point (HTTP routing)
│       ├── agent/            # Agent orchestration
│       │   ├── index.ts          # Orchestrator (decide → execute → convert)
│       │   ├── result-converter.ts # PiToolResult → AgentResult + keyboards
│       │   ├── memory-session.ts # Working memory CRUD
│       │   ├── query-executor.ts # D1 query execution
│       │   └── response-formatter.ts
│       ├── tools/            # Pi Agent-style tool system
│       │   ├── registry.ts       # Tool registry + getForLLM()
│       │   ├── record-tool.ts    # record_expense
│       │   ├── query-tool.ts     # query_expenses
│       │   ├── modify-amount-tool.ts   # modify_amount
│       │   ├── modify-merchant-tool.ts # modify_merchant
│       │   ├── modify-category-tool.ts # modify_category
│       │   ├── modify-helpers.ts # Shared modify DB logic
│       │   └── delete-tool.ts    # delete_expense
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
- [ ] **Phase 5: Proactive Suggestions** - Anomaly detection, spending insights
- [ ] **Phase 6: Gmail Integration** - Auto-parse bank emails

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
