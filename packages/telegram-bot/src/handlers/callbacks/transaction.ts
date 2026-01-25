/**
 * Transaction Callback Handlers
 */

import type { CallbackQuery, Environment } from '../../types.js';
import { sendMessage, editMessageText, deleteMessage } from '../../telegram/api.js';
import { TransactionStatus } from '../../constants.js';
import { EmbeddingService } from '../../services/embedding.js';

export async function handleTransactionCallbacks(
  query: CallbackQuery,
  transactionId: string,
  environment: Environment
): Promise<void> {
  const action = query.data?.split('_')[0] ?? '';
  const chatId = query.message?.chat.id ?? 0;
  const messageId = query.message?.message_id ?? 0;
  const messageText = query.message?.text ?? '';

  switch (action) {
    case 'confirm': {
      await environment.DB.prepare(`
        UPDATE transactions SET status = ?, confirmed_at = ? WHERE id = ?
      `).bind(TransactionStatus.CONFIRMED, new Date().toISOString(), transactionId).run();

      // Store embedding for semantic search
      await storeTransactionEmbedding(transactionId, environment);

      await editMessageText(
        chatId,
        messageId,
        messageText + '\n\n✅ *Confirmed*',
        environment.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case 'personal': {
      await environment.DB.prepare(`
        UPDATE transactions SET status = ?, is_shared = 0, splits = NULL, confirmed_at = ? WHERE id = ?
      `).bind(TransactionStatus.PERSONAL, new Date().toISOString(), transactionId).run();

      // Store embedding for semantic search
      await storeTransactionEmbedding(transactionId, environment);

      await editMessageText(
        chatId,
        messageId,
        messageText + '\n\n👤 *Marked as personal*',
        environment.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case 'delete': {
      await environment.DB.prepare(`
        UPDATE transactions SET status = ? WHERE id = ?
      `).bind(TransactionStatus.DELETED, transactionId).run();

      // Delete embedding
      await deleteTransactionEmbedding(transactionId, environment);

      await deleteMessage(chatId, messageId, environment.TELEGRAM_BOT_TOKEN);
      break;
    }

    case 'edit': {
      await sendMessage(
        chatId,
        '✏️ *What do you want to edit?*',
        environment.TELEGRAM_BOT_TOKEN,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💰 Amount', callback_data: `txe_amt_${transactionId}` },
                { text: '📍 Merchant', callback_data: `txe_mrc_${transactionId}` },
              ],
              [
                { text: '🏷️ Category', callback_data: `txe_cat_${transactionId}` },
                { text: '👥 Split', callback_data: `txe_spl_${transactionId}` },
              ],
              [{ text: '❌ Cancel', callback_data: `txe_x_${transactionId}` }],
            ],
          },
        }
      );
      break;
    }
  }
}

// ============================================
// Embedding Helpers
// ============================================

async function storeTransactionEmbedding(
  transactionId: string,
  environment: Environment
): Promise<void> {
  try {
    // Fetch transaction data
    const row = await environment.DB.prepare(`
      SELECT id, merchant, amount, category, currency, location
      FROM transactions WHERE id = ?
    `).bind(transactionId).first();

    if (row == null) {
      console.error(`[Embedding] Transaction not found: ${transactionId}`);
      return;
    }

    const embeddingService = new EmbeddingService(environment);
    await embeddingService.storeTransaction({
      id: row.id as string,
      merchant: row.merchant as string,
      amount: row.amount as number,
      category: row.category as string,
      currency: row.currency as string,
      location: row.location as string | undefined,
    });
  } catch (error) {
    // Don't fail the confirmation if embedding fails
    console.error('[Embedding] Failed to store embedding:', error);
  }
}

async function deleteTransactionEmbedding(
  transactionId: string,
  environment: Environment
): Promise<void> {
  try {
    const embeddingService = new EmbeddingService(environment);
    await embeddingService.deleteTransaction(transactionId);
  } catch (error) {
    console.error('[Embedding] Failed to delete embedding:', error);
  }
}
