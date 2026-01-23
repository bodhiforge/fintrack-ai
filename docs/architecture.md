# Architecture

This document explains the technical architecture of FinTrack AI.

## System Overview

FinTrack AI is a **proactive** expense tracking system. Unlike traditional apps where users manually log expenses, FinTrack AI detects transactions automatically and asks users to confirm.

```
Traditional: User action → App records
FinTrack:    System detects → User confirms
```

## Components

### 1. Signal Layer

Multiple input sources feed into the system:

| Source | Method | Latency |
|--------|--------|---------|
| Bank Email Notifications | Gmail API / Email forwarding | ~1 min |
| Manual Input | Telegram messages | Real-time |
| Voice | Telegram voice messages + Whisper | ~2 sec |
| Photos | Receipt OCR (future) | ~3 sec |

### 2. Processing Layer (Cloudflare Workers)

All processing happens at the edge for minimal latency.

#### Transaction Parser (`@fintrack-ai/core/parser`)

Uses GPT-4o-mini to extract structured data:

```typescript
Input: "Your Amex Card ending 1234 was used for $45.67 at UBER EATS"

Output: {
  merchant: "Uber Eats",
  amount: 45.67,
  currency: "CAD",
  category: "dining",
  cardLastFour: "1234",
  date: "2026-01-15"
}
```

**Why GPT-4o-mini?**
- Cost: ~$0.15 per 1M tokens (essentially free for personal use)
- Speed: ~200ms response time
- Accuracy: 99%+ on structured bank emails

#### Card Strategy Engine (`@fintrack-ai/core/strategy`)

Checks if the card used was optimal:

```typescript
// Rules engine
if (merchant.includes('costco')) {
  if (card !== 'Mastercard') {
    return { isOptimal: false, reason: 'Costco only accepts MC' }
  }
}

if (category === 'dining' && card !== 'Amex Cobalt') {
  return { isOptimal: false, reason: 'Missing 5x points' }
}
```

#### Expense Splitter (`@fintrack-ai/core/splitter`)

Handles complex splitting scenarios:

```typescript
// Equal split
splitExpense({ total: 100, participants: ['A', 'B', 'C'] })
// → { A: 33.34, B: 33.33, C: 33.33 }

// With exclusion
splitExpense({
  total: 100,
  participants: ['A', 'B', 'C'],
  exclude: ['C']
})
// → { A: 50, B: 50 }
```

### 3. Interface Layer (Telegram Bot)

Telegram was chosen over a native app because:

1. **Zero friction**: No app install, cross-platform
2. **Inline keyboards**: One-tap confirmation
3. **Group support**: Multiple users in one chat for travel
4. **Bot API**: Well-documented, reliable

Message flow:
```
User sends expense → Bot parses → Bot replies with details + buttons
                                         ↓
                              [✓ Confirm] [👤 Personal] [✏️ Edit] [❌ Delete]
```

### 4. Storage Layer

#### Option A: Google Sheets (Current)
- Pros: Familiar, easy pivot tables, Gemini integration
- Cons: Concurrent write issues, no transactions

#### Option B: Cloudflare D1 (Future)
- Pros: SQLite at edge, zero cold start, transactions
- Cons: Requires migration, less familiar for analysis

## Debt Simplification Algorithm

At trip end, we minimize the number of transactions needed to settle.

### Problem

After a trip, the raw debt graph might look like:
```
Alice → Bob: $30
Bob → Carol: $25
Carol → Alice: $15
Alice → Carol: $10
```

This requires 4 transactions to settle.

### Solution: Net Balance + Greedy Matching

1. **Calculate net balances**:
   ```
   Alice: +30 -15 -10 = +5 (owed $5)
   Bob: -30 +25 = -5 (owes $5)
   Carol: -25 +15 +10 = 0 (settled)
   ```

2. **Match creditors and debtors**:
   ```
   Bob → Alice: $5
   ```

Result: **1 transaction** instead of 4.

### Implementation

```typescript
function simplifyDebts(transactions: Transaction[]): Settlement[] {
  // 1. Calculate net balance for each person
  const balances = calculateBalances(transactions);

  // 2. Separate into creditors (positive) and debtors (negative)
  const creditors = balances.filter(b => b.amount > 0);
  const debtors = balances.filter(b => b.amount < 0);

  // 3. Greedy matching: largest debtor pays largest creditor
  const settlements = [];
  while (creditors.length && debtors.length) {
    const amount = Math.min(creditors[0].amount, Math.abs(debtors[0].amount));
    settlements.push({ from: debtors[0], to: creditors[0], amount });
    // Update balances...
  }

  return settlements;
}
```

## Security Considerations

### API Keys
- Stored as Cloudflare Worker secrets (`wrangler secret put`)
- Never committed to git
- Rotated periodically

### Data Privacy
- Transaction data stays on Cloudflare edge (no central database)
- Optional Google Sheets sync is user-controlled
- No third-party analytics

### Telegram Security
- Webhook validated with secret token
- Bot only responds to authorized chat IDs

## Cost Analysis

| Service | Free Tier | Expected Usage | Cost |
|---------|-----------|----------------|------|
| Cloudflare Workers | 100k req/day | ~100 req/day | $0 |
| OpenAI GPT-4o-mini | N/A | ~3k tokens/day | ~$0.50/month |
| Telegram Bot API | Unlimited | N/A | $0 |
| **Total** | | | **~$0.50/month** |

## Future Enhancements

1. **Receipt OCR**: Photo → Transaction using GPT-4V
2. **Location awareness**: Auto-detect merchant via GPS
3. **Spending insights**: Monthly AI-generated reports
4. **Apple Shortcuts**: Siri integration for voice input
5. **Multi-currency**: Real-time exchange rates API
