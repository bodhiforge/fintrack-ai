/**
 * Telegram Bot Worker for FinTrack AI
 * Handles incoming messages and callback queries
 */

import {
  TransactionParser,
  splitExpense,
  checkCardStrategy,
  formatStrategyResult,
  parseNaturalLanguageSplit,
} from '@fintrack-ai/core';

// ============================================
// Types
// ============================================

interface Env {
  OPENAI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DEFAULT_PARTICIPANTS?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: { file_id: string };
  photo?: Array<{ file_id: string }>;
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup';
  title?: string;
}

interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

// ============================================
// Main Handler
// ============================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Debug endpoint - test sending a message
    if (url.pathname === '/debug') {
      const hasToken = !!env.TELEGRAM_BOT_TOKEN;
      const hasOpenAI = !!env.OPENAI_API_KEY;
      const chatId = env.TELEGRAM_CHAT_ID || '7511659357';

      let result = `Token: ${hasToken}, OpenAI: ${hasOpenAI}, ChatID: ${chatId}\n`;

      try {
        const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '🔧 Debug: Worker is working!',
          }),
        });
        const data = await resp.json();
        result += `Telegram response: ${JSON.stringify(data)}`;
      } catch (e) {
        result += `Error: ${e}`;
      }

      return new Response(result, { status: 200 });
    }

    // Webhook endpoint
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update: TelegramUpdate = await request.json();
        await handleUpdate(update, env);
        return new Response('OK', { status: 200 });
      } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Error', { status: 500 });
      }
    }

    // Setup webhook endpoint
    if (url.pathname === '/setup-webhook') {
      const webhookUrl = `${url.origin}/webhook`;
      const result = await setWebhook(env.TELEGRAM_BOT_TOKEN, webhookUrl);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ============================================
// Access Control
// ============================================

const ALLOWED_USERS = [
  7511659357,  // Bodhi
  5347556412,  // Partner
];

// ============================================
// Update Handler
// ============================================

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  // Check whitelist
  const userId = update.message?.from?.id || update.callback_query?.from?.id;
  if (userId && !ALLOWED_USERS.includes(userId)) {
    const chatId = update.message?.chat.id || update.callback_query?.message?.chat.id;
    if (chatId) {
      await sendMessage(chatId, '🔒 Sorry, this is a private bot.', env.TELEGRAM_BOT_TOKEN);
    }
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
    return;
  }

  if (update.message?.text) {
    await handleTextMessage(update.message, env);
    return;
  }

  // TODO: Handle voice messages (Whisper API)
  // TODO: Handle photo messages (receipt OCR)
}

// ============================================
// Text Message Handler
// ============================================

async function handleTextMessage(
  message: TelegramMessage,
  env: Env
): Promise<void> {
  const text = message.text ?? '';
  const chatId = message.chat.id;
  const userName = message.from?.first_name ?? 'User';

  // Command handling
  if (text.startsWith('/')) {
    await handleCommand(text, chatId, env);
    return;
  }

  // Parse as expense
  try {
    const parser = new TransactionParser(env.OPENAI_API_KEY);
    const { parsed, confidence, warnings } = await parser.parseNaturalLanguage(text);

    // Check card strategy
    const strategyResult = checkCardStrategy(parsed);

    // Get default participants
    const participants = env.DEFAULT_PARTICIPANTS?.split(',') ?? [userName, 'Partner'];

    // Parse any split modifiers from the text
    const splitMods = parseNaturalLanguageSplit(text, participants);

    // Calculate split
    const splitResult = splitExpense({
      totalAmount: parsed.amount,
      currency: parsed.currency,
      payer: userName,
      participants,
      excludedParticipants: splitMods.excludedParticipants,
    });

    // Build response message
    let response = `💳 *New Transaction*\n\n`;
    response += `📍 ${parsed.merchant}\n`;
    response += `💰 $${parsed.amount.toFixed(2)} ${parsed.currency}\n`;
    response += `🏷️ ${parsed.category}\n`;
    response += `📅 ${parsed.date}\n\n`;

    // Split info
    response += `*Split:*\n`;
    Object.entries(splitResult.shares).forEach(([person, share]) => {
      response += `  ${person}: $${share.toFixed(2)}\n`;
    });

    response += `\n${formatStrategyResult(strategyResult)}`;

    if (warnings && warnings.length > 0) {
      response += `\n\n⚠️ ${warnings.join(', ')}`;
    }

    if (confidence < 1) {
      response += `\n\n_Confidence: ${(confidence * 100).toFixed(0)}%_`;
    }

    // Send with inline keyboard
    await sendMessage(chatId, response, env.TELEGRAM_BOT_TOKEN, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm', callback_data: `confirm_${Date.now()}` },
            { text: '👤 Personal', callback_data: `personal_${Date.now()}` },
          ],
          [
            { text: '✏️ Edit', callback_data: `edit_${Date.now()}` },
            { text: '❌ Delete', callback_data: `delete_${Date.now()}` },
          ],
        ],
      },
    });
  } catch (error) {
    console.error('Parse error:', error);
    await sendMessage(
      chatId,
      `❌ Failed to parse: ${error instanceof Error ? error.message : 'Unknown error'}`,
      env.TELEGRAM_BOT_TOKEN
    );
  }
}

