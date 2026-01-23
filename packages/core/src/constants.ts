/**
 * Core constants for FinTrack AI
 * Eliminates magic strings throughout the codebase
 */

// ============================================
// Card Networks
// ============================================

export const CARD_NETWORK = {
  VISA: 'visa',
  MASTERCARD: 'mastercard',
  AMEX: 'amex',
} as const;

// ============================================
// Reward Types
// ============================================

export const REWARD_TYPE = {
  POINTS: 'points',
  CASHBACK: 'cashback',
  MILES: 'miles',
} as const;

// ============================================
// Benefit Types
// ============================================

export const BENEFIT_TYPE = {
  INSURANCE: 'insurance',
  LOUNGE: 'lounge',
  CREDIT: 'credit',
  WARRANTY: 'warranty',
  PERK: 'perk',
} as const;

// ============================================
// Spending Categories
// ============================================

export const CATEGORY = {
  DINING: 'dining',
  GROCERY: 'grocery',
  GAS: 'gas',
  SHOPPING: 'shopping',
  SUBSCRIPTION: 'subscription',
  TRAVEL: 'travel',
  TRANSPORT: 'transport',
  ENTERTAINMENT: 'entertainment',
  HEALTH: 'health',
  UTILITIES: 'utilities',
  OTHER: 'other',
} as const;

// ============================================
// Currency Codes
// ============================================

export const CurrencyCode = {
  CAD: 'CAD',
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  MXN: 'MXN',
  CRC: 'CRC',
  JPY: 'JPY',
  HKD: 'HKD',
  SGD: 'SGD',
  KRW: 'KRW',
  THB: 'THB',
} as const;

export type CurrencyCodeValue = (typeof CurrencyCode)[keyof typeof CurrencyCode];

// ============================================
// Numeric Thresholds
// ============================================

export const Threshold = {
  BALANCE_EPSILON: 0.01,
  MAX_TRANSACTION_AMOUNT: 10000,
  MIN_TRANSACTION_AMOUNT: 0,
  DEFAULT_POINT_VALUE: 0.01,
} as const;

// ============================================
// Card IDs (Preset Cards)
// ============================================

export const CardId = {
  AMEX_COBALT: 'amex-cobalt',
  AMEX_GOLD: 'amex-gold',
  ROGERS_WE_MC: 'rogers-we-mc',
  HSBC_WE_MC: 'hsbc-we-mc',
  TD_AEROPLAN_VI: 'td-aeroplan-vi',
  TANGERINE_MC: 'tangerine-mc',
  PC_FINANCIAL_MC: 'pc-financial-mc',
  SCOTIABANK_GOLD_AMEX: 'scotiabank-gold-amex',
  BMO_ECLIPSE_VI: 'bmo-eclipse-vi',
} as const;

export type CardIdValue = (typeof CardId)[keyof typeof CardId];

// ============================================
// Emojis for UI
// ============================================

export const Emoji = {
  CHECK: '\u2705',
  WARNING: '\u26a0\ufe0f',
  MONEY: '\ud83d\udcb0',
  CARD: '\ud83d\udcb3',
  FOLDER: '\ud83d\udcc1',
  PIN: '\ud83d\udccd',
  GIFT: '\ud83c\udf81',
  SHIELD: '\ud83d\udee1\ufe0f',
  PLANE: '\u2708\ufe0f',
  DOLLAR: '\ud83d\udcb5',
  GREEN_HEART: '\ud83d\udc9a',
  RED_CIRCLE: '\ud83d\udd34',
  SPARKLE: '\u2728',
  WRENCH: '\ud83d\udd27',
  BULLET: '\u2022',
} as const;

// ============================================
// Location to Currency Mapping
// ============================================

export const LocationCurrency: Readonly<Record<string, string>> = {
  // Japan
  tokyo: 'JPY',
  osaka: 'JPY',
  kyoto: 'JPY',
  japan: 'JPY',
  '\u6771\u4eac': 'JPY',
  '\u65e5\u672c': 'JPY',
  // USA
  'new york': 'USD',
  nyc: 'USD',
  'los angeles': 'USD',
  la: 'USD',
  usa: 'USD',
  seattle: 'USD',
  'san francisco': 'USD',
  sf: 'USD',
  vegas: 'USD',
  'las vegas': 'USD',
  hawaii: 'USD',
  // Europe
  london: 'GBP',
  uk: 'GBP',
  england: 'GBP',
  paris: 'EUR',
  france: 'EUR',
  germany: 'EUR',
  berlin: 'EUR',
  italy: 'EUR',
  rome: 'EUR',
  spain: 'EUR',
  barcelona: 'EUR',
  amsterdam: 'EUR',
  netherlands: 'EUR',
  // Mexico / Central America
  mexico: 'MXN',
  cancun: 'MXN',
  'mexico city': 'MXN',
  'costa rica': 'CRC',
  'san jose': 'CRC',
  // Asia
  'hong kong': 'HKD',
  hk: 'HKD',
  '\u9999\u6e2f': 'HKD',
  singapore: 'SGD',
  '\u65b0\u52a0\u5761': 'SGD',
  korea: 'KRW',
  seoul: 'KRW',
  '\u97e9\u56fd': 'KRW',
  thailand: 'THB',
  bangkok: 'THB',
} as const;
