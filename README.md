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
| **AI Agent** | ✅ | Intent classification + natural language queries |
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

The bot uses a **Memory-First Agent** pattern for context-aware conversations:

```
User: "hmark 62.64"
         ↓
┌─────────────────────────┐
│    Working Memory       │ → lastTransaction: null
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│    Memory Agent         │ → action: record
│    (gpt-4o-mini)        │ → Creates transaction
└─────────────────────────┘
         ↓
Bot: "💳 hmark $62.64"

User: "No, I mean H Mart"
         ↓
┌─────────────────────────┐
│    Working Memory       │ → lastTransaction: {merchant: "hmark", ...}
└─────────────────────────┘
         ↓
┌─────────────────────────┐
│    Memory Agent         │ → action: modify
│    (understands context)│ → Updates merchant to "H Mart"
└─────────────────────────┘
         ↓
Bot: "Updated merchant: hmark → H Mart"
```

### Working Memory

The agent maintains context for natural corrections:
- **lastTransaction**: Most recent transaction (10-min TTL)
- **recentMessages**: Last 5 conversation messages
- Recognizes: "No, I mean X", "Actually 25", "That was at Costco"

### Action Types

| Action | Example | Description |
|--------|---------|-------------|
| `record` | "coffee 5" | Log new expense |
| `query` | "how much this month" | View/analyze expenses |
| `modify` | "No, I mean H Mart" | Edit last transaction |
| `delete` | "delete the last one" | Remove transaction |
| `clarify` | (ambiguous input) | Ask for more info |
| `respond` | "hello" | General chat |

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
│  │  │ Agent Router  │  │ Parser  │  │  Splitter   │  │    │
│  │  │ (Intent+SQL)  │  │  (AI)   │  │   (Algo)    │  │    │
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
│   │   ├── memory-agent.ts       # Memory-aware action decision
│   │   ├── action-schema.ts      # Unified action types (Zod)
│   │   ├── intent-classifier.ts  # Legacy intent classifier
│   │   └── types.ts              # Agent + memory types
│   ├── parser.ts             # AI transaction parsing
│   ├── splitter.ts           # Expense splitting & debt simplification
│   └── types.ts              # TypeScript types
├── telegram-bot/             # Telegram bot worker
│   └── src/
│       ├── index.ts          # Entry point (HTTP routing)
│       ├── agent/            # Agent orchestration
│       │   ├── index.ts          # Main router (uses MemoryAgent)
│       │   ├── action-executor.ts# Execute agent actions
│       │   ├── memory-session.ts # Working memory CRUD
│       │   ├── query-executor.ts # D1 query execution
│       │   └── response-formatter.ts
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
- [ ] **Phase 5: Proactive Suggestions** - Anomaly detection, spending insights
- [ ] **Phase 6: Gmail Integration** - Auto-parse bank emails

## Recent Commits

| Commit | Description |
|--------|-------------|
| `0d15270` | feat: implement memory-first agent architecture |
| `6560410` | feat: add embedding-based semantic few-shot retrieval |
| `bda4088` | feat: add low-confidence intent clarification dialog |
| `706ded9` | perf: merge IntentClassifier and QueryParser into single LLM call |
| `27db182` | feat: add Agent architecture with intent routing and query tools |

## License

MIT
