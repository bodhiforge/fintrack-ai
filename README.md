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
| **AI Parsing** | ✅ | Natural language → structured transaction via GPT-4o-mini |
| **Multi-Project** | ✅ | Separate expenses by trip/event with invite codes |
| **Smart Splitting** | ✅ | "dinner 50, exclude Alice" → auto-split |
| **Multi-Currency** | ✅ | Per-project currency, grouped balance/settle |
| **Location Tracking** | ✅ | AI extracts location or uses project default |
| **Card Recommendation** | ✅ | Shows best card per transaction + relevant benefits |
| **Card Management** | ✅ | Add/remove cards, browse by category |
| **One-Tap Confirm** | ✅ | Telegram inline keyboards, not forms |
| **Transaction Edit** | ✅ | Edit amount, merchant, category, split inline |
| **Debt Simplification** | ✅ | Minimizes end-of-trip transactions |
| **Gmail Integration** | 🚧 | Auto-parse bank email notifications |
| **Card Referrals** | 🔜 | Recommend new cards with affiliate links |

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
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐    │    │
│  │  │ Parser  │  │Splitter │  │ Card Recommender│    │    │
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
│  │  users | projects | transactions | user_cards     │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
packages/
├── core/                     # Shared business logic
│   ├── parser.ts             # AI transaction parsing
│   ├── splitter.ts           # Expense splitting & debt simplification
│   ├── cards.ts              # Credit card data model & presets
│   ├── cardRecommender.ts    # Recommendation algorithm
│   ├── constants.ts          # Shared constants
│   └── types.ts              # TypeScript types
├── telegram-bot/             # Telegram bot worker
│   └── src/
│       ├── index.ts          # Entry point (HTTP routing)
│       ├── types.ts          # Telegram-specific types
│       ├── constants.ts      # Bot constants
│       ├── handlers/         # Request handlers
│       │   ├── commands/     # /menu, /balance, /cards, etc.
│       │   └── callbacks/    # Inline button handlers
│       ├── db/               # Database helpers
│       ├── telegram/         # Telegram API helpers
│       └── utils/            # Utilities (invite codes, location)
└── gmail-worker/             # Gmail webhook processor (WIP)
```

## Roadmap

- [x] **Phase 1: MVP** - AI parsing, splitting, multi-project
- [x] **Phase 2: Card Strategy** - Recommend best card, show benefits
- [x] **Phase 2.5: Code Quality** - Modular architecture, immutability
- [ ] **Phase 3: Card Referrals** - Suggest new cards with affiliate links
- [ ] **Phase 4: Gmail Integration** - Auto-parse bank emails
- [ ] **Phase 5: Benefit Reminders** - Monthly perk notifications

## Recent Commits

| Commit | Description |
|--------|-------------|
| `1301612` | refactor: full codebase cleanup per Hawking standards |
| `a8720aa` | feat: add Telegram location sharing support |
| `81b4d16` | feat: add location-based foreign currency detection |
| `c42c1ea` | fix: P0/P1 issues - Costco detection, remove old strategy |
| `a008f45` | feat: add credit card recommendation system |

## License

MIT
