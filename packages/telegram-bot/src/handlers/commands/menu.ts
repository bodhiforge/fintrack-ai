/**
 * Menu and Help Command Handlers
 */

import type { CommandHandlerContext } from './index.js';
import { sendMessage } from '../../telegram/api.js';
import { getUserCards } from '../../db/index.js';

export async function handleMenu(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, project, environment } = context;

  // Check if user has cards
  const userCards = await getUserCards(environment, user.id);
  const hasCards = userCards.length > 0;

  if (project != null) {
    // User has a project - show main menu
    const cardPrompt = hasCards
      ? '💳 Cards'
      : '💳 Add Cards ⚡';

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
              { text: cardPrompt, callback_data: 'menu_cards' },
              { text: '❓ Help', callback_data: 'menu_help' },
            ],
          ],
        },
      }
    );
  } else {
    // No project - show onboarding
    await sendOnboarding(chatId, user.firstName ?? 'there', environment);
  }
}

async function sendOnboarding(
  chatId: number,
  firstName: string,
  environment: { readonly TELEGRAM_BOT_TOKEN: string }
): Promise<void> {
  const welcomeMessage = [
    `👋 *Welcome, ${firstName}!*`,
    '',
    "I'm FinTrack AI - your smart expense tracker.",
    '',
    '*What I can do:*',
    '• 📝 Track expenses via text or voice 🎤',
    '• 💳 Recommend the best card to maximize rewards',
    '• 👥 Split expenses with friends',
    '• 📊 Track who owes what automatically',
    '',
    '*Get started:*',
  ].join('\n');

  await sendMessage(chatId, welcomeMessage, environment.TELEGRAM_BOT_TOKEN, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '➕ Create Project', callback_data: 'onboard_new' },
          { text: '🔗 Join Project', callback_data: 'onboard_join' },
        ],
      ],
    },
  });
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
    '/undo - Undo last',
    '',
    '*Project:*',
    '/new <name> - Create',
    '/join <code> - Join',
    '',
    '*Track Expenses:*',
    'Text or voice 🎤',
    '',
    '_Examples:_',
    '"lunch 50 McDonald\'s"',
    '"dinner 120, exclude Bob"',
  ].join('\n');

  await sendMessage(chatId, helpText, environment.TELEGRAM_BOT_TOKEN, {
    parse_mode: 'Markdown',
  });
}
