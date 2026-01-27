/**
 * Telegram Bot Worker for FinTrack AI
 * Entry point - handles HTTP routing
 */

import type { Environment, TelegramUpdate } from './types.js';
import { setWebhook, setBotCommands } from './telegram/api.js';
import { handleUpdate } from './handlers/index.js';
import { EmbeddingService } from './services/embedding.js';

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

    // Backfill embeddings endpoint (one-time use)
    if (url.pathname === '/backfill-embeddings') {
      return handleBackfillEmbeddings(environment);
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
  const webhookResult = await setWebhook(environment.TELEGRAM_BOT_TOKEN, webhookUrl);

  // Set bot commands (Menu button will show these)
  await setBotCommands(environment.TELEGRAM_BOT_TOKEN);

  return new Response(JSON.stringify({ webhook: webhookResult, commands: 'set' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleBackfillEmbeddings(
  environment: Environment
): Promise<Response> {
  try {
    // Fetch all confirmed/personal transactions
    const result = await environment.DB.prepare(`
      SELECT id, merchant, amount, category, currency, location
      FROM transactions
      WHERE status IN ('confirmed', 'personal')
    `).all();

    const transactions = result.results ?? [];
    console.log(`[Backfill] Found ${transactions.length} transactions to process`);

    const embeddingService = new EmbeddingService(environment);
    let processed = 0;
    let errors = 0;

    // Process one by one to avoid rate limits
    for (const row of transactions) {
      try {
        await embeddingService.storeTransaction({
          id: row.id as string,
          merchant: row.merchant as string,
          amount: row.amount as number,
          category: row.category as string,
          currency: row.currency as string,
          location: row.location as string | undefined,
        });
        processed++;
        console.log(`[Backfill] Processed ${processed}/${transactions.length}: ${row.merchant}`);
      } catch (error) {
        console.error(`[Backfill] Error processing ${row.id}:`, error);
        errors++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed,
      errors,
      total: transactions.length,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Backfill] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
