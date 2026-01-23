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
  calculateBalances,
  simplifyDebts,
  formatSettlements,
  type Transaction,
  type Category,
  type Currency,
} from '@fintrack-ai/core';

// ============================================
// Types
// ============================================

interface Env {
  OPENAI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_CHAT_ID?: string;
  DEFAULT_PARTICIPANTS?: string;
  DB: D1Database;
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
  5347556412,  // Sherry
];

// ============================================
// Database Helpers
// ============================================

function rowToTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    date: row.created_at as string,
    merchant: row.merchant as string,
    amount: row.amount as number,
    currency: row.currency as Currency,
    category: row.category as Category,
    cardLastFour: (row.card_last_four as string) || '',
    payer: row.payer as string,
    isShared: row.is_shared === 1,
    splits: row.splits ? JSON.parse(row.splits as string) : {},
    createdAt: row.created_at as string,
    confirmedAt: row.confirmed_at as string,
  };
}

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
    const participants = env.DEFAULT_PARTICIPANTS?.split(',') ?? [userName, 'Sherry'];

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

    // Save pending transaction to D1
    const txId = crypto.randomUUID();
    const userId = message.from?.id ?? 0;
    await env.DB.prepare(`
      INSERT INTO transactions (id, user_id, chat_id, merchant, amount, currency, category, card_last_four, payer, is_shared, splits, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      txId,
      userId,
      chatId,
      parsed.merchant,
      parsed.amount,
      parsed.currency,
      parsed.category,
      parsed.cardLastFour || null,
      userName,
      1,
      JSON.stringify(splitResult.shares),
      new Date().toISOString()
    ).run();

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

    // Send with inline keyboard (use txId for callbacks)
    await sendMessage(chatId, response, env.TELEGRAM_BOT_TOKEN, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm', callback_data: `confirm_${txId}` },
            { text: '👤 Personal', callback_data: `personal_${txId}` },
          ],
          [
            { text: '✏️ Edit', callback_data: `edit_${txId}` },
            { text: '❌ Delete', callback_data: `delete_${txId}` },
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
        `*Commands:*\n/start - Welcome message\n/help - This help\n/balance - Show current balances\n/settle - Calculate settlements\n/history - Recent transactions\n/cards - Show configured cards\n\n*Expense format:*\nJust type naturally!\n"lunch 30 at McDonald's"\n"groceries 80 at Costco"\n"50 USD Amazon"`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case '/balance': {
      // Fetch confirmed shared transactions (last 30 days, max 200)
      const balanceRows = await env.DB.prepare(`
        SELECT * FROM transactions
        WHERE chat_id = ? AND status = 'confirmed' AND is_shared = 1
          AND created_at > datetime('now', '-30 days')
        ORDER BY created_at DESC
        LIMIT 200
      `).bind(chatId).all();

      if (!balanceRows.results || balanceRows.results.length === 0) {
        await sendMessage(chatId, '📊 No confirmed shared expenses yet.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      const transactions = balanceRows.results.map((row) => rowToTransaction(row as Record<string, unknown>));
      const balances = calculateBalances(transactions);

      if (balances.length === 0) {
        await sendMessage(chatId, '📊 All balanced! No one owes anything.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      let balanceMsg = `📊 *Current Balances*\n\n`;
      balances.forEach((b) => {
        const emoji = b.netBalance > 0 ? '💚' : '🔴';
        const status = b.netBalance > 0 ? 'is owed' : 'owes';
        balanceMsg += `${emoji} ${b.person} ${status} $${Math.abs(b.netBalance).toFixed(2)}\n`;
      });

      await sendMessage(chatId, balanceMsg, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

    case '/settle': {
      // Fetch confirmed shared transactions (last 30 days, max 200)
      const settleRows = await env.DB.prepare(`
        SELECT * FROM transactions
        WHERE chat_id = ? AND status = 'confirmed' AND is_shared = 1
          AND created_at > datetime('now', '-30 days')
        ORDER BY created_at DESC
        LIMIT 200
      `).bind(chatId).all();

      if (!settleRows.results || settleRows.results.length === 0) {
        await sendMessage(chatId, '💸 No confirmed shared expenses to settle.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      const txns = settleRows.results.map((row) => rowToTransaction(row as Record<string, unknown>));
      const settlements = simplifyDebts(txns, 'CAD');

      if (settlements.length === 0) {
        await sendMessage(chatId, '💸 All settled! No payments needed.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      let settleMsg = `💸 *Settlement Summary*\n\n`;
      settleMsg += formatSettlements(settlements);

      await sendMessage(chatId, settleMsg, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

    case '/history': {
      // Fetch recent transactions (last 10)
      const historyRows = await env.DB.prepare(`
        SELECT * FROM transactions
        WHERE chat_id = ? AND status IN ('confirmed', 'personal')
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(chatId).all();

      if (!historyRows.results || historyRows.results.length === 0) {
        await sendMessage(chatId, '📜 No transaction history yet.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      let historyMsg = `📜 *Recent Transactions*\n\n`;
      historyRows.results.forEach((row: Record<string, unknown>) => {
        const date = new Date(row.created_at as string).toLocaleDateString('en-CA');
        const status = row.status === 'personal' ? '👤' : '✅';
        historyMsg += `${status} ${date} | ${row.merchant} | $${(row.amount as number).toFixed(2)}\n`;
      });

      await sendMessage(chatId, historyMsg, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

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
  const [action, txId] = data.split('_');

  // Acknowledge the callback
  await answerCallbackQuery(query.id, env.TELEGRAM_BOT_TOKEN);

  switch (action) {
    case 'confirm':
      // Update transaction status to confirmed
      await env.DB.prepare(`
        UPDATE transactions SET status = 'confirmed', confirmed_at = ? WHERE id = ?
      `).bind(new Date().toISOString(), txId).run();

      await editMessageText(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        query.message?.text + '\n\n✅ *Confirmed*',
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'personal':
      // Update to personal (not shared)
      await env.DB.prepare(`
        UPDATE transactions SET status = 'personal', is_shared = 0, splits = NULL, confirmed_at = ? WHERE id = ?
      `).bind(new Date().toISOString(), txId).run();

      await editMessageText(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        query.message?.text + '\n\n👤 *Marked as personal*',
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'delete':
      // Mark as deleted in database
      await env.DB.prepare(`
        UPDATE transactions SET status = 'deleted' WHERE id = ?
      `).bind(txId).run();

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
