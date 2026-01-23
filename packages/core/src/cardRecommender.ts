/**
 * Card Recommendation Engine
 * Phase 3-4: Recommend optimal card for each transaction
 */

import type { Category, Currency, ParsedTransaction } from './types';
import {
  type CreditCard,
  type UserCard,
  type CardRecommendation,
  type CardBenefit,
  type RewardRule,
  PRESET_CARDS,
  getCardById,
  formatReward,
  calculateRewardValue,
} from './cards';

// ============================================
// Types
// ============================================

export interface UserCardWithDetails extends UserCard {
  readonly card: CreditCard;
}

export interface RecommendationResult {
  readonly best: CardRecommendation;
  readonly alternatives: readonly CardRecommendation[];
  readonly missingCardSuggestion?: CardSuggestion;
}

export interface CardSuggestion {
  readonly card: CreditCard;
  readonly reason: string;
  readonly potentialSavings: string;
}

// ============================================
// Location-based Currency Detection
// ============================================

const LOCATION_CURRENCY: Record<string, string> = {
  // Japan
  'tokyo': 'JPY', 'osaka': 'JPY', 'kyoto': 'JPY', 'japan': 'JPY', '东京': 'JPY', '日本': 'JPY',
  // USA
  'new york': 'USD', 'nyc': 'USD', 'los angeles': 'USD', 'la': 'USD', 'usa': 'USD', 'seattle': 'USD',
  'san francisco': 'USD', 'sf': 'USD', 'vegas': 'USD', 'las vegas': 'USD', 'hawaii': 'USD',
  // Europe
  'london': 'GBP', 'uk': 'GBP', 'england': 'GBP',
  'paris': 'EUR', 'france': 'EUR', 'germany': 'EUR', 'berlin': 'EUR', 'italy': 'EUR', 'rome': 'EUR',
  'spain': 'EUR', 'barcelona': 'EUR', 'amsterdam': 'EUR', 'netherlands': 'EUR',
  // Mexico / Central America
  'mexico': 'MXN', 'cancun': 'MXN', 'mexico city': 'MXN',
  'costa rica': 'CRC', 'san jose': 'CRC',
  // Asia
  'hong kong': 'HKD', 'hk': 'HKD', '香港': 'HKD',
  'singapore': 'SGD', '新加坡': 'SGD',
  'korea': 'KRW', 'seoul': 'KRW', '韩国': 'KRW',
  'thailand': 'THB', 'bangkok': 'THB',
};

export function detectForeignByLocation(location: string | undefined, currency: string): {
  readonly isForeign: boolean;
  readonly warning?: string;
} {
  if (location == null || location === '') return { isForeign: currency !== 'CAD' };

  const normalizedLocation = location.toLowerCase().trim();
  const expectedCurrency = LOCATION_CURRENCY[normalizedLocation];

  // If location suggests a foreign country but currency is CAD
  if (expectedCurrency && expectedCurrency !== 'CAD' && currency === 'CAD') {
    return {
      isForeign: true,
      warning: `${location} usually uses ${expectedCurrency}, treating as foreign`,
    };
  }

  return { isForeign: currency !== 'CAD' };
}

// ============================================
// Merchant Restriction Detection
// ============================================

interface MerchantRestriction {
  readonly pattern: RegExp;
  readonly allowedNetworks: readonly string[];
  readonly reason: string;
}

const MERCHANT_RESTRICTIONS: readonly MerchantRestriction[] = [
  {
    pattern: /costco|wholesale/i,
    allowedNetworks: ['mastercard', 'visa'],  // Costco doesn't accept Amex
    reason: 'Costco only accepts Mastercard/Visa',
  },
];

function checkMerchantRestrictions(merchant: string): MerchantRestriction | undefined {
  return MERCHANT_RESTRICTIONS.find(restriction => restriction.pattern.test(merchant));
}

// ============================================
// Main Recommendation Function
// ============================================

