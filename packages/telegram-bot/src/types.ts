/**
 * Type definitions for Telegram Bot
 */

// ============================================
// Environment
// ============================================

export interface Environment {
  readonly OPENAI_API_KEY: string;
  readonly TELEGRAM_BOT_TOKEN: string;
  readonly TELEGRAM_WEBHOOK_SECRET?: string;
  readonly TELEGRAM_CHAT_ID?: string;
  readonly DEFAULT_PARTICIPANTS?: string;
  readonly ALLOWED_USERS?: string;
  readonly DB: D1Database;
  readonly VECTORIZE: VectorizeIndex;
}

// ============================================
// Telegram Types
// ============================================

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

export interface TelegramVoice {
  readonly file_id: string;
  readonly file_unique_id: string;
  readonly duration: number;
  readonly mime_type?: string;
  readonly file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: TelegramVoice;
  photo?: Array<{ file_id: string }>;
  location?: { latitude: number; longitude: number };
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup';
  title?: string;
}

export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

// ============================================
// Handler Context
// ============================================

export interface CommandContext {
  command: string;
  args: readonly string[];
  chatId: number;
  telegramUser: TelegramUser;
  environment: Environment;
}

export interface CallbackContext {
  query: CallbackQuery;
  action: string;
  actionId: string;
  chatId: number;
  messageId: number;
  environment: Environment;
}

// ============================================
// Inline Keyboard
// ============================================

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = readonly (readonly InlineKeyboardButton[])[];
