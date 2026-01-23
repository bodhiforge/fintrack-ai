/**
 * Telegram Bot Worker for FinTrack AI
 * Entry point - handles HTTP routing
 */

import type { Environment, TelegramUpdate } from './types.js';
import { setWebhook } from './telegram/api.js';
import { handleUpdate } from './handlers/index.js';

// ============================================
// Main Handler
// ============================================

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Debug endpoint
    if (url.pathname === '/debug') {
      return handleDebug(environment);
    }

    // Webhook endpoint
    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, environment);
    }

    // Setup webhook endpoint
    if (url.pathname === '/setup-webhook') {
      return handleSetupWebhook(url, environment);
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ============================================
// Route Handlers
// ============================================

async function handleDebug(environment: Environment): Promise<Response> {
  const hasToken = environment.TELEGRAM_BOT_TOKEN != null && environment.TELEGRAM_BOT_TOKEN !== '';
  const hasOpenAI = environment.OPENAI_API_KEY != null && environment.OPENAI_API_KEY !== '';
  const chatId = environment.TELEGRAM_CHAT_ID ?? '7511659357';

  const statusLine = `Token: ${hasToken}, OpenAI: ${hasOpenAI}, ChatID: ${chatId}`;

  const telegramResult = await (async () => {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${environment.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '🔧 Debug: Worker is working!',
          }),
        }
      );
      const data = await response.json();
      return `Telegram response: ${JSON.stringify(data)}`;
    } catch (error) {
      return `Error: ${error}`;
    }
  })();

  return new Response([statusLine, telegramResult].join('\n'), { status: 200 });
}

async function handleWebhook(
  request: Request,
  environment: Environment
): Promise<Response> {
  try {
    const update: TelegramUpdate = await request.json();
    await handleUpdate(update, environment);
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error', { status: 500 });
  }
}

async function handleSetupWebhook(
  url: URL,
  environment: Environment
): Promise<Response> {
  const webhookUrl = `${url.origin}/webhook`;
  const result = await setWebhook(environment.TELEGRAM_BOT_TOKEN, webhookUrl);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}
