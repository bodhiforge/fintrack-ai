/**
 * History Callback Handlers
 */

import type { CallbackQuery, Environment } from '../../types.js';
import { sendMessage } from '../../telegram/api.js';
import { getOrCreateUser, getCurrentProject } from '../../db/index.js';
import { handleHistoryPage } from '../commands/balance.js';
import { TransactionStatus } from '../../constants.js';

export async function handleHistoryCallbacks(
  query: CallbackQuery,
  actionId: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const telegramUser = query.from;

  // Handle pagination: hist_0, hist_1, etc.
  if (/^\d+$/.test(actionId)) {
    const page = parseInt(actionId, 10);
    const user = await getOrCreateUser(environment, telegramUser);
    const project = await getCurrentProject(environment, user.id);

    await handleHistoryPage(
      { chatId, user, project, environment, args: [], telegramUser },
      page
    );
    return;
  }

  // Handle edit prompt: hist_edit_<page>
  if (actionId.startsWith('edit_')) {
    const page = parseInt(actionId.replace('edit_', ''), 10) || 0;
    const user = await getOrCreateUser(environment, telegramUser);
    const project = await getCurrentProject(environment, user.id);

    if (project == null) {
      await sendMessage(chatId, '❌ No project selected.', environment.TELEGRAM_BOT_TOKEN);
      return;
    }

    // Re-fetch transactions for this page
    const pageSize = 10;
    const offset = page * pageSize;
    const rows = await environment.DB.prepare(`
      SELECT id, merchant, amount FROM transactions
      WHERE project_id = ? AND status IN (?, ?)
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(project.id, TransactionStatus.CONFIRMED, TransactionStatus.PERSONAL, pageSize, offset).all();

    if (rows.results == null || rows.results.length === 0) {
      await sendMessage(chatId, '❌ No transactions found.', environment.TELEGRAM_BOT_TOKEN);
      return;
    }

    // Create buttons in rows of 5
    const buttonRows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < rows.results.length; i += 5) {
      buttonRows.push(
        rows.results.slice(i, i + 5).map((row: Record<string, unknown>, j: number) => ({
          text: `${offset + i + j + 1}`,
          callback_data: `edit_${row.id as string}`,
        }))
      );
    }

    await sendMessage(
      chatId,
      '✏️ *Select transaction to edit:*',
      environment.TELEGRAM_BOT_TOKEN,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttonRows },
      }
    );
  }
}
