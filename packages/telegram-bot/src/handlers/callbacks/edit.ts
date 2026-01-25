/**
 * Transaction Edit Callback Handlers
 */

import type { CallbackQuery, Environment } from '../../types.js';
import { sendMessage, editMessageText, deleteMessage } from '../../telegram/api.js';
import { getOrCreateUser, getCurrentProject } from '../../db/index.js';

const CATEGORIES = [
  'dining', 'grocery', 'gas', 'shopping', 'subscription',
  'travel', 'transport', 'entertainment', 'health', 'utilities',
  'sports', 'education', 'other',
] as const;

function chunkArray<T>(array: readonly T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(array.length / size) },
    (_, index) => array.slice(index * size, (index + 1) * size) as T[]
  );
}

export async function handleEditCallbacks(
  query: CallbackQuery,
  idPart: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const underscoreIndex = idPart.indexOf('_');
  const field = idPart.substring(0, underscoreIndex);
  const transactionId = idPart.substring(underscoreIndex + 1);

  const user = await getOrCreateUser(environment, query.from);
  const project = await getCurrentProject(environment, user.id);

  if (project == null) {
    await sendMessage(chatId, '📁 No project selected.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const transaction = await environment.DB.prepare(
    'SELECT id FROM transactions WHERE id = ? AND project_id = ?'
  ).bind(transactionId, project.id).first();

  if (transaction == null) {
    await sendMessage(chatId, '❌ Transaction not found or no permission.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (field === 'x') {
    await deleteMessage(chatId, query.message?.message_id ?? 0, environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (field === 'cat') {
    const categoryButtons = CATEGORIES.map(category => ({
      text: category,
      callback_data: `txc_${category}_${transactionId}`,
    }));
    const keyboard = chunkArray(categoryButtons, 3);

    await sendMessage(chatId, '🏷️ Select category:', environment.TELEGRAM_BOT_TOKEN, {
      reply_markup: { inline_keyboard: keyboard },
    });
  } else {
    const prompts: Record<string, string> = {
      amt: '💰 Reply with the new amount (e.g., 50.00):',
      mrc: '📍 Reply with the new merchant name:',
      spl: '👥 Reply with split (e.g., "Bodhi 30, Sherry 20" or "equal"):',
    };

    await sendMessage(
      chatId,
      `${prompts[field]}\n\n_Transaction ID: ${transactionId}_`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
  }
}

export async function handleCategoryCallback(
  query: CallbackQuery,
  idPart: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const underscoreIndex = idPart.indexOf('_');
  const category = idPart.substring(0, underscoreIndex);
  const transactionId = idPart.substring(underscoreIndex + 1);

  const user = await getOrCreateUser(environment, query.from);
  const project = await getCurrentProject(environment, user.id);

  if (project == null) {
    await sendMessage(chatId, '📁 No project selected.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const transaction = await environment.DB.prepare(
    'SELECT id FROM transactions WHERE id = ? AND project_id = ?'
  ).bind(transactionId, project.id).first();

  if (transaction == null) {
    await sendMessage(chatId, '❌ Transaction not found or no permission.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  await environment.DB.prepare(
    'UPDATE transactions SET category = ? WHERE id = ?'
  ).bind(category, transactionId).run();

  await editMessageText(
    chatId,
    query.message?.message_id ?? 0,
    `✅ Category updated to *${category}*`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}
