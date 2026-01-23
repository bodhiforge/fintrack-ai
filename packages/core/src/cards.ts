/**
 * Credit Card Data Model and Preset Cards
 * Phase 1-2 of Card Strategy Implementation
 */

import type { Category } from './types';

// ============================================
// Types
// ============================================

export type CardNetwork = 'visa' | 'mastercard' | 'amex';
export type RewardType = 'points' | 'cashback' | 'miles';
export type BenefitType = 'insurance' | 'lounge' | 'credit' | 'warranty' | 'perk';

export interface RewardRule {
  category: Category | 'foreign' | 'all';
  multiplier: number;              // 5 = 5x points or 5% cashback
  rewardType: RewardType;
  pointValue?: number;             // CAD per point (for calculating actual value)
  maxSpend?: number;               // Monthly cap for this multiplier
  conditions?: string;             // e.g., "Canada only"
}

export interface CardBenefit {
  type: BenefitType;
  name: string;
  description: string;
  triggerCategories?: Category[];  // Which spending triggers this
  triggerAmount?: number;          // Minimum spend to activate
  conditions?: string;
  claimUrl?: string;
}

export interface CreditCard {
  id: string;
  name: string;
  issuer: string;
  network: CardNetwork;
  annualFee: number;               // CAD
  monthlyFee?: number;             // If billed monthly (e.g., Cobalt $12.99)
  ftf: number;                     // Foreign transaction fee %

  rewards: RewardRule[];
  benefits: CardBenefit[];

  // Affiliate/referral
  referralUrl?: string;
  referralBonus?: string;

  // For matching transactions
  merchantPatterns?: string[];     // e.g., ["costco", "wholesale"]
}

export interface UserCard {
  id: string;
  odId: number;
  cardId: string;                  // References CreditCard.id
  lastFour?: string;
  nickname?: string;
  isActive: boolean;
  addedAt: string;
}

export interface CardRecommendation {
  card: CreditCard;
  userCard?: UserCard;
  isOptimal: boolean;
  reward: string;                  // "150 points" or "$3.00 cashback"
  rewardValue: number;             // CAD value
  extraReward?: string;            // If not optimal, what they're missing
  extraRewardValue?: number;
  relevantBenefits: CardBenefit[];
  warning?: string;                // e.g., "Costco only accepts Mastercard/Visa"
}

// ============================================
// Preset Cards - Canada Top Cards
// ============================================

