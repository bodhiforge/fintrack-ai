# Credit Card Strategy Guide

This document explains the card optimization logic in FinTrack AI, specifically for Canadian credit card users.

## Philosophy

The goal is **not** to maximize every single purchase, but to:

1. Never miss obvious high-value opportunities (5x dining on Cobalt)
2. Avoid impossible mistakes (Amex at Costco)
3. Minimize foreign transaction fees

## Canadian Card Meta (2026)

### Tier 1: Daily Drivers

| Card | Best For | Multiplier | FX Fee | Annual Fee |
|------|----------|------------|--------|------------|
| **Amex Cobalt** | Dining, Grocery, Streaming | 5x MR | 2.5% | $156 |
| **Rogers WE MC** | Costco, Foreign, USD | 1.5% CB (foreign) | 0% | $0 |

### Tier 2: Specialized

| Card | Best For | Multiplier | FX Fee | Annual Fee |
|------|----------|------------|--------|------------|
| TD Cash Back Visa | Gas | 3% | 2.5% | $0 |
| CIBC Dividend | Drug stores | 4% | 2.5% | $0 |
| Tangerine MC | 3 categories | 2% | 0% | $0 |

## Decision Tree

```
Is it Costco?
├── Yes → Rogers WE MC (Costco only accepts MC)
└── No
    └── Is it foreign currency (USD, etc)?
        ├── Yes → Rogers WE MC (no FX fee)
        └── No
            └── Is it Dining/Grocery/Streaming?
                ├── Yes → Amex Cobalt (5x points)
                └── No
                    └── Is it Gas?
                        ├── Yes → TD Cash Back (3%)
                        └── No → Any card (1-1.5%)
```

## Implementation

The strategy engine is configured in `packages/core/src/strategy.ts`:

```typescript
const CARD_STRATEGIES: CardStrategy[] = [
  {
    cardName: 'Amex Cobalt',
    lastFourDigits: '1234',  // Update with your actual card
    bestFor: ['dining', 'grocery', 'streaming'],
    multiplier: '5x MR points',
    foreignTxFee: 2.5,
  },
  {
    cardName: 'Rogers World Elite MC',
    lastFourDigits: '5678',
    bestFor: ['costco', 'foreign'],
    multiplier: '1.5% cashback',
    foreignTxFee: 0,
  },
];
```

## Special Rules

### Costco Canada

Costco Canada **only accepts Mastercard** for credit cards (or debit/cash).

If FinTrack detects an Amex transaction at Costco, it flags this as an error:
- Either the transaction failed and user needs to re-pay
- Or it was Costco.com (which accepts more cards)

### Foreign Transactions

For any non-CAD transaction, the FX fee often matters more than rewards:

| Scenario | Amex Cobalt | Rogers WE MC | Winner |
|----------|-------------|--------------|--------|
| $100 USD dining | 5x MR - 2.5% = net ~2.5% | 1.5% + 0% = 1.5% | Cobalt (if you value MR) |
| $100 USD shopping | 1x MR - 2.5% = net -1.5% | 1.5% + 0% = 1.5% | Rogers |

For simplicity, FinTrack recommends Rogers WE for all foreign transactions unless it's a 5x Cobalt category.

### Streaming Services

Netflix, Spotify, Disney+, etc. code as "streaming" and earn 5x on Cobalt. Make sure these recurring charges are on Cobalt.

## Point Valuations

FinTrack doesn't currently calculate point values, but here are reference valuations:

| Program | Conservative | Optimal |
|---------|--------------|---------|
| Amex MR | 1.5 cpp | 2.0 cpp |
| Aeroplan | 1.5 cpp | 2.5 cpp |
| Cash back | 1.0 cpp | 1.0 cpp |

*cpp = cents per point*

## Customization

To add your own cards, edit the strategy file:

```typescript
engine.addCard({
  cardName: 'My New Card',
  lastFourDigits: '9999',
  bestFor: ['travel', 'hotels'],
  multiplier: '3x points',
  foreignTxFee: 0,
});
```

## Common Mistakes to Avoid

1. **Using Amex at Costco** - Won't work, embarrassing at checkout
2. **Using high-FX card abroad** - 2.5% on every purchase adds up
3. **Missing 5x categories** - Dining on a 1% card is leaving money on table
4. **Forgetting streaming subscriptions** - Set these up on Cobalt once
