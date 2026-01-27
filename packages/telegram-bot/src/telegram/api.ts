/**
 * Telegram API Helper Functions
 */

import type { InlineKeyboard } from '../types.js';

// ============================================
// Message Sending
// ============================================

export async function sendMessage(
  chatId: number,
  text: string,
  token: string,
  options?: Readonly<Record<string, unknown>>
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...options,
    }),
  });
}

export async function sendMessageWithKeyboard(
  chatId: number,
  text: string,
  token: string,
  keyboard: InlineKeyboard,
  parseMode: 'Markdown' | 'HTML' = 'Markdown'
): Promise<void> {
  await sendMessage(chatId, text, token, {
    parse_mode: parseMode,
    reply_markup: { inline_keyboard: keyboard },
  });
}

// ============================================
// Message Editing
// ============================================

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  token: string,
  options?: Readonly<Record<string, unknown>>
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    }),
  });
}

// ============================================
// Message Deletion
// ============================================

export async function deleteMessage(
  chatId: number,
  messageId: number,
  token: string
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  });
}

// ============================================
// Callback Query
// ============================================

export async function answerCallbackQuery(
  callbackQueryId: string,
  token: string,
  text?: string
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
}

// ============================================
// Persistent Keyboard
// ============================================

export async function setPersistentKeyboard(
  chatId: number,
  token: string,
  silent: boolean = false
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: silent ? '.' : '⌨️',
    reply_markup: {
      keyboard: [
        [
          { text: '💰 Balance' },
          { text: '💸 Settle' },
          { text: '📜 History' },
        ],
        [
          { text: '↩️ Undo' },
          { text: '🏠 Menu' },
          { text: '❓ Help' },
        ],
      ],
      resize_keyboard: true,
      is_persistent: false,
    },
  };

  // If silent, try to delete the message after sending
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (silent) {
    const result = await response.json() as { result?: { message_id?: number } };
    const messageId = result.result?.message_id;
    if (messageId != null) {
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      });
    }
  }
}

// ============================================
// Webhook Management
// ============================================

export async function setWebhook(
  token: string,
  url: string
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }
  );
  return response.json() as Promise<Record<string, unknown>>;
}
