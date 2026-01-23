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
AI: "Got it. $50 split between you and Bob. Alice excluded. ✓ Confirm?"
```

## Features

| Feature | Status | Description |
|---------|--------|-------------|
| **AI Parsing** | ✅ | Natural language → structured transaction via GPT-4o-mini |
| **Multi-Project** | ✅ | Separate expenses by trip/event with invite codes |
| **Smart Splitting** | ✅ | "dinner 50, exclude Alice" → auto-split |
| **Multi-Currency** | ✅ | Per-project currency, grouped balance/settle |
| **Location Tracking** | ✅ | AI extracts location or uses project default |
| **Card Strategy** | ✅ | Alerts when you miss credit card rewards |
| **One-Tap Confirm** | ✅ | Telegram inline keyboards, not forms |
| **Transaction Edit** | ✅ | Edit amount, merchant, category, split inline |
| **Debt Simplification** | ✅ | Minimizes end-of-trip transactions |
| **Gmail Integration** | 🚧 | Auto-parse bank email notifications |

## Quick Start

```bash
# Clone and install
git clone https://github.com/anthropics/fintrack-ai.git
cd fintrack-ai && pnpm install

# Deploy to Cloudflare
cd packages/telegram-bot
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler deploy

# Set webhook
curl https://your-worker.workers.dev/setup-webhook
```

## Bot Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `/menu` | `/m` | Main menu |
| `/balance` | `/b` | Show who owes whom |
| `/settle` | `/s` | Settlement instructions |
| `/history` | `/hi` | Recent transactions |
| `/projects` | `/p` | List my projects |
| `/new <name>` | | Create project |
| `/join <code>` | | Join via invite code |
| `/invite` | | Generate invite code (7-day expiry) |
| `/switch` | | Switch project |
| `/setlocation` | | Set project default location |
| `/setcurrency` | | Set project default currency |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Signal Layer                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Bank Emails  │  │   Telegram   │  │   Location   │      │
│  │  (Gmail)     │  │   Messages   │  │   (future)   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Processing Layer                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │              Cloudflare Workers (Edge)              │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐    │    │
│  │  │ Parser  │  │Splitter │  │ Card Strategy   │    │    │
│  │  │  (AI)   │  │  (Algo) │  │    Engine       │    │    │
│  │  └─────────┘  └─────────┘  └─────────────────┘    │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                            │
│  ┌──────────────────────────────────────────────────┐      │
│  │              Cloudflare D1 (SQLite)               │      │
│  │  users | projects | project_members | transactions│      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| AI | OpenAI GPT-4o-mini |
| Interface | Telegram Bot API |
| Language | TypeScript |
| Monorepo | pnpm workspaces |

## Project Structure

```
packages/
├── core/              # Shared business logic
│   ├── parser.ts      # AI transaction parsing
│   ├── splitter.ts    # Expense splitting & debt simplification
│   ├── strategy.ts    # Credit card optimization
│   └── types.ts       # TypeScript types
├── telegram-bot/      # Telegram bot worker
│   ├── src/index.ts   # Main handler
│   ├── schema.sql     # D1 schema
│   └── migrations/    # Database migrations
└── gmail-worker/      # Gmail webhook processor (WIP)
```

## Status

**MVP Complete** — Multi-project expense tracking with AI parsing

| Component | Status |
|-----------|--------|
| core (parser, splitter, strategy) | ✅ Deployed |
| telegram-bot | ✅ Deployed |
| gmail-worker | 🚧 WIP |

## License

MIT