export const PRESET_CARDS: CreditCard[] = [
  // === AMEX ===
  {
    id: 'amex-cobalt',
    name: 'Amex Cobalt',
    issuer: 'American Express',
    network: 'amex',
    annualFee: 156,
    monthlyFee: 12.99,
    ftf: 2.5,
    rewards: [
      { category: 'dining', multiplier: 5, rewardType: 'points', pointValue: 0.02 },
      { category: 'grocery', multiplier: 5, rewardType: 'points', pointValue: 0.02 },
      { category: 'entertainment', multiplier: 3, rewardType: 'points', pointValue: 0.02 },
      { category: 'travel', multiplier: 2, rewardType: 'points', pointValue: 0.02 },
      { category: 'all', multiplier: 1, rewardType: 'points', pointValue: 0.02 },
    ],
    benefits: [
      {
        type: 'credit',
        name: 'Monthly Uber Credit',
        description: '$5 Uber or Uber Eats credit monthly',
        conditions: 'Auto-credited to linked Uber account',
      },
      {
        type: 'insurance',
        name: 'Mobile Device Insurance',
        description: 'Up to $1,000 coverage for phone damage/theft',
        conditions: 'Pay phone bill with this card',
      },
    ],
    referralUrl: 'https://americanexpress.com/refer',
    referralBonus: '2,500 bonus points + first year waived',
    merchantPatterns: ['uber', 'ubereats', 'doordash', 'skip'],
  },
  {
    id: 'amex-gold',
    name: 'Amex Gold Rewards',
    issuer: 'American Express',
    network: 'amex',
    annualFee: 250,
    ftf: 2.5,
    rewards: [
      { category: 'travel', multiplier: 2, rewardType: 'points', pointValue: 0.02 },
      { category: 'gas', multiplier: 2, rewardType: 'points', pointValue: 0.02 },
      { category: 'grocery', multiplier: 2, rewardType: 'points', pointValue: 0.02 },
      { category: 'all', multiplier: 1, rewardType: 'points', pointValue: 0.02 },
    ],
    benefits: [
      {
        type: 'lounge',
        name: 'Plaza Premium Lounge',
        description: '4 free visits per year',
        triggerCategories: ['travel'],
      },
      {
        type: 'insurance',
        name: 'Travel Accident Insurance',
        description: 'Up to $500,000 coverage',
        triggerCategories: ['travel'],
        conditions: 'Book travel with this card',
      },
      {
        type: 'insurance',
        name: 'Flight Delay Insurance',
        description: '$500 for 6+ hour delays',
        triggerCategories: ['travel'],
        conditions: 'Book flight with this card',
      },
      {
        type: 'insurance',
        name: 'Lost Baggage Insurance',
        description: 'Up to $1,000 coverage',
        triggerCategories: ['travel'],
      },
    ],
    referralBonus: '40,000 welcome points',
  },

  // === NO FX FEE CARDS ===
  {
    id: 'rogers-we-mc',
    name: 'Rogers World Elite MC',
    issuer: 'Rogers Bank',
    network: 'mastercard',
    annualFee: 0,
    ftf: 0,
    rewards: [
      { category: 'foreign', multiplier: 4, rewardType: 'cashback' },
      { category: 'all', multiplier: 1.5, rewardType: 'cashback' },
    ],
    benefits: [
      {
        type: 'perk',
        name: 'No Foreign Transaction Fee',
        description: 'Save 2.5% on all foreign purchases',
      },
      {
        type: 'insurance',
        name: 'Mobile Device Insurance',
        description: 'Up to $1,000 coverage',
        conditions: 'Pay phone bill with this card',
      },
    ],
    referralBonus: '$50 statement credit',
    merchantPatterns: ['costco'],
  },
  {
    id: 'hsbc-we-mc',
    name: 'HSBC World Elite MC',
    issuer: 'HSBC',
    network: 'mastercard',
    annualFee: 149,
    ftf: 0,
    rewards: [
      { category: 'travel', multiplier: 6, rewardType: 'points', pointValue: 0.01 },
      { category: 'all', multiplier: 3, rewardType: 'points', pointValue: 0.01 },
    ],
    benefits: [
      {
        type: 'perk',
        name: 'No Foreign Transaction Fee',
        description: 'Save 2.5% on all foreign purchases',
      },
      {
        type: 'lounge',
        name: 'Boingo Wi-Fi',
        description: 'Free airport Wi-Fi worldwide',
      },
    ],
  },

  // === AEROPLAN ===
  {
    id: 'td-aeroplan-vi',
    name: 'TD Aeroplan Visa Infinite',
    issuer: 'TD',
    network: 'visa',
    annualFee: 139,
    ftf: 2.5,
    rewards: [
      { category: 'travel', multiplier: 3, rewardType: 'miles' },
      { category: 'all', multiplier: 1, rewardType: 'miles' },
    ],
    benefits: [
      {
        type: 'perk',
        name: 'First Checked Bag Free',
        description: 'Free first bag on Air Canada',
        triggerCategories: ['travel'],
        conditions: 'Book with Aeroplan number',
      },
      {
        type: 'insurance',
        name: 'Flight Delay Insurance',
        description: '$500 for 4+ hour delays',
        triggerCategories: ['travel'],
        conditions: 'Book flight with this card',
      },
      {
        type: 'insurance',
        name: 'Trip Cancellation Insurance',
        description: 'Up to $1,500 per trip',
        triggerCategories: ['travel'],
      },
      {
        type: 'insurance',
        name: 'Travel Medical Insurance',
        description: '$1M coverage for 21 days',
        triggerCategories: ['travel'],
      },
    ],
    referralBonus: '20,000 Aeroplan points',
    merchantPatterns: ['air canada', 'aeroplan'],
  },

  // === NO FEE CARDS ===
  {
    id: 'tangerine-mc',
    name: 'Tangerine Money-Back MC',
    issuer: 'Tangerine',
    network: 'mastercard',
    annualFee: 0,
    ftf: 2.5,
    rewards: [
      { category: 'dining', multiplier: 2, rewardType: 'cashback', conditions: 'If selected as category' },
      { category: 'grocery', multiplier: 2, rewardType: 'cashback', conditions: 'If selected as category' },
      { category: 'gas', multiplier: 2, rewardType: 'cashback', conditions: 'If selected as category' },
      { category: 'all', multiplier: 0.5, rewardType: 'cashback' },
    ],
    benefits: [
      {
        type: 'perk',
        name: 'Choose 2-3 Categories',
        description: '2% back on up to 3 selected categories',
      },
    ],
  },
  {
    id: 'pc-financial-mc',
    name: 'PC Financial MC',
    issuer: 'PC Financial',
    network: 'mastercard',
    annualFee: 0,
    ftf: 2.5,
    rewards: [
      { category: 'grocery', multiplier: 3, rewardType: 'points', pointValue: 0.01, conditions: 'At Loblaw stores' },
      { category: 'all', multiplier: 1, rewardType: 'points', pointValue: 0.01 },
    ],
    benefits: [],
    merchantPatterns: ['loblaws', 'no frills', 'superstore', 'shoppers'],
  },

  // === PREMIUM CARDS ===
  {
    id: 'scotiabank-gold-amex',
    name: 'Scotiabank Gold Amex',
    issuer: 'Scotiabank',
    network: 'amex',
    annualFee: 150,
    ftf: 2.5,
    rewards: [
      { category: 'dining', multiplier: 5, rewardType: 'points', pointValue: 0.01 },
      { category: 'grocery', multiplier: 5, rewardType: 'points', pointValue: 0.01 },
      { category: 'entertainment', multiplier: 3, rewardType: 'points', pointValue: 0.01 },
      { category: 'all', multiplier: 1, rewardType: 'points', pointValue: 0.01 },
    ],
    benefits: [
      {
        type: 'perk',
        name: 'Scene+ Points',
        description: 'Redeem at Cineplex, Sobeys, and more',
      },
    ],
  },
  {
    id: 'bmo-eclipse-vi',
    name: 'BMO Eclipse Visa Infinite',
    issuer: 'BMO',
    network: 'visa',
    annualFee: 199,
    ftf: 2.5,
    rewards: [
      { category: 'dining', multiplier: 5, rewardType: 'points', pointValue: 0.007 },
      { category: 'all', multiplier: 1, rewardType: 'points', pointValue: 0.007 },
    ],
    benefits: [
      {
        type: 'insurance',
        name: 'Mobile Device Insurance',
        description: 'Up to $1,500 coverage',
        conditions: 'Pay phone bill with this card',
      },
      {
        type: 'lounge',
        name: 'Airport Lounge Access',
        description: '4 complimentary visits per year',
        triggerCategories: ['travel'],
      },
    ],
  },
];

