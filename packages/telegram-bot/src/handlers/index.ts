/**
 * Main Update Handler
 */

import type { Environment, TelegramUpdate } from '../types.js';
import { sendMessage } from '../telegram/api.js';
import { handleTextMessage, handleLocationMessage, handleVoiceMessage } from './message.js';
import { handleCallbackQuery } from './callbacks/index.js';

// ============================================
// Access Control
// ============================================

function getAllowedUsers(environment: Environment): readonly number[] {
  if (environment.ALLOWED_USERS == null || environment.ALLOWED_USERS === '') {
    return [];
  }
  return environment.ALLOWED_USERS
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id));
}

// ============================================
// Main Update Handler
// ============================================

export async function handleUpdate(
  update: TelegramUpdate,
  environment: Environment
): Promise<void> {
  const userId = update.message?.from?.id ?? update.callback_query?.from?.id;
  const allowedUsers = getAllowedUsers(environment);

  if (allowedUsers.length > 0 && userId != null && !allowedUsers.includes(userId)) {
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

  if (update.message?.voice != null) {
    await handleVoiceMessage(update.message, environment);
    return;
  }

  // TODO: Handle photo messages (receipt OCR)
}