export function recommendCard(
  transaction: ParsedTransaction,
  userCards: readonly UserCardWithDetails[],
  isForeign: boolean = false
): RecommendationResult {
  if (userCards.length === 0) {
    // No cards - suggest getting one
    const suggestedCard = suggestCardForCategory(transaction.category);
    return {
      best: createEmptyRecommendation(),
      alternatives: [],
      missingCardSuggestion: suggestedCard,
    };
  }

  // Check for merchant restrictions (e.g., Costco doesn't accept Amex)
  const restriction = checkMerchantRestrictions(transaction.merchant);
  const cardsWithDetails = userCards.filter(userCard => userCard.card != null);

  const { eligibleCards, restrictionWarning } = restriction != null
    ? applyMerchantRestriction(cardsWithDetails, restriction)
    : { eligibleCards: cardsWithDetails, restrictionWarning: undefined };

  // Calculate reward for each eligible card
  const recommendations = eligibleCards
    .map(userCard => calculateRecommendation(transaction, userCard, isForeign))
    .sort((cardA, cardB) => cardB.rewardValue - cardA.rewardValue);

  if (recommendations.length === 0) {
    // All cards filtered out by restriction
    return {
      best: { ...createEmptyRecommendation(), warning: restriction?.reason },
      alternatives: [],
      missingCardSuggestion: suggestCardForMerchant(transaction.merchant),
    };
  }

  const [firstRecommendation, ...restRecommendations] = recommendations;
  const alternatives = restRecommendations.slice(0, 2);

  // Check if best is actually optimal
  const isOptimal = alternatives.length === 0 ||
    (firstRecommendation.rewardValue - alternatives[0].rewardValue) >= 0.01;

  const best: CardRecommendation = {
    ...firstRecommendation,
    isOptimal,
    warning: restrictionWarning,
  };

  // Check if user is missing a better card for this category
  const missingCardSuggestion = checkMissingCard(transaction, userCards, best, restriction);

  return {
    best,
    alternatives,
    missingCardSuggestion,
  };
}

function applyMerchantRestriction(
  cards: readonly UserCardWithDetails[],
  restriction: MerchantRestriction
): { eligibleCards: readonly UserCardWithDetails[]; restrictionWarning: string | undefined } {
  const filtered = cards.filter(userCard =>
    restriction.allowedNetworks.includes(userCard.card.network)
  );
  return filtered.length > 0
    ? { eligibleCards: filtered, restrictionWarning: restriction.reason }
    : { eligibleCards: cards, restrictionWarning: undefined };
}

// ============================================
// Calculation Functions
// ============================================

function calculateRecommendation(
  transaction: ParsedTransaction,
  userCard: UserCardWithDetails,
  isForeign: boolean
): CardRecommendation {
  const card = userCard.card;
  const amount = transaction.amount;
  const category = transaction.category;

  // Find the best matching reward rule
  const bestRule = findBestRewardRule(card.rewards, category, isForeign);

  // Calculate reward
  const reward = bestRule != null ? formatReward(amount, bestRule) : 'No rewards';
  const rewardValue = bestRule != null ? calculateRewardValue(amount, bestRule) : 0;

  // Adjust for FX fee if foreign
  const fxFeeDeduction = isForeign && card.ftf > 0 ? amount * (card.ftf / 100) : 0;
  const adjustedRewardValue = rewardValue - fxFeeDeduction;

  // Get relevant benefits
  const relevantBenefits = getRelevantBenefits(transaction, card);

  return {
    card,
    userCard,
    isOptimal: true, // Will be adjusted after comparison
    reward,
    rewardValue: adjustedRewardValue,
    relevantBenefits,
  };
}

function findBestRewardRule(
  rewards: readonly RewardRule[],
  category: Category,
  isForeign: boolean
): RewardRule | undefined {
  // Check for foreign transaction rule first
  if (isForeign) {
    const foreignRule = rewards.find(rule => rule.category === 'foreign');
    if (foreignRule != null) return foreignRule;
  }

  // Check category-specific rule
  const categoryRule = rewards.find(rule => rule.category === category);
  if (categoryRule != null) return categoryRule;

  // Fall back to 'all' rule
  return rewards.find(rule => rule.category === 'all');
}

function getRelevantBenefits(
  transaction: ParsedTransaction,
  card: CreditCard
): CardBenefit[] {
  return card.benefits.filter(benefit => {
    // Check if this benefit applies to the transaction category
    if (benefit.triggerCategories) {
      if (!benefit.triggerCategories.includes(transaction.category)) {
        return false;
      }
    }

    // Check minimum amount trigger
    if (benefit.triggerAmount && transaction.amount < benefit.triggerAmount) {
      return false;
    }

    return true;
  });
}

// ============================================
// Missing Card Suggestions
// ============================================

function checkMissingCard(
  transaction: ParsedTransaction,
  userCards: readonly UserCardWithDetails[],
  currentBest: CardRecommendation,
  restriction?: { readonly allowedNetworks: readonly string[] }
): CardSuggestion | undefined {
  const category = transaction.category;
  const userCardIds = new Set(userCards.map(userCard => userCard.cardId));

  // Find the best card for this category that user doesn't have
  // Respect merchant restrictions
  const bestAvailable = PRESET_CARDS
    .filter(card => !userCardIds.has(card.id))
    .filter(card => restriction == null || restriction.allowedNetworks.includes(card.network))
    .map(card => {
      const rule = card.rewards.find(rewardRule => rewardRule.category === category) ??
                   card.rewards.find(rewardRule => rewardRule.category === 'all');
      const value = rule != null ? calculateRewardValue(transaction.amount, rule) : 0;
      return { card, value, rule };
    })
    .sort((cardA, cardB) => cardB.value - cardA.value)[0];

  if (bestAvailable == null || bestAvailable.rule == null) return undefined;

  // Only suggest if significantly better (>50% more rewards)
  const improvement = bestAvailable.value - currentBest.rewardValue;
  if (improvement < currentBest.rewardValue * 0.5) return undefined;

  const monthlyExtra = improvement * 10; // Assume ~10 similar transactions/month

  return {
    card: bestAvailable.card,
    reason: getCategorySuggestionReason(category),
    potentialSavings: `~$${monthlyExtra.toFixed(0)}/month extra rewards`,
  };
}