// ============================================
// Helper Functions
// ============================================

export function getCardById(cardId: string): CreditCard | undefined {
  return PRESET_CARDS.find(c => c.id === cardId);
}

export function getCardsByCategory(category: Category): CreditCard[] {
  return PRESET_CARDS
    .filter(card => card.rewards.some(r => r.category === category || r.category === 'all'))
    .sort((a, b) => {
      const aMultiplier = a.rewards.find(r => r.category === category)?.multiplier ??
                          a.rewards.find(r => r.category === 'all')?.multiplier ?? 0;
      const bMultiplier = b.rewards.find(r => r.category === category)?.multiplier ??
                          b.rewards.find(r => r.category === 'all')?.multiplier ?? 0;
      return bMultiplier - aMultiplier;
    });
}

export function getNoFxFeeCards(): CreditCard[] {
  return PRESET_CARDS.filter(c => c.ftf === 0);
}

export function formatReward(amount: number, rule: RewardRule): string {
  const reward = amount * rule.multiplier;
  switch (rule.rewardType) {
    case 'cashback':
      return `$${(reward / 100).toFixed(2)} cashback`;
    case 'miles':
      return `${Math.round(reward)} miles`;
    case 'points':
    default:
      const value = rule.pointValue ? ` (~$${(reward * rule.pointValue).toFixed(2)})` : '';
      return `${Math.round(reward)} pts${value}`;
  }
}

export function calculateRewardValue(amount: number, rule: RewardRule): number {
  const reward = amount * rule.multiplier;
  switch (rule.rewardType) {
    case 'cashback':
      return reward / 100;
    case 'miles':
    case 'points':
      return reward * (rule.pointValue ?? 0.01);
    default:
      return 0;
  }
}

export function benefitEmoji(type: BenefitType): string {
  switch (type) {
    case 'insurance': return '🛡️';
    case 'lounge': return '✈️';
    case 'credit': return '💵';
    case 'warranty': return '🔧';
    case 'perk': return '🎁';
    default: return '•';
  }
}
