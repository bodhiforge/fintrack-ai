/**
 * Main Update Handler
 */

import type { Environment, TelegramUpdate } from '../types.js';
import { sendMessage } from '../telegram/api.js';
import { handleTextMessage, handleLocationMessage } from './message.js';
import { handleCallbackQuery } from './callbacks/index.js';

// ============================================
// Access Control
// ============================================

const ALLOWED_USERS: readonly number[] = [
  7511659357,  // Bodhi
  5347556412,  // Sherry
];

// ============================================
// Main Update Handler
// ============================================

export async function handleUpdate(
  update: TelegramUpdate,
  environment: Environment
): Promise<void> {
  const userId = update.message?.from?.id ?? update.callback_query?.from?.id;

  if (userId != null && !ALLOWED_USERS.includes(userId)) {
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId != null) {
      await sendMessage(chatId, '🔒 Sorry, this is a private bot.', environment.TELEGRAM_BOT_TOKEN);
    }
    return;
  }

  if (update.callback_query != null) {
    await handleCallbackQuery(update.callback_query, environment);
    return;
  }

  if (update.message?.text != null) {
    await handleTextMessage(update.message, environment);
    return;
  }

  if (update.message?.location != null) {
    await handleLocationMessage(update.message, environment);
    return;
  }

  // TODO: Handle voice messages (Whisper API)
  // TODO: Handle photo messages (receipt OCR)
}
