# FinTrack AI

> Proactive expense tracking powered by AI.
> Don't log expenses — let AI detect and confirm them for you.

![Demo](demo/demo.gif)

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
You: "dinner 50 USD, Alice didn't join"
AI: "Got it. $50 split between you, Partner, Bob. Alice excluded. ✓ Confirm?"
```

## Features

| Feature | Description |
|---------|-------------|
| **Proactive Detection** | Monitors bank email notifications automatically |
| **AI Parsing** | Extracts merchant, amount, category via GPT-4o-mini |
| **Card Strategy Audit** | Alerts when you miss credit card rewards |
| **Multi-currency** | Auto-converts based on real-time rates |
| **Smart Splitting** | Natural language AA for group trips |
| **One-tap Confirm** | Telegram inline keyboards, not forms |
| **Debt Simplification** | Minimizes end-of-trip transactions |

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
│                    Interface Layer                          │
│  ┌──────────────────────────────────────────────────┐      │
│  │           Telegram Bot (Inline Keyboards)         │      │
│  │     [✓ Confirm] [👤 Personal] [✏️ Edit] [❌ Del]   │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                            │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │ Cloudflare   │  │    Google    │                        │
│  │  D1 (SQLite) │  │   Sheets     │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| Runtime | Cloudflare Workers | Edge deployment, <50ms latency, generous free tier |
| Language | TypeScript | Type safety, better DX |
| AI | OpenAI GPT-4o-mini | Fast, cheap ($0.15/1M tokens), accurate |
| Interface | Telegram Bot API | Cross-platform, no app install, inline keyboards |
| Storage | Cloudflare D1 | SQLite at edge, zero cold start |
| Monorepo | pnpm workspaces | Clean package separation |

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Cloudflare account (free tier)
- Telegram Bot Token (via @BotFather)
- OpenAI API Key

### Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/fintrack-ai.git
cd fintrack-ai

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys

# Run locally
pnpm dev
```

### Deploy to Cloudflare

```bash
# Login to Cloudflare
npx wrangler login

# Deploy
pnpm deploy
```

## Configuration

### Environment Variables

```env
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=123456789:ABC...
TELEGRAM_CHAT_ID=your_chat_id

# Optional: Google Sheets integration
GOOGLE_SHEETS_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

### Credit Card Strategy

Edit `packages/core/src/strategy.ts` to customize for your cards:

```typescript
export const CARD_STRATEGIES: CardStrategy[] = [
  {
    cardName: 'Amex Cobalt',
    lastFourDigits: '1234',
    bestFor: ['dining', 'grocery', 'streaming'],
    multiplier: '5x MR points',
    notes: '2.5% FX fee on foreign transactions'
  },
  {
    cardName: 'Rogers World Elite MC',
    lastFourDigits: '5678',
    bestFor: ['costco', 'foreign', 'usd'],
    multiplier: '1.5% cashback (foreign), 1% (domestic)',
    notes: 'No FX fee, Costco exclusive'
  }
];
```

## Splitting Algorithm

The debt simplification algorithm minimizes the number of transactions needed to settle:

**Before simplification:**
```
Alice → Bob: $30
Bob → Carol: $30
Carol → Alice: $10
```

**After simplification:**
```
Alice → Bob: $10
Alice → Carol: $10
```

See [docs/architecture.md](docs/architecture.md) for the algorithm explanation.

## Project Structure

```
fintrack-ai/
├── packages/
│   ├── core/              # Shared business logic
│   │   ├── src/
│   │   │   ├── parser.ts      # AI transaction parsing
│   │   │   ├── splitter.ts    # Expense splitting logic
│   │   │   ├── strategy.ts    # Credit card optimization
│   │   │   └── types.ts       # TypeScript types
│   │   └── tests/
│   ├── telegram-bot/      # Telegram bot worker
│   └── gmail-worker/      # Gmail webhook processor
├── docs/
│   ├── architecture.md
│   └── card-strategies.md
└── demo/
    └── screenshots/
```

## Roadmap

- [x] Core parsing logic
- [x] Credit card strategy engine
- [ ] Telegram bot integration
- [ ] Gmail webhook integration
- [ ] Multi-currency with live rates
- [ ] Apple Shortcuts integration
- [ ] Receipt OCR (photo → transaction)
- [ ] Location-based merchant detection
- [ ] Monthly spending reports via AI

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT - see [LICENSE](LICENSE)

---

Built with TypeScript, Cloudflare Workers, and GPT-4o-mini.
