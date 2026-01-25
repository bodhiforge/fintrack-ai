# FinTrack AI

> AI-powered expense tracking with natural language understanding.
> Just tell it what you spent — it handles the rest.

## The Problem

Traditional expense tracking apps require manual entry:

```
Open app → Select group → Fill form → Choose category → Select who paid → Save
```

This friction means most people give up after a week.

## The Solution

**FinTrack AI understands your intent**:

```
You: "coffee 5"           → Logs expense
You: "how much this month" → Shows spending summary
You: "delete the last one" → Removes last transaction
```

For travel with friends:
```
You: "dinner 50 USD in Tokyo, Alice didn't join"
AI: "Got it. $50 split between you and Bob. Alice excluded. ✓ Confirm?"
```

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| **Intent Classification** | ✅ | Understands record/query/modify/chat via single LLM call |
| **Natural Language Query** | ✅ | "how much on dining this month" → spending summary |
| **Natural Language Modify** | ✅ | "delete the last one" → removes transaction |
| **AI Parsing** | ✅ | Natural language → structured transaction via GPT-4o-mini |
| **Multi-Project** | ✅ | Separate expenses by trip/event with invite codes |
| **Smart Splitting** | ✅ | "dinner 50, exclude Alice" → auto-split |
| **Multi-Currency** | ✅ | Per-project currency, grouped balance/settle |
| **Location Tracking** | ✅ | AI extracts location or uses project default |
| **Voice Input** | ✅ | Send voice message → Whisper transcription → parse |
| **One-Tap Confirm** | ✅ | Telegram inline keyboards, not forms |
| **Transaction Edit** | ✅ | Edit amount, merchant, category, split inline |
| **Debt Simplification** | ✅ | Minimizes end-of-trip transactions |
| **Low-Confidence Dialog** | ✅ | Asks for clarification when unsure |
| **Receipt OCR** | 🚧 | Photo → GPT-4o Vision → parse |
| **Gmail Integration** | 🔜 | Auto-parse bank email notifications |

## Natural Language Examples

| Input | Intent | Result |
|-------|--------|--------|
| `coffee 5` | record | Logs $5 coffee expense |
| `lunch 30 without Bob` | record | Logs $30, excludes Bob from split |
| `how much this month` | query | Shows total spending this month |
| `spending by category` | query | Shows breakdown by category |
| `delete the last one` | modify | Deletes most recent transaction |
| `change to 50` | modify | Updates last transaction to $50 |
| `hi` | chat | Shows welcome message |

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
│                      Telegram Input                          │
│              Text / Voice / Photo / Location                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Agent Orchestrator                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │           IntentClassifier (gpt-4o-mini)            │    │
│  │     Structured Outputs → intent + entities + SQL    │    │
│  └────────────────────────────────────────────────────┘    │
│                          │                                   │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   record   │  │   query    │  │   modify   │            │
│  │  → Parser  │  │ → D1 Query │  │ → Edit/Del │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │              Cloudflare D1 (SQLite)               │      │
│  │  users | projects | transactions | sessions       │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
packages/
├── core/                     # Shared business logic
│   ├── agent/                # Agent system
│   │   ├── intent-classifier.ts  # LLM intent + SQL generation
│   │   ├── query-parser.ts       # (deprecated, merged into classifier)
│   │   └── types.ts              # Agent type definitions
│   ├── parser.ts             # AI transaction parsing
│   ├── splitter.ts           # Expense splitting & debt simplification
│   └── types.ts              # TypeScript types
├── telegram-bot/             # Telegram bot worker
│   └── src/
│       ├── index.ts          # Entry point (HTTP routing)
│       ├── agent/            # Agent orchestration
│       │   ├── index.ts          # Main entry point (processWithAgent)
│       │   ├── query-executor.ts # D1 query execution
│       │   ├── response-formatter.ts # Format query results
│       │   └── session.ts        # Multi-turn conversation state
│       ├── handlers/         # Request handlers
│       │   ├── commands/     # /menu, /balance, /history, etc.
│       │   └── callbacks/    # Inline button handlers
│       ├── services/         # External services
│       │   ├── whisper.ts        # Voice transcription
│       │   └── vision.ts         # Receipt OCR (WIP)
│       ├── db/               # Database helpers
│       └── telegram/         # Telegram API helpers
└── gmail-worker/             # Gmail webhook processor (WIP)
```

## Roadmap

- [x] **Phase 1: MVP** - AI parsing, splitting, multi-project
- [x] **Phase 2: Card Strategy** - Recommend best card, show benefits
- [x] **Phase 3: Agent Architecture** - Intent classification, natural language queries
- [x] **Phase 3.5: Voice Input** - Whisper transcription support
- [ ] **Phase 4: Receipt OCR** - Photo → GPT-4o Vision → parse
- [ ] **Phase 5: Gmail Integration** - Auto-parse bank emails
- [ ] **Phase 6: Proactive Insights** - Spending alerts, monthly summaries

## Recent Commits

| Commit | Description |
|--------|-------------|
| `bda4088` | feat: add low-confidence intent clarification dialog |
| `706ded9` | perf: merge IntentClassifier and QueryParser into single LLM call |
| `27db182` | feat: add Agent architecture with intent routing and query tools |
| `ec984a5` | feat: add custom category input with /editcat command |
| `3342388` | refactor: change default UI language from Chinese to English |

## License

MIT
