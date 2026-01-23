# FinTrack AI - Claude Code Instructions

## Project Overview
AI-powered expense tracking bot for Telegram, built with Cloudflare Workers and D1.

## Tech Stack
- **Runtime**: Cloudflare Workers (Edge)
- **Database**: Cloudflare D1 (SQLite)
- **Language**: TypeScript
- **AI**: OpenAI GPT-4o-mini
- **Interface**: Telegram Bot API
- **Monorepo**: pnpm workspaces

## Package Structure
```
packages/
├── core/           # Shared business logic (parser, splitter, strategy)
├── telegram-bot/   # Telegram bot worker
└── gmail-worker/   # Gmail webhook processor (WIP)
```

## Development Commands
```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run telegram-bot locally
cd packages/telegram-bot && pnpm dev

# Deploy telegram-bot
cd packages/telegram-bot && npx wrangler deploy

# Run D1 migrations
cd packages/telegram-bot && npx wrangler d1 execute fintrack-db --file=migrations/XXX.sql --remote
```

## Git Commit Rules
- **DO NOT** include `Co-Authored-By: Claude` lines
- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Keep commits atomic and focused

## Code Style
- Use TypeScript strict mode
- Prefer `const` over `let`
- Use async/await, not callbacks
- Handle errors gracefully with try/catch

## Database Schema
Main tables:
- `users` - Telegram users
- `projects` - Expense tracking projects
- `project_members` - Project membership
- `transactions` - Expense records

## Environment Variables
Required secrets (set via `wrangler secret put`):
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`

## Testing
- Send messages to @AIFinTrack_Bot
- Use `/debug` endpoint to test worker health
- Check D1 data: `npx wrangler d1 execute fintrack-db --remote --command="SELECT * FROM transactions"`

## Known Limitations
- Voice messages not supported yet
- Photo/receipt OCR not implemented
- Gmail worker not deployed
