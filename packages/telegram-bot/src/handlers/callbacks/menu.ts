/**
 * Menu and Project Callback Handlers
 */

import type { CallbackQuery, Environment } from '../../types.js';
import { sendMessage, editMessageText } from '../../telegram/api.js';
import { getOrCreateUser, getCurrentProject } from '../../db/index.js';
import { handleCommand } from '../commands/index.js';

export async function handleMenuCallbacks(
  query: CallbackQuery,
  subAction: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const telegramUser = query.from;

  switch (subAction) {
    case 'balance':
      await handleCommand('/b', chatId, telegramUser, environment);
      break;
    case 'settle':
      await handleCommand('/s', chatId, telegramUser, environment);
      break;
    case 'history':
      await handleCommand('/hi', chatId, telegramUser, environment);
      break;
    case 'cards':
      await handleCommand('/cards', chatId, telegramUser, environment);
      break;
    case 'help':
      await handleCommand('/h', chatId, telegramUser, environment);
      break;
    case 'projects':
      await sendMessage(chatId, '📁 *Project Management*', environment.TELEGRAM_BOT_TOKEN, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 My Projects', callback_data: 'proj_list' },
              { text: '🔄 Switch', callback_data: 'proj_switch' },
            ],
            [
              { text: '➕ New', callback_data: 'proj_new' },
              { text: '🔗 Join', callback_data: 'proj_join' },
            ],
            [
              { text: '📎 Invite', callback_data: 'proj_invite' },
              { text: '⚙️ Settings', callback_data: 'proj_settings' },
            ],
            [
              { text: '📦 Archive', callback_data: 'proj_archive' },
              { text: '⬅️ Back', callback_data: 'proj_back' },
            ],
          ],
        },
      });
      break;
  }
}

export async function handleProjectCallbacks(
  query: CallbackQuery,
  subAction: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const telegramUser = query.from;

  switch (subAction) {
    case 'list':
      await handleCommand('/p', chatId, telegramUser, environment);
      break;
    case 'switch':
      await handleCommand('/switch', chatId, telegramUser, environment);
      break;
    case 'invite':
      await handleCommand('/invite', chatId, telegramUser, environment);
      break;
    case 'new':
      await sendMessage(chatId, '➕ *Create New Project*\n\nChoose a type:', environment.TELEGRAM_BOT_TOKEN, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📅 Monthly (Current Month)', callback_data: 'newproj_monthly' }],
            [{ text: '✈️ Trip', callback_data: 'newproj_trip' }],
            [{ text: '📝 Custom', callback_data: 'newproj_custom' }],
          ],
        },
      });
      break;
    case 'join':
      await sendMessage(chatId, 'Join a project:\n`/join INVITE_CODE`', environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    case 'settings': {
      const user = await getOrCreateUser(environment, telegramUser);
      const project = await getCurrentProject(environment, user.id);
      if (project == null) {
        await sendMessage(chatId, '❌ No project selected.', environment.TELEGRAM_BOT_TOKEN);
        break;
      }
      await sendMessage(
        chatId,
        `⚙️ *${project.name} Settings*\n\n📍 Location: ${project.defaultLocation ?? 'Not set'}\n💱 Currency: ${project.defaultCurrency}`,
        environment.TELEGRAM_BOT_TOKEN,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📍 Set Location', callback_data: 'set_location' },
                { text: '💱 Set Currency', callback_data: 'set_currency' },
              ],
              [
                { text: '✏️ Rename', callback_data: 'set_rename' },
                { text: '🗑️ Delete', callback_data: 'set_delete' },
              ],
              [{ text: '⬅️ Back', callback_data: 'menu_projects' }],
            ],
          },
        }
      );
      break;
    }
    case 'archive':
      await handleCommand('/archive', chatId, telegramUser, environment);
      break;
    case 'back':
      await handleCommand('/m', chatId, telegramUser, environment);
      break;
  }
}

export async function handleSwitchCallback(
  query: CallbackQuery,
  projectId: string,
  environment: Environment
): Promise<void> {
  const userId = query.from.id;
  const chatId = query.message?.chat.id ?? 0;
  const messageId = query.message?.message_id ?? 0;

  await environment.DB.prepare(
    'UPDATE users SET current_project_id = ? WHERE id = ?'
  ).bind(projectId, userId).run();

  const switchedProject = await environment.DB.prepare(
    'SELECT name FROM projects WHERE id = ?'
  ).bind(projectId).first();

  await editMessageText(
    chatId,
    messageId,
    `📁 Switched to *${switchedProject?.name ?? 'project'}*`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}

// Pattern to match monthly project names like "Jan 2026", "Feb, 2026"
const MONTHLY_PROJECT_PATTERN = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec),?\s+\d{4}$/i;

export async function handleNewProjectCallbacks(
  query: CallbackQuery,
  projectType: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const telegramUser = query.from;

  switch (projectType) {
    case 'monthly': {
      const user = await getOrCreateUser(environment, telegramUser);

      // Find and archive previous monthly projects
      const userProjects = await environment.DB.prepare(`
        SELECT p.id, p.name FROM projects p
        JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = ? AND p.is_active = 1
      `).bind(user.id).all();

      const monthlyProjects = (userProjects.results ?? []).filter(
        p => MONTHLY_PROJECT_PATTERN.test(p.name as string)
      );

      // Archive all previous monthly projects
      const archivePromises = monthlyProjects.map(project =>
        environment.DB.prepare('UPDATE projects SET is_active = 0 WHERE id = ?')
          .bind(project.id)
          .run()
      );
      await Promise.all(archivePromises);

      const archivedNames = monthlyProjects.map(p => p.name as string);

      // Create new monthly project
      const now = new Date();
      const monthName = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      if (archivedNames.length > 0) {
        await sendMessage(
          chatId,
          `📦 Auto-archived: ${archivedNames.join(', ')}`,
          environment.TELEGRAM_BOT_TOKEN
        );
      }

      await handleCommand(`/new ${monthName}`, chatId, telegramUser, environment);
      break;
    }
    case 'trip':
      await sendMessage(chatId, '✈️ Enter trip name:\n`/new Japan Trip`', environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    case 'custom':
      await sendMessage(chatId, '📝 Enter project name:\n`/new Project Name`', environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
  }
}

export async function handleSettingsCallbacks(
  query: CallbackQuery,
  settingAction: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const telegramUser = query.from;

  switch (settingAction) {
    case 'location':
      await sendMessage(chatId, '📍 Set location:\n`/setlocation "City Name"`\nor `/setlocation clear`', environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    case 'currency':
      await sendMessage(chatId, '💱 Set currency:\n`/setcurrency USD`', environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    case 'rename':
      await sendMessage(chatId, '✏️ Rename project:\n`/rename "New Name"`', environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    case 'delete':
      await handleCommand('/deleteproject', chatId, telegramUser, environment);
      break;
  }
}
