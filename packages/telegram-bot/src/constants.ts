/**
 * Constants for Telegram Bot
 * Eliminates magic strings throughout the codebase
 */

// ============================================
// Transaction Status
// ============================================

export const TransactionStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  DELETED: 'deleted',
  PERSONAL: 'personal',
} as const;

export type TransactionStatusValue = (typeof TransactionStatus)[keyof typeof TransactionStatus];

// ============================================
// Project Roles
// ============================================

export const ProjectRole = {
  OWNER: 'owner',
  MEMBER: 'member',
} as const;

export type ProjectRoleValue = (typeof ProjectRole)[keyof typeof ProjectRole];

// ============================================
// Project Types
// ============================================

export const ProjectType = {
  ONGOING: 'ongoing',
  TRIP: 'trip',
  EVENT: 'event',
} as const;

export type ProjectTypeValue = (typeof ProjectType)[keyof typeof ProjectType];

// ============================================
// Numeric Thresholds
// ============================================

export const Threshold = {
  BALANCE_EPSILON: 0.01,
  INVITE_CODE_LENGTH: 6,
  INVITE_EXPIRY_DAYS: 7,
  HISTORY_LIMIT: 10,
  LAST_30_DAYS_MS: 30 * 24 * 60 * 60 * 1000,
} as const;

// ============================================
// Invite Code Characters
// ============================================

export const INVITE_CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
  CALENDAR: '\ud83d\udcc5',
  CHART: '\ud83d\udcca',
  LINK: '\ud83d\udd17',
  PERSON: '\ud83d\udc64',
  PEOPLE: '\ud83d\udc65',
  HOUSE: '\ud83c\udfe0',
  AIRPLANE: '\u2708\ufe0f',
  PARTY: '\ud83c\udf89',
  PENCIL: '\u270f\ufe0f',
  TRASH: '\ud83d\uddd1\ufe0f',
  BACK: '\u2b05\ufe0f',
  GEAR: '\u2699\ufe0f',
  ARCHIVE: '\ud83d\udce6',
  BELL: '\ud83d\udd14',
} as const;

// ============================================
// Callback Action Prefixes
// ============================================

export const CallbackAction = {
  CONFIRM: 'confirm',
  PERSONAL: 'personal',
  DELETE: 'delete',
  EDIT: 'edit',
  MENU: 'menu',
  PROJECT: 'proj',
  SWITCH: 'switch',
  TRANSACTION_EDIT: 'txe',
  TRANSACTION_CATEGORY: 'txc',
  SETTINGS: 'set',
  CARD: 'card',
  CARD_ADD: 'cadd',
} as const;

// ============================================
// Menu Actions
// ============================================

export const MenuAction = {
  BALANCE: 'balance',
  SETTLE: 'settle',
  HISTORY: 'history',
  CARDS: 'cards',
  PROJECTS: 'projects',
  HELP: 'help',
} as const;

// ============================================
// Project Menu Actions
// ============================================

export const ProjectMenuAction = {
  LIST: 'list',
  SWITCH: 'switch',
  INVITE: 'invite',
  NEW: 'new',
  JOIN: 'join',
  SETTINGS: 'settings',
  ARCHIVE: 'archive',
  BACK: 'back',
} as const;

// ============================================
// Edit Field Actions
// ============================================

export const EditField = {
  AMOUNT: 'amt',
  MERCHANT: 'mrc',
  CATEGORY: 'cat',
  SPLIT: 'spl',
  CANCEL: 'x',
} as const;

// ============================================
// Card Menu Actions
// ============================================

export const CardMenuAction = {
  ADD: 'add',
  BROWSE: 'browse',
  REMOVE: 'remove',
  REMOVE_PREFIX: 'rm_',
  CATEGORY_PREFIX: 'cat_',
  CANCEL: 'cancel',
} as const;

// ============================================
// Default Project
// ============================================

export const DEFAULT_PROJECT_ID = 'default';
export const DEFAULT_PROJECT_NAME = 'Daily';
