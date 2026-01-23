/**
 * Gmail Webhook Worker for FinTrack AI
 * Processes incoming bank notification emails
 *
 * Integration options:
 * 1. Gmail API Push Notifications (recommended)
 * 2. Email forwarding to Cloudflare Email Workers
 * 3. Zapier/Make.com webhook
 */

import {
  TransactionParser,
  checkCardStrategy,
  formatStrategyResult,
} from '@fintrack-ai/core';

// ============================================
// Types
// ============================================

interface Env {
  OPENAI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

interface EmailPayload {
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt?: string;
}

// Known bank email senders
const BANK_SENDERS = [
  'alerts@americanexpress.com',
  'alerts@aexp.com',
  'alerts@td.com',
  'notify@rbc.com',
  'alerts@scotiabank.com',
  'alerts@cibc.com',
  'notification@rogers.com',
  'alerts@bmo.com',
];

// ============================================
// Main Handler
// ============================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Process email webhook
    if (url.pathname === '/email' && request.method === 'POST') {
      try {
        const payload: EmailPayload = await request.json();
        await processEmail(payload, env);
        return new Response('OK', { status: 200 });
      } catch (error) {
        console.error('Email processing error:', error);
        return new Response('Error', { status: 500 });
      }
    }

    // Test endpoint - manually send a test email
    if (url.pathname === '/test' && request.method === 'POST') {
      const testPayload: EmailPayload = {
        from: 'alerts@americanexpress.com',
        to: 'user@example.com',
        subject: 'Transaction Alert',
        body: `Your American Express Card ending in 1234 was used for $45.67 at UBER EATS on Jan 15, 2026.`,
      };

      await processEmail(testPayload, env);
      return new Response('Test email processed', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },

  // Cloudflare Email Worker handler (alternative integration)
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const payload: EmailPayload = {
      from: message.from,
      to: message.to,
      subject: message.headers.get('subject') ?? '',
      body: await streamToString(message.raw),
    };

    await processEmail(payload, env);
  },
};

// ============================================
// Email Processing
// ============================================

async function processEmail(email: EmailPayload, env: Env): Promise<void> {
  // Validate sender
  const senderLower = email.from.toLowerCase();
  const isBankEmail = BANK_SENDERS.some((bank) =>
    senderLower.includes(bank.toLowerCase())
  );

  if (!isBankEmail) {
    console.log(`Ignoring non-bank email from: ${email.from}`);
    return;
  }

  console.log(`Processing bank email: ${email.subject}`);

  // Parse transaction
  const parser = new TransactionParser(env.OPENAI_API_KEY);
  const { parsed, confidence, warnings } = await parser.parseEmail(
    email.body,
    email.subject
  );

  // Check card strategy
  const strategyResult = checkCardStrategy(parsed);

  // Build Telegram message
  let message = `🔔 *Bank Alert Detected*\n\n`;
  message += `📍 ${parsed.merchant}\n`;
  message += `💰 $${parsed.amount.toFixed(2)} ${parsed.currency}\n`;
  message += `🏷️ ${parsed.category}\n`;
  message += `💳 Card ****${parsed.cardLastFour}\n`;
  message += `📅 ${parsed.date}\n\n`;
  message += formatStrategyResult(strategyResult);

  if (warnings && warnings.length > 0) {
    message += `\n\n⚠️ _${warnings.join(', ')}_`;
  }

  // Send to Telegram
  await sendTelegramMessage(
    env.TELEGRAM_CHAT_ID,
    message,
    env.TELEGRAM_BOT_TOKEN,
    {
      inline_keyboard: [
        [
          { text: '✅ Shared', callback_data: `shared_${Date.now()}` },
          { text: '👤 Personal', callback_data: `personal_${Date.now()}` },
        ],
        [
          { text: '✏️ Edit', callback_data: `edit_${Date.now()}` },
          { text: '🗑️ Ignore', callback_data: `ignore_${Date.now()}` },
        ],
      ],
    }
  );
}

// ============================================
// Telegram Helper
// ============================================

async function sendTelegramMessage(
  chatId: string,
  text: string,
  token: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Telegram API error:', error);
  }
}

// ============================================
// Utilities
// ============================================

async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }

  return result;
}

// Type for Cloudflare Email Workers
interface ForwardableEmailMessage {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream;
}
