/**
 * Clarification Callbacks
 * Handles user responses to intent clarification prompts
 */

import type { Environment, CallbackQuery } from '../../types.js';
import { editMessageText } from '../../telegram/api.js';
import { getOrCreateUser, getCurrentProject } from '../../db/index.js';
import { getSession, clearSession } from '../../agent/session.js';
import { processTransactionText } from '../message.js';

// ============================================
// Clarification Callback Handler
// ============================================

export async function handleClarifyCallback(
  query: CallbackQuery,
  actionId: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const telegramUser = query.from;

  if (chatId == null || messageId == null || telegramUser == null) {
    return;
  }

  const user = await getOrCreateUser(environment, telegramUser);
  const session = await getSession(environment.DB, user.id, chatId);

  // Check if we have a pending clarification
  if (session?.state.type !== 'awaiting_intent_clarification') {
    await editMessageText(
      chatId,
      messageId,
      '⏰ This selection has expired. Please try again.',
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  const { originalText } = session.state;

  // Clear the session first
  await clearSession(environment.DB, user.id, chatId);

  switch (actionId) {
    case 'record': {
      // User wants to log an expense
      await editMessageText(
        chatId,
        messageId,
        `📝 Processing as expense: "${originalText}"`,
        environment.TELEGRAM_BOT_TOKEN
      );
      // Process as transaction
      await processTransactionText(originalText, chatId, telegramUser, environment);
      break;
    }

    case 'query': {
      // User wants to query spending
      await editMessageText(
        chatId,
        messageId,
        `📊 Use /history to see recent transactions\nor /balance to see who owes whom`,
        environment.TELEGRAM_BOT_TOKEN
      );
      break;
    }

    case 'cancel': {
      await editMessageText(
        chatId,
        messageId,
        '❌ Cancelled',
        environment.TELEGRAM_BOT_TOKEN
      );
      break;
    }

    default: {
      await editMessageText(
        chatId,
        messageId,
        '❓ Unknown action',
        environment.TELEGRAM_BOT_TOKEN
      );
    }
  }
}