// ============================================
// Command Handler
// ============================================

async function handleCommand(
  text: string,
  chatId: number,
  env: Env
): Promise<void> {
  const [command, ...args] = text.split(' ');

  switch (command) {
    case '/start':
      await sendMessage(
        chatId,
        `👋 Welcome to FinTrack AI!\n\nYour Chat ID: \`${chatId}\`\n\nJust send me your expenses in natural language:\n\n• "dinner 50 at Sushi Place"\n• "Costco 150"\n• "uber 25 USD"\n\nI'll parse, categorize, and check your card strategy automatically.`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case '/help':
      await sendMessage(
        chatId,
        `*Commands:*\n/start - Welcome message\n/help - This help\n/balance - Show current balances\n/settle - Calculate settlements\n/cards - Show configured cards\n\n*Expense format:*\nJust type naturally!\n"lunch 30 at McDonald's"\n"groceries 80 at Costco"\n"50 USD Amazon"`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case '/balance':
      // TODO: Fetch from storage and calculate balances
      await sendMessage(
        chatId,
        '📊 Balance calculation coming soon!',
        env.TELEGRAM_BOT_TOKEN
      );
      break;

    case '/settle':
      // TODO: Calculate and display settlements
      await sendMessage(
        chatId,
        '💸 Settlement calculation coming soon!',
        env.TELEGRAM_BOT_TOKEN
      );
      break;

    case '/cards':
      await sendMessage(
        chatId,
        `*Configured Cards:*\n\n💳 Amex Cobalt - Dining, Grocery (5x)\n💳 Rogers WE MC - Costco, Foreign (No FX)\n💳 TD CB Visa - Gas (3%)`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    default:
      await sendMessage(
        chatId,
        `Unknown command. Try /help`,
        env.TELEGRAM_BOT_TOKEN
      );
  }
}

// ============================================
// Callback Query Handler
// ============================================

async function handleCallbackQuery(
  query: CallbackQuery,
  env: Env
): Promise<void> {
  const data = query.data ?? '';
  const [action] = data.split('_');

  // Acknowledge the callback
  await answerCallbackQuery(query.id, env.TELEGRAM_BOT_TOKEN);

  switch (action) {
    case 'confirm':
      // TODO: Save to storage
      await editMessageText(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        query.message?.text + '\n\n✅ *Confirmed*',
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'personal':
      // TODO: Update split to personal
      await editMessageText(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        query.message?.text + '\n\n👤 *Marked as personal*',
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'delete':
      await deleteMessage(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        env.TELEGRAM_BOT_TOKEN
      );
      break;

    case 'edit':
      await sendMessage(
        query.message?.chat.id ?? 0,
        'Reply to this message with your correction.',
        env.TELEGRAM_BOT_TOKEN
      );
      break;
  }
}

// ============================================
// Telegram API Helpers
// ============================================

async function sendMessage(
  chatId: number,
  text: string,
  token: string,
  options?: Record<string, unknown>
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

async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  token: string,
  options?: Record<string, unknown>
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

async function deleteMessage(
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

async function answerCallbackQuery(
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

async function setWebhook(
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
  return response.json();
}
