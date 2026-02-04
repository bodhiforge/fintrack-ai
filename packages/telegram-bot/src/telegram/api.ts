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

export async function setMenuButton(
  chatId: number,
  token: string
): Promise<void> {
  // Set the menu button to show commands
  await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      menu_button: {
        type: 'commands',
      },
    }),
  });
}

export async function setBotCommands(token: string): Promise<void> {
  const commands = [
    { command: 'menu', description: '🏠 Main menu' },
    { command: 'balance', description: '💰 View balance' },
    { command: 'history', description: '📜 Transaction history' },
    { command: 'undo', description: '↩️ Undo last action' },
    { command: 'new', description: '➕ Create project' },
    { command: 'switch', description: '🔄 Switch project' },
    { command: 'help', description: '❓ Help' },
  ];

  await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
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
