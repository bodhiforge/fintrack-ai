/**
 * Menu and Help Command Handlers
 */

import type { CommandHandlerContext } from './index.js';
import { sendMessage } from '../../telegram/api.js';

export async function handleMenu(context: CommandHandlerContext): Promise<void> {
  const { chatId, project, environment } = context;

  if (project != null) {
    await sendMessage(
      chatId,
      `📁 *${project.name}*\n\nSend a message to track expenses, or tap a button:`,
      environment.TELEGRAM_BOT_TOKEN,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📊 Balance', callback_data: 'menu_balance' },
              { text: '💸 Settle', callback_data: 'menu_settle' },
              { text: '📜 History', callback_data: 'menu_history' },
            ],
            [
              { text: '📁 Projects', callback_data: 'menu_projects' },
              { text: '💳 Cards', callback_data: 'menu_cards' },
              { text: '❓ Help', callback_data: 'menu_help' },
            ],
          ],
        },
      }
    );
  } else {
    await sendMessage(
      chatId,
      `📁 *No Project*\n\nCreate or join a project to start tracking:`,
      environment.TELEGRAM_BOT_TOKEN,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ New Project', callback_data: 'proj_new' },
              { text: '🔗 Join Project', callback_data: 'proj_join' },
            ],
            [
              { text: '📋 My Projects', callback_data: 'proj_list' },
              { text: '❓ Help', callback_data: 'menu_help' },
            ],
          ],
        },
      }
    );
  }
}

export async function handleHelp(context: CommandHandlerContext): Promise<void> {
  const { chatId, environment } = context;

  const helpText = [
    '*Quick Commands:*',
    '/m - Menu',
    '/b - Balance',
    '/s - Settle',
    '/hi - History',
    '/p - Projects',
    '',
    '*Project Management:*',
    '/new <name> - Create project',
    '/join <code> - Join project',
    '',
    '*Track Expenses:*',
    'Just send a message!',
    '"lunch 50 McDonald\'s"',
    '"Costco 150"',
  ].join('\n');

  await sendMessage(chatId, helpText, environment.TELEGRAM_BOT_TOKEN, {
    parse_mode: 'Markdown',
  });
}
