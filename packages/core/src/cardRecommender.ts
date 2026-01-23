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
  card: CreditCard;
}

export interface RecommendationResult {
  best: CardRecommendation;
  alternatives: CardRecommendation[];
  missingCardSuggestion?: CardSuggestion;
}

export interface CardSuggestion {
  card: CreditCard;
  reason: string;
  potentialSavings: string;
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
  isForeign: boolean;
  warning?: string;
} {
  if (!location) return { isForeign: currency !== 'CAD' };

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
  pattern: RegExp;
  allowedNetworks: string[];
  reason: string;
}

const MERCHANT_RESTRICTIONS: MerchantRestriction[] = [
  {
    pattern: /costco|wholesale/i,
    allowedNetworks: ['mastercard', 'visa'],  // Costco doesn't accept Amex
    reason: 'Costco only accepts Mastercard/Visa',
  },
];

function checkMerchantRestrictions(merchant: string): MerchantRestriction | undefined {
  return MERCHANT_RESTRICTIONS.find(r => r.pattern.test(merchant));
}

// ============================================
// Main Recommendation Function
// ============================================

export function recommendCard(
  transaction: ParsedTransaction,
  userCards: UserCardWithDetails[],
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
  let eligibleCards = userCards.filter(uc => uc.card);
  let restrictionWarning: string | undefined;

  if (restriction) {
    const filtered = eligibleCards.filter(uc =>
      restriction.allowedNetworks.includes(uc.card.network)
    );
    if (filtered.length > 0) {
      eligibleCards = filtered;
      restrictionWarning = restriction.reason;
    }
  }

  // Calculate reward for each eligible card
  const recommendations = eligibleCards
    .map(userCard => calculateRecommendation(transaction, userCard, isForeign))
    .sort((a, b) => b.rewardValue - a.rewardValue);

  if (recommendations.length === 0) {
    // All cards filtered out by restriction
    const emptyRec = createEmptyRecommendation();
    emptyRec.warning = restriction?.reason;
    return {
      best: emptyRec,
      alternatives: [],
      missingCardSuggestion: suggestCardForMerchant(transaction.merchant),
    };
  }

  const best = recommendations[0];
  const alternatives = recommendations.slice(1, 3);

  // Add restriction warning to best card
  if (restrictionWarning) {
    best.warning = restrictionWarning;
  }

  // Mark if best is actually optimal
  if (alternatives.length > 0) {
    const diff = best.rewardValue - alternatives[0].rewardValue;
    if (diff < 0.01) {
      best.isOptimal = false;
    }
  }

  // Check if user is missing a better card for this category
  const missingCardSuggestion = checkMissingCard(transaction, userCards, best, restriction);

  return {
    best,
    alternatives,
    missingCardSuggestion,
  };
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
  let bestRule: RewardRule | undefined;

  // Check for foreign transaction rule first
  if (isForeign) {
    bestRule = card.rewards.find(r => r.category === 'foreign');
  }

  // Check category-specific rule
  if (!bestRule) {
    bestRule = card.rewards.find(r => r.category === category);
  }

  // Fall back to 'all' rule
  if (!bestRule) {
    bestRule = card.rewards.find(r => r.category === 'all');
  }

  // Calculate reward
  const reward = bestRule ? formatReward(amount, bestRule) : 'No rewards';
  const rewardValue = bestRule ? calculateRewardValue(amount, bestRule) : 0;

  // Adjust for FX fee if foreign
  let adjustedRewardValue = rewardValue;
  if (isForeign && card.ftf > 0) {
    const fxFee = amount * (card.ftf / 100);
    adjustedRewardValue = rewardValue - fxFee;
  }

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
  userCards: UserCardWithDetails[],
  currentBest: CardRecommendation,
  restriction?: { allowedNetworks: string[] }
): CardSuggestion | undefined {
  const category = transaction.category;
  const userCardIds = new Set(userCards.map(uc => uc.cardId));

  // Find the best card for this category that user doesn't have
  // Respect merchant restrictions
  const bestAvailable = PRESET_CARDS
    .filter(c => !userCardIds.has(c.id))
    .filter(c => !restriction || restriction.allowedNetworks.includes(c.network))
    .map(card => {
      const rule = card.rewards.find(r => r.category === category) ??
                   card.rewards.find(r => r.category === 'all');
      const value = rule ? calculateRewardValue(transaction.amount, rule) : 0;
      return { card, value, rule };
    })
    .sort((a, b) => b.value - a.value)[0];

  if (!bestAvailable || !bestAvailable.rule) return undefined;

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

export function formatRecommendation(rec: CardRecommendation): string {
  let msg = '';

  // Show warning first if any (e.g., Costco restriction)
  if (rec.warning) {
    msg += `⚠️ _${rec.warning}_\n\n`;
  }

  if (rec.isOptimal) {
    msg += `✅ *Use ${rec.card.name}*\n`;
    msg += `💰 Earn ${rec.reward}\n`;
  } else {
    msg += `⚠️ *Consider ${rec.card.name}*\n`;
    msg += `💰 Could earn ${rec.reward}\n`;
  }

  return msg;
}

export function formatBenefits(benefits: CardBenefit[]): string {
  if (benefits.length === 0) return '';

  let msg = '\n🎁 *Benefits with this card:*\n';
  benefits.forEach(b => {
    const emoji = b.type === 'insurance' ? '🛡️' :
                  b.type === 'lounge' ? '✈️' :
                  b.type === 'credit' ? '💵' : '🎁';
    msg += `  ${emoji} ${b.name}\n`;
    if (b.conditions) {
      msg += `     _${b.conditions}_\n`;
    }
  });

  return msg;
}

export function formatCardSuggestion(suggestion: CardSuggestion): string {
  let msg = `\n💡 *${suggestion.reason}*\n\n`;
  msg += `Recommended: *${suggestion.card.name}*\n`;

  // Key benefits
  const topBenefits = suggestion.card.benefits.slice(0, 2);
  topBenefits.forEach(b => {
    msg += `• ${b.name}\n`;
  });

  msg += `\n${suggestion.potentialSavings}\n`;

  if (suggestion.card.referralUrl) {
    msg += `\n👉 [Apply now](${suggestion.card.referralUrl})`;
    if (suggestion.card.referralBonus) {
      msg += ` - ${suggestion.card.referralBonus}`;
    }
    msg += '\n_This may include a referral bonus_';
  }

  return msg;
}
