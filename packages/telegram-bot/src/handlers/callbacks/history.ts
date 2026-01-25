/**
 * History Callback Handlers
 */

import type { CallbackQuery, Environment } from '../../types.js';
import { sendMessage } from '../../telegram/api.js';
import { getOrCreateUser, getCurrentProject } from '../../db/index.js';
import { handleHistory } from '../commands/balance.js';

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

    await handleHistory(
      { chatId, user, project, environment, args: [], telegramUser },
      page
    );
    return;
  }

  // Handle edit prompt: hist_edit_<txIds>
  if (actionId.startsWith('edit_')) {
    const txIds = actionId.replace('edit_', '').split(',');

    await sendMessage(
      chatId,
      [
        '✏️ *Edit Transaction*',
        '',
        `Reply with the number (1-${txIds.length}) to edit:`,
        '',
        '_Example: Send "1" to edit the first transaction_',
      ].join('\n'),
      environment.TELEGRAM_BOT_TOKEN,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            txIds.slice(0, 5).map((id, i) => ({
              text: `${i + 1}`,
              callback_data: `edit_${id}`,
            })),
            ...(txIds.length > 5
              ? [
                  txIds.slice(5, 10).map((id, i) => ({
                    text: `${i + 6}`,
                    callback_data: `edit_${id}`,
                  })),
                ]
              : []),
          ],
        },
      }
    );
  }
}