function suggestCardForMerchant(merchant: string): CardSuggestion | undefined {
  // Suggest cards based on merchant
  if (/costco|wholesale/i.test(merchant)) {
    return {
      card: getCardById('rogers-we-mc') ?? PRESET_CARDS[0],
      reason: 'Costco only accepts Mastercard. Rogers WE MC is best for Costco.',
      potentialSavings: '1.5% cashback + No FX fee',
    };
  }
  return undefined;
}

function suggestCardForCategory(category: Category): CardSuggestion {
  // Default suggestions by category
  const suggestions: Partial<Record<Category, string>> = {
    dining: 'amex-cobalt',
    grocery: 'amex-cobalt',
    gas: 'tangerine-mc',
    travel: 'td-aeroplan-vi',
    entertainment: 'amex-cobalt',
  };

  const cardId = suggestions[category] ?? 'rogers-we-mc';
  const card = getCardById(cardId) ?? PRESET_CARDS[0];

  return {
    card,
    reason: getCategorySuggestionReason(category),
    potentialSavings: 'Start earning rewards on every purchase',
  };
}

function getCategorySuggestionReason(category: Category): string {
  switch (category) {
    case 'dining':
      return 'You spend on dining often. Get 5x points with Amex Cobalt.';
    case 'grocery':
      return 'Maximize grocery rewards with 5x points cards.';
    case 'gas':
      return 'Earn 2% cashback on gas with no annual fee.';
    case 'travel':
      return 'Get travel insurance + miles on flight bookings.';
    case 'entertainment':
      return 'Earn 3x points on streaming & entertainment.';
    default:
      return 'Earn rewards on all your purchases.';
  }
}

function createEmptyRecommendation(): CardRecommendation {
  return {
    card: PRESET_CARDS[0],
    isOptimal: false,
    reward: 'Add a card to see rewards',
    rewardValue: 0,
    relevantBenefits: [],
  };
}

// ============================================
// Formatting Helpers
// ============================================

export function formatRecommendation(recommendation: CardRecommendation): string {
  const warningLine = recommendation.warning != null
    ? [`⚠️ _${recommendation.warning}_\n`]
    : [];

  const cardLines = recommendation.isOptimal
    ? [
        `✅ *Use ${recommendation.card.name}*`,
        `💰 Earn ${recommendation.reward}`,
      ]
    : [
        `⚠️ *Consider ${recommendation.card.name}*`,
        `💰 Could earn ${recommendation.reward}`,
      ];

  return [...warningLine, ...cardLines].join('\n');
}

export function formatBenefits(benefits: readonly CardBenefit[]): string {
  if (benefits.length === 0) return '';

  const benefitLines = benefits.flatMap(benefit => {
    const emoji = benefit.type === 'insurance' ? '🛡️' :
                  benefit.type === 'lounge' ? '✈️' :
                  benefit.type === 'credit' ? '💵' : '🎁';
    const mainLine = `  ${emoji} ${benefit.name}`;
    const conditionLine = benefit.conditions != null
      ? [`     _${benefit.conditions}_`]
      : [];
    return [mainLine, ...conditionLine];
  });

  return [
    '',
    '🎁 *Benefits with this card:*',
    ...benefitLines,
  ].join('\n');
}

export function formatCardSuggestion(suggestion: CardSuggestion): string {
  const topBenefits = suggestion.card.benefits.slice(0, 2);
  const benefitLines = topBenefits.map(benefit => `• ${benefit.name}`);

  const referralSection = suggestion.card.referralUrl != null
    ? [
        '',
        suggestion.card.referralBonus != null
          ? `👉 [Apply now](${suggestion.card.referralUrl}) - ${suggestion.card.referralBonus}`
          : `👉 [Apply now](${suggestion.card.referralUrl})`,
        '_This may include a referral bonus_',
      ]
    : [];

  return [
    '',
    `💡 *${suggestion.reason}*`,
    '',
    `Recommended: *${suggestion.card.name}*`,
    ...benefitLines,
    '',
    suggestion.potentialSavings,
    ...referralSection,
  ].join('\n');
}
