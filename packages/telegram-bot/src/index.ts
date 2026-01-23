/**
 * Telegram Bot Worker for FinTrack AI
 * Handles incoming messages and callback queries
 */

import {
  TransactionParser,
  splitExpense,
  checkCardStrategy,
  formatStrategyResult,
  parseNaturalLanguageSplit,
  calculateBalances,
  simplifyDebts,
  formatSettlements,
  type Transaction,
  type Category,
  type Currency,
  type User,
  type Project,
} from '@fintrack-ai/core';

// ============================================
// Types
// ============================================

interface Env {
  OPENAI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_CHAT_ID?: string;
  DEFAULT_PARTICIPANTS?: string;
  DB: D1Database;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: { file_id: string };
  photo?: Array<{ file_id: string }>;
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup';
  title?: string;
}

interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

// ============================================
// Main Handler
// ============================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    }

    // Debug endpoint - test sending a message
    if (url.pathname === '/debug') {
      const hasToken = !!env.TELEGRAM_BOT_TOKEN;
      const hasOpenAI = !!env.OPENAI_API_KEY;
      const chatId = env.TELEGRAM_CHAT_ID || '7511659357';

      let result = `Token: ${hasToken}, OpenAI: ${hasOpenAI}, ChatID: ${chatId}\n`;

      try {
        const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '🔧 Debug: Worker is working!',
          }),
        });
        const data = await resp.json();
        result += `Telegram response: ${JSON.stringify(data)}`;
      } catch (e) {
        result += `Error: ${e}`;
      }

      return new Response(result, { status: 200 });
    }

    // Webhook endpoint
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update: TelegramUpdate = await request.json();
        await handleUpdate(update, env);
        return new Response('OK', { status: 200 });
      } catch (error) {
        console.error('Webhook error:', error);
        return new Response('Error', { status: 500 });
      }
    }

    // Setup webhook endpoint
    if (url.pathname === '/setup-webhook') {
      const webhookUrl = `${url.origin}/webhook`;
      const result = await setWebhook(env.TELEGRAM_BOT_TOKEN, webhookUrl);
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

// ============================================
// Access Control
// ============================================

const ALLOWED_USERS = [
  7511659357,  // Bodhi
  5347556412,  // Sherry
];

// ============================================
// Database Helpers
// ============================================

function rowToTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    date: row.created_at as string,
    merchant: row.merchant as string,
    amount: row.amount as number,
    currency: row.currency as Currency,
    category: row.category as Category,
    location: row.location as string | undefined,
    cardLastFour: (row.card_last_four as string) || '',
    payer: row.payer as string,
    isShared: row.is_shared === 1,
    splits: row.splits ? JSON.parse(row.splits as string) : {},
    createdAt: row.created_at as string,
    confirmedAt: row.confirmed_at as string,
  };
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as number,
    username: row.username as string | undefined,
    firstName: row.first_name as string | undefined,
    currentProjectId: row.current_project_id as string | undefined,
    createdAt: row.created_at as string,
  };
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as 'ongoing' | 'trip' | 'event',
    defaultCurrency: row.default_currency as Currency,
    defaultLocation: row.default_location as string | undefined,
    inviteCode: row.invite_code as string | undefined,
    inviteExpiresAt: row.invite_expires_at as string | undefined,
    ownerId: row.owner_id as number,
    isActive: row.is_active === 1,
    startDate: row.start_date as string | undefined,
    endDate: row.end_date as string | undefined,
    createdAt: row.created_at as string,
  };
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function getOrCreateUser(env: Env, telegramUser: TelegramUser): Promise<User> {
  const existing = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(telegramUser.id).first();

  if (existing) {
    return rowToUser(existing as Record<string, unknown>);
  }

  // Create new user with default project
  await env.DB.prepare(`
    INSERT INTO users (id, username, first_name, current_project_id, created_at)
    VALUES (?, ?, ?, 'default', ?)
  `).bind(
    telegramUser.id,
    telegramUser.username || null,
    telegramUser.first_name,
    new Date().toISOString()
  ).run();

  // Add to default project
  await env.DB.prepare(`
    INSERT OR IGNORE INTO project_members (project_id, user_id, display_name, role, joined_at)
    VALUES ('default', ?, ?, 'member', ?)
  `).bind(telegramUser.id, telegramUser.first_name, new Date().toISOString()).run();

  return {
    id: telegramUser.id,
    username: telegramUser.username,
    firstName: telegramUser.first_name,
    currentProjectId: 'default',
    createdAt: new Date().toISOString(),
  };
}

async function getCurrentProject(env: Env, userId: number): Promise<Project | null> {
  const user = await env.DB.prepare(
    'SELECT current_project_id FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user || !user.current_project_id) return null;

  const project = await env.DB.prepare(
    'SELECT * FROM projects WHERE id = ?'
  ).bind(user.current_project_id).first();

  return project ? rowToProject(project as Record<string, unknown>) : null;
}

async function getProjectMembers(env: Env, projectId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    'SELECT display_name FROM project_members WHERE project_id = ?'
  ).bind(projectId).all();

  return rows.results?.map((r) => (r as Record<string, unknown>).display_name as string) ?? [];
}

// ============================================
// Update Handler
// ============================================

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  // Check whitelist
  const userId = update.message?.from?.id || update.callback_query?.from?.id;
  if (userId && !ALLOWED_USERS.includes(userId)) {
    const chatId = update.message?.chat.id || update.callback_query?.message?.chat.id;
    if (chatId) {
      await sendMessage(chatId, '🔒 Sorry, this is a private bot.', env.TELEGRAM_BOT_TOKEN);
    }
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
    return;
  }

  if (update.message?.text) {
    await handleTextMessage(update.message, env);
    return;
  }

  // TODO: Handle voice messages (Whisper API)
  // TODO: Handle photo messages (receipt OCR)
}

// ============================================
// Text Message Handler
// ============================================

async function handleTextMessage(
  message: TelegramMessage,
  env: Env
): Promise<void> {
  const text = message.text ?? '';
  const chatId = message.chat.id;
  const telegramUser = message.from;

  if (!telegramUser) return;

  // Command handling
  if (text.startsWith('/')) {
    await handleCommand(text, chatId, telegramUser, env);
    return;
  }

  // Get or create user and their current project
  const user = await getOrCreateUser(env, telegramUser);
  const project = await getCurrentProject(env, user.id);
  const userName = user.firstName ?? 'User';

  // Check if user has a project
  if (!project) {
    await sendMessage(
      chatId,
      `📁 No project selected.\n\nCreate one with /new or join with /join`,
      env.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  // Parse as expense
  try {
    const parser = new TransactionParser(env.OPENAI_API_KEY);
    const { parsed, confidence, warnings } = await parser.parseNaturalLanguage(text);

    // Check card strategy
    const strategyResult = checkCardStrategy(parsed);

    // Get participants from project members
    const participants = project
      ? await getProjectMembers(env, project.id)
      : [userName, 'Sherry'];

    // Parse any split modifiers from the text
    const splitMods = parseNaturalLanguageSplit(text, participants);

    // Calculate split
    const splitResult = splitExpense({
      totalAmount: parsed.amount,
      currency: parsed.currency,
      payer: userName,
      participants,
      excludedParticipants: splitMods.excludedParticipants,
    });

    // Save pending transaction to D1 with project_id
    // Use parsed location if available, otherwise fall back to project default
    const location = parsed.location ?? project?.defaultLocation ?? null;
    const txId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO transactions (id, project_id, user_id, chat_id, merchant, amount, currency, category, location, card_last_four, payer, is_shared, splits, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      txId,
      project?.id ?? 'default',
      user.id,
      chatId,
      parsed.merchant,
      parsed.amount,
      parsed.currency,
      parsed.category,
      location,
      parsed.cardLastFour || null,
      userName,
      1,
      JSON.stringify(splitResult.shares),
      new Date().toISOString()
    ).run();

    // Build response message
    let response = `💳 *New Transaction*\n`;
    if (project && project.id !== 'default') {
      response += `📁 _${project.name}_\n`;
    }
    response += `\n📍 ${parsed.merchant}`;
    if (location) {
      response += ` (${location})`;
    }
    response += `\n💰 $${parsed.amount.toFixed(2)} ${parsed.currency}\n`;
    response += `🏷️ ${parsed.category}\n`;
    response += `📅 ${parsed.date}\n\n`;

    // Split info
    response += `*Split:*\n`;
    Object.entries(splitResult.shares).forEach(([person, share]) => {
      response += `  ${person}: $${share.toFixed(2)}\n`;
    });

    response += `\n${formatStrategyResult(strategyResult)}`;

    if (warnings && warnings.length > 0) {
      response += `\n\n⚠️ ${warnings.join(', ')}`;
    }

    if (confidence < 1) {
      response += `\n\n_Confidence: ${(confidence * 100).toFixed(0)}%_`;
    }

    // Send with inline keyboard (use txId for callbacks)
    await sendMessage(chatId, response, env.TELEGRAM_BOT_TOKEN, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm', callback_data: `confirm_${txId}` },
            { text: '👤 Personal', callback_data: `personal_${txId}` },
          ],
          [
            { text: '✏️ Edit', callback_data: `edit_${txId}` },
            { text: '❌ Delete', callback_data: `delete_${txId}` },
          ],
        ],
      },
    });
  } catch (error) {
    console.error('Parse error:', error);
    await sendMessage(
      chatId,
      `❌ Failed to parse: ${error instanceof Error ? error.message : 'Unknown error'}`,
      env.TELEGRAM_BOT_TOKEN
    );
  }
}

// ============================================
// Command Handler
// ============================================

async function handleCommand(
  text: string,
  chatId: number,
  telegramUser: TelegramUser,
  env: Env
): Promise<void> {
  const [command, ...args] = text.split(' ');
  const user = await getOrCreateUser(env, telegramUser);
  const project = await getCurrentProject(env, user.id);

  switch (command) {
    case '/start':
    case '/menu':
    case '/m':
      if (project) {
        await sendMessage(
          chatId,
          `📁 *${project.name}*\n\nSend a message to track expenses, or tap a button:`,
          env.TELEGRAM_BOT_TOKEN,
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
          env.TELEGRAM_BOT_TOKEN,
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
      break;

    case '/help':
    case '/h':
      await sendMessage(
        chatId,
        `*Quick Commands:*\n/m - Menu\n/b - Balance\n/s - Settle\n/hi - History\n/p - Projects\n\n*Project Management:*\n/new <name> - Create project\n/join <code> - Join project\n\n*Track Expenses:*\nJust send a message!\n"lunch 50 McDonald's"\n"Costco 150"`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case '/newproject':
    case '/new': {
      const projectName = args.join(' ').replace(/"/g, '').trim();
      if (!projectName) {
        await sendMessage(chatId, '❌ Usage: /newproject "Project Name"', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      const projectId = crypto.randomUUID();

      await env.DB.prepare(`
        INSERT INTO projects (id, name, type, default_currency, owner_id, created_at)
        VALUES (?, ?, 'trip', 'CAD', ?, ?)
      `).bind(projectId, projectName, user.id, new Date().toISOString()).run();

      // Add owner as member
      await env.DB.prepare(`
        INSERT INTO project_members (project_id, user_id, display_name, role, joined_at)
        VALUES (?, ?, ?, 'owner', ?)
      `).bind(projectId, user.id, user.firstName ?? 'User', new Date().toISOString()).run();

      // Set as current project
      await env.DB.prepare(
        'UPDATE users SET current_project_id = ? WHERE id = ?'
      ).bind(projectId, user.id).run();

      await sendMessage(
        chatId,
        `✅ Created project *${projectName}*\n\nUse /invite to generate a share code when ready.`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/join': {
      const inviteCode = args[0]?.toUpperCase().trim();
      if (!inviteCode) {
        await sendMessage(chatId, '❌ Usage: /join <invite_code>', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      const projectToJoin = await env.DB.prepare(
        'SELECT * FROM projects WHERE invite_code = ?'
      ).bind(inviteCode).first();

      if (!projectToJoin) {
        await sendMessage(chatId, '❌ Invalid or expired invite code.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Check expiration
      if (projectToJoin.invite_expires_at) {
        const expiresAt = new Date(projectToJoin.invite_expires_at as string);
        if (expiresAt < new Date()) {
          await sendMessage(chatId, '❌ This invite code has expired. Ask the owner for a new one.', env.TELEGRAM_BOT_TOKEN);
          break;
        }
      }

      // Check if already member
      const existingMember = await env.DB.prepare(
        'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?'
      ).bind(projectToJoin.id, user.id).first();

      if (existingMember) {
        await sendMessage(chatId, `ℹ️ You're already in *${projectToJoin.name}*`, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
        break;
      }

      // Add as member
      await env.DB.prepare(`
        INSERT INTO project_members (project_id, user_id, display_name, role, joined_at)
        VALUES (?, ?, ?, 'member', ?)
      `).bind(projectToJoin.id, user.id, user.firstName ?? 'User', new Date().toISOString()).run();

      // Set as current project
      await env.DB.prepare(
        'UPDATE users SET current_project_id = ? WHERE id = ?'
      ).bind(projectToJoin.id, user.id).run();

      const members = await getProjectMembers(env, projectToJoin.id as string);
      await sendMessage(
        chatId,
        `✅ Joined *${projectToJoin.name}*!\n\nMembers: ${members.join(', ')}`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/switch': {
      // Get user's projects
      const userProjects = await env.DB.prepare(`
        SELECT p.* FROM projects p
        JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = ? AND p.is_active = 1
      `).bind(user.id).all();

      if (!userProjects.results || userProjects.results.length === 0) {
        await sendMessage(chatId, '📁 No projects found. Create one with /newproject', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      const keyboard = userProjects.results.map((p) => [{
        text: `${p.id === project?.id ? '✓ ' : ''}${p.name}`,
        callback_data: `switch_${p.id}`,
      }]);

      await sendMessage(chatId, '📁 *Select Project:*', env.TELEGRAM_BOT_TOKEN, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      });
      break;
    }

    case '/projects':
    case '/p': {
      const userProjects = await env.DB.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
          (SELECT COUNT(*) FROM transactions WHERE project_id = p.id AND status = 'confirmed') as tx_count
        FROM projects p
        JOIN project_members pm ON p.id = pm.project_id
        WHERE pm.user_id = ?
        ORDER BY p.is_active DESC, p.created_at DESC
      `).bind(user.id).all();

      if (!userProjects.results || userProjects.results.length === 0) {
        await sendMessage(chatId, '📁 No projects. Create one with /newproject', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      let msg = '📁 *My Projects*\n\n';
      for (const p of userProjects.results) {
        const current = p.id === project?.id ? ' ← current' : '';
        const archived = p.is_active === 0 ? ' 📦' : '';
        msg += `*${p.name}*${current}${archived}\n`;
        msg += `  👥 ${p.member_count} members | 📝 ${p.tx_count} transactions\n\n`;
      }
      msg += `_Use /invite to generate a share link_`;

      await sendMessage(chatId, msg, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

    case '/invite': {
      if (!project) {
        await sendMessage(chatId, '❌ No current project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      if (project.ownerId !== user.id) {
        await sendMessage(chatId, '❌ Only the project owner can generate invite codes.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Generate new invite code with 7-day expiration
      const newCode = generateInviteCode();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await env.DB.prepare(
        'UPDATE projects SET invite_code = ?, invite_expires_at = ? WHERE id = ?'
      ).bind(newCode, expiresAt, project.id).run();

      const expiryDate = new Date(expiresAt).toLocaleDateString('en-CA');
      await sendMessage(
        chatId,
        `📎 *${project.name}* invite code:\n\n\`${newCode}\`\n\n_Expires: ${expiryDate}_`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/leave': {
      if (!project) {
        await sendMessage(chatId, '❌ No current project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Check if user is owner
      if (project.ownerId === user.id) {
        await sendMessage(chatId, '❌ Owner cannot leave. Transfer ownership or /archive the project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Remove from project
      await env.DB.prepare(
        'DELETE FROM project_members WHERE project_id = ? AND user_id = ?'
      ).bind(project.id, user.id).run();

      // Clear current project
      await env.DB.prepare(
        'UPDATE users SET current_project_id = NULL WHERE id = ?'
      ).bind(user.id).run();

      await sendMessage(
        chatId,
        `👋 Left *${project.name}*.\n\nUse /p to see your projects or /new to create one.`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/archive': {
      if (!project) {
        await sendMessage(chatId, '❌ No current project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Check if user is owner
      if (project.ownerId !== user.id) {
        await sendMessage(chatId, '❌ Only the project owner can archive.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Archive the project
      await env.DB.prepare(
        'UPDATE projects SET is_active = 0 WHERE id = ?'
      ).bind(project.id).run();

      // Clear current project for all members
      await env.DB.prepare(`
        UPDATE users SET current_project_id = NULL
        WHERE current_project_id = ?
      `).bind(project.id).run();

      await sendMessage(
        chatId,
        `📦 Archived *${project.name}*.\n\nData preserved. Use /unarchive to restore.`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/unarchive': {
      // Find archived project by name
      const projectName = args.join(' ').replace(/"/g, '').trim();

      let targetProject;
      if (projectName) {
        // Search by name
        targetProject = await env.DB.prepare(`
          SELECT * FROM projects WHERE name = ? AND owner_id = ? AND is_active = 0
        `).bind(projectName, user.id).first();
      } else {
        // Show list of archived projects
        const archivedProjects = await env.DB.prepare(`
          SELECT name FROM projects WHERE owner_id = ? AND is_active = 0
        `).bind(user.id).all();

        if (!archivedProjects.results || archivedProjects.results.length === 0) {
          await sendMessage(chatId, '📦 No archived projects.', env.TELEGRAM_BOT_TOKEN);
          break;
        }

        const names = archivedProjects.results.map(p => `• ${p.name}`).join('\n');
        await sendMessage(chatId, `📦 *Archived Projects:*\n\n${names}\n\nUse: /unarchive "Project Name"`, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
        break;
      }

      if (!targetProject) {
        await sendMessage(chatId, '❌ Archived project not found.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      await env.DB.prepare(
        'UPDATE projects SET is_active = 1 WHERE id = ?'
      ).bind(targetProject.id).run();

      await env.DB.prepare(
        'UPDATE users SET current_project_id = ? WHERE id = ?'
      ).bind(targetProject.id, user.id).run();

      await sendMessage(
        chatId,
        `✅ Restored *${targetProject.name}*`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/deleteproject':
    case '/delproj': {
      if (!project) {
        await sendMessage(chatId, '❌ No current project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      if (project.ownerId !== user.id) {
        await sendMessage(chatId, '❌ Only the project owner can delete.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Check for confirmation flag
      const confirm = args[0]?.toLowerCase() === 'confirm';
      if (!confirm) {
        await sendMessage(
          chatId,
          `⚠️ *Delete ${project.name}?*\n\nThis will permanently delete:\n• All transactions\n• All member data\n\nType: /deleteproject confirm`,
          env.TELEGRAM_BOT_TOKEN,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      // Delete all related data
      await env.DB.prepare('DELETE FROM transactions WHERE project_id = ?').bind(project.id).run();
      await env.DB.prepare('DELETE FROM project_members WHERE project_id = ?').bind(project.id).run();

      // Clear current project for all members
      await env.DB.prepare(`
        UPDATE users SET current_project_id = NULL WHERE current_project_id = ?
      `).bind(project.id).run();

      // Delete project
      await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id).run();

      await sendMessage(
        chatId,
        `🗑️ Deleted *${project.name}*`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/rename': {
      const newName = args.join(' ').replace(/"/g, '').trim();
      if (!newName) {
        await sendMessage(chatId, '❌ Usage: /rename "New Name"', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      if (!project) {
        await sendMessage(chatId, '❌ No current project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Check if user is owner
      if (project.ownerId !== user.id) {
        await sendMessage(chatId, '❌ Only the project owner can rename.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      await env.DB.prepare(
        'UPDATE projects SET name = ? WHERE id = ?'
      ).bind(newName, project.id).run();

      await sendMessage(
        chatId,
        `✅ Renamed to *${newName}*`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/setlocation': {
      const newLocation = args.join(' ').replace(/"/g, '').trim();
      if (!newLocation) {
        await sendMessage(chatId, '❌ Usage: /setlocation "City" or /setlocation clear', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      if (!project) {
        await sendMessage(chatId, '❌ No current project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      if (project.ownerId !== user.id) {
        await sendMessage(chatId, '❌ Only the project owner can change settings.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      const locationValue = newLocation.toLowerCase() === 'clear' ? null : newLocation;
      await env.DB.prepare(
        'UPDATE projects SET default_location = ? WHERE id = ?'
      ).bind(locationValue, project.id).run();

      await sendMessage(
        chatId,
        locationValue
          ? `📍 Default location set to *${locationValue}*`
          : `📍 Default location cleared`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/setcurrency': {
      const newCurrency = args[0]?.toUpperCase().trim();
      if (!newCurrency) {
        await sendMessage(chatId, '❌ Usage: /setcurrency CAD|USD|EUR|...', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      if (!project) {
        await sendMessage(chatId, '❌ No current project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      if (project.ownerId !== user.id) {
        await sendMessage(chatId, '❌ Only the project owner can change settings.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      await env.DB.prepare(
        'UPDATE projects SET default_currency = ? WHERE id = ?'
      ).bind(newCurrency, project.id).run();

      await sendMessage(
        chatId,
        `💱 Default currency set to *${newCurrency}*`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/balance':
    case '/b': {
      const projectId = project?.id ?? 'default';
      const balanceRows = await env.DB.prepare(`
        SELECT * FROM transactions
        WHERE project_id = ? AND status = 'confirmed' AND is_shared = 1
          AND created_at > datetime('now', '-30 days')
        ORDER BY created_at DESC
        LIMIT 200
      `).bind(projectId).all();

      if (!balanceRows.results || balanceRows.results.length === 0) {
        await sendMessage(chatId, `📊 No confirmed expenses in *${project?.name ?? 'Daily'}*`, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
        break;
      }

      const transactions = balanceRows.results.map((row) => rowToTransaction(row as Record<string, unknown>));

      // Group transactions by currency
      const byCurrency: Record<string, Transaction[]> = {};
      for (const tx of transactions) {
        const curr = tx.currency;
        if (!byCurrency[curr]) byCurrency[curr] = [];
        byCurrency[curr].push(tx);
      }

      let balanceMsg = `📊 *${project?.name ?? 'Daily'} Balances*\n`;
      let hasAnyBalance = false;

      for (const [currency, txns] of Object.entries(byCurrency)) {
        const balances = calculateBalances(txns);
        if (balances.length === 0) continue;

        hasAnyBalance = true;
        balanceMsg += `\n*${currency}:*\n`;
        balances.forEach((b) => {
          const emoji = b.netBalance > 0 ? '💚' : '🔴';
          const status = b.netBalance > 0 ? 'is owed' : 'owes';
          balanceMsg += `${emoji} ${b.person} ${status} $${Math.abs(b.netBalance).toFixed(2)}\n`;
        });
      }

      if (!hasAnyBalance) {
        await sendMessage(chatId, '📊 All balanced! No one owes anything.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      await sendMessage(chatId, balanceMsg, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

    case '/settle':
    case '/s': {
      const projectId = project?.id ?? 'default';
      const settleRows = await env.DB.prepare(`
        SELECT * FROM transactions
        WHERE project_id = ? AND status = 'confirmed' AND is_shared = 1
          AND created_at > datetime('now', '-30 days')
        ORDER BY created_at DESC
        LIMIT 200
      `).bind(projectId).all();

      if (!settleRows.results || settleRows.results.length === 0) {
        await sendMessage(chatId, `💸 No expenses to settle in *${project?.name ?? 'Daily'}*`, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
        break;
      }

      const allTxns = settleRows.results.map((row) => rowToTransaction(row as Record<string, unknown>));

      // Group by currency
      const byCurrency: Record<string, Transaction[]> = {};
      for (const tx of allTxns) {
        const curr = tx.currency;
        if (!byCurrency[curr]) byCurrency[curr] = [];
        byCurrency[curr].push(tx);
      }

      let settleMsg = `💸 *${project?.name ?? 'Daily'} Settlement*\n`;
      let hasAnySettlement = false;

      for (const [currency, txns] of Object.entries(byCurrency)) {
        const settlements = simplifyDebts(txns, currency);
        if (settlements.length === 0) continue;

        hasAnySettlement = true;
        settleMsg += `\n*${currency}:*\n`;
        settleMsg += formatSettlements(settlements);
      }

      if (!hasAnySettlement) {
        await sendMessage(chatId, '💸 All settled! No payments needed.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      await sendMessage(chatId, settleMsg, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

    case '/history':
    case '/hi': {
      const projectId = project?.id ?? 'default';
      const historyRows = await env.DB.prepare(`
        SELECT * FROM transactions
        WHERE project_id = ? AND status IN ('confirmed', 'personal')
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(projectId).all();

      if (!historyRows.results || historyRows.results.length === 0) {
        await sendMessage(chatId, `📜 No history in *${project?.name ?? 'Daily'}*`, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
        break;
      }

      let historyMsg = `📜 *${project?.name ?? 'Daily'} History*\n\n`;
      historyRows.results.forEach((row: Record<string, unknown>) => {
        const date = new Date(row.created_at as string).toLocaleDateString('en-CA');
        const status = row.status === 'personal' ? '👤' : '✅';
        historyMsg += `${status} ${date} | ${row.merchant} | $${(row.amount as number).toFixed(2)}\n`;
      });

      await sendMessage(chatId, historyMsg, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

    case '/cards':
      await sendMessage(
        chatId,
        `*Configured Cards:*\n\n💳 Amex Cobalt - Dining, Grocery (5x)\n💳 Rogers WE MC - Costco, Foreign (No FX)\n💳 TD CB Visa - Gas (3%)`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    // Transaction edit commands
    case '/editamount': {
      const [txId, ...amountParts] = args;
      const newAmount = parseFloat(amountParts.join(''));
      if (!txId || isNaN(newAmount)) {
        await sendMessage(chatId, '❌ Usage: /editamount <txId> <amount>', env.TELEGRAM_BOT_TOKEN);
        break;
      }
      await env.DB.prepare('UPDATE transactions SET amount = ? WHERE id = ?').bind(newAmount, txId).run();
      await sendMessage(chatId, `✅ Amount updated to $${newAmount.toFixed(2)}`, env.TELEGRAM_BOT_TOKEN);
      break;
    }

    case '/editmerchant': {
      const [txId, ...merchantParts] = args;
      const newMerchant = merchantParts.join(' ').replace(/"/g, '').trim();
      if (!txId || !newMerchant) {
        await sendMessage(chatId, '❌ Usage: /editmerchant <txId> <name>', env.TELEGRAM_BOT_TOKEN);
        break;
      }
      await env.DB.prepare('UPDATE transactions SET merchant = ? WHERE id = ?').bind(newMerchant, txId).run();
      await sendMessage(chatId, `✅ Merchant updated to *${newMerchant}*`, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

    case '/editsplit': {
      const [txId, ...splitParts] = args;
      const splitText = splitParts.join(' ').trim();
      if (!txId || !splitText) {
        await sendMessage(chatId, '❌ Usage: /editsplit <txId> <splits>\nExample: /editsplit abc123 Bodhi 30, Sherry 20', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      // Parse split text: "Bodhi 30, Sherry 20" or "equal"
      const tx = await env.DB.prepare('SELECT * FROM transactions WHERE id = ?').bind(txId).first();
      if (!tx) {
        await sendMessage(chatId, '❌ Transaction not found.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      let newSplits: Record<string, number> = {};
      if (splitText.toLowerCase() === 'equal') {
        const members = project ? await getProjectMembers(env, project.id) : [user.firstName ?? 'User', 'Sherry'];
        const share = (tx.amount as number) / members.length;
        members.forEach(m => { newSplits[m] = Math.round(share * 100) / 100; });
      } else {
        // Parse "Name Amount, Name Amount"
        const parts = splitText.split(',').map(p => p.trim());
        for (const part of parts) {
          const match = part.match(/^(.+?)\s+([\d.]+)$/);
          if (match) {
            newSplits[match[1].trim()] = parseFloat(match[2]);
          }
        }
      }

      if (Object.keys(newSplits).length === 0) {
        await sendMessage(chatId, '❌ Could not parse splits. Use format: "Bodhi 30, Sherry 20"', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      await env.DB.prepare('UPDATE transactions SET splits = ? WHERE id = ?').bind(JSON.stringify(newSplits), txId).run();
      const splitDisplay = Object.entries(newSplits).map(([n, a]) => `${n}: $${a.toFixed(2)}`).join(', ');
      await sendMessage(chatId, `✅ Split updated: ${splitDisplay}`, env.TELEGRAM_BOT_TOKEN);
      break;
    }

    default:
      await sendMessage(
        chatId,
        `Unknown command. Try /help`,
        env.TELEGRAM_BOT_TOKEN
      );
  }
}

// ============================================
// Callback Query Handler
// ============================================

async function handleCallbackQuery(
  query: CallbackQuery,
  env: Env
): Promise<void> {
  const data = query.data ?? '';
  const [action, id] = data.split('_'); // id can be txId, projectId, or subAction

  // Acknowledge the callback
  await answerCallbackQuery(query.id, env.TELEGRAM_BOT_TOKEN);

  switch (action) {
    case 'confirm':
      // Update transaction status to confirmed
      await env.DB.prepare(`
        UPDATE transactions SET status = 'confirmed', confirmed_at = ? WHERE id = ?
      `).bind(new Date().toISOString(), id).run();

      await editMessageText(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        query.message?.text + '\n\n✅ *Confirmed*',
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'personal':
      // Update to personal (not shared)
      await env.DB.prepare(`
        UPDATE transactions SET status = 'personal', is_shared = 0, splits = NULL, confirmed_at = ? WHERE id = ?
      `).bind(new Date().toISOString(), id).run();

      await editMessageText(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        query.message?.text + '\n\n👤 *Marked as personal*',
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;

    case 'delete':
      // Mark as deleted in database
      await env.DB.prepare(`
        UPDATE transactions SET status = 'deleted' WHERE id = ?
      `).bind(id).run();

      await deleteMessage(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        env.TELEGRAM_BOT_TOKEN
      );
      break;

    case 'edit': {
      // Show edit options for transaction
      const txId = id;
      await sendMessage(
        query.message?.chat.id ?? 0,
        '✏️ *What do you want to edit?*',
        env.TELEGRAM_BOT_TOKEN,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💰 Amount', callback_data: `txedit_amount_${txId}` },
                { text: '📍 Merchant', callback_data: `txedit_merchant_${txId}` },
              ],
              [
                { text: '🏷️ Category', callback_data: `txedit_category_${txId}` },
                { text: '👥 Split', callback_data: `txedit_split_${txId}` },
              ],
              [{ text: '❌ Cancel', callback_data: `txedit_cancel_${txId}` }],
            ],
          },
        }
      );
      break;
    }

    // Menu callbacks - redirect to command handlers
    case 'menu': {
      const chatId = query.message?.chat.id ?? 0;
      const telegramUser = query.from;
      const subAction = id;

      // Simulate command execution
      switch (subAction) {
        case 'balance':
          await handleCommand('/b', chatId, telegramUser, env);
          break;
        case 'settle':
          await handleCommand('/s', chatId, telegramUser, env);
          break;
        case 'history':
          await handleCommand('/hi', chatId, telegramUser, env);
          break;
        case 'cards':
          await handleCommand('/cards', chatId, telegramUser, env);
          break;
        case 'help':
          await handleCommand('/h', chatId, telegramUser, env);
          break;
        case 'projects':
          // Show project sub-menu
          await sendMessage(chatId, '📁 *Project Management*', env.TELEGRAM_BOT_TOKEN, {
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
      break;
    }

    case 'proj': {
      const chatId = query.message?.chat.id ?? 0;
      const telegramUser = query.from;
      const subAction = id;

      switch (subAction) {
        case 'list':
          await handleCommand('/p', chatId, telegramUser, env);
          break;
        case 'switch':
          await handleCommand('/switch', chatId, telegramUser, env);
          break;
        case 'invite':
          await handleCommand('/invite', chatId, telegramUser, env);
          break;
        case 'new':
          await sendMessage(chatId, 'Create a project:\n`/new Project Name`', env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
          break;
        case 'join':
          await sendMessage(chatId, 'Join a project:\n`/join INVITE_CODE`', env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
          break;
        case 'settings': {
          const user = await getOrCreateUser(env, telegramUser);
          const project = await getCurrentProject(env, user.id);
          if (!project) {
            await sendMessage(chatId, '❌ No project selected.', env.TELEGRAM_BOT_TOKEN);
            break;
          }
          await sendMessage(chatId, `⚙️ *${project.name} Settings*\n\n📍 Location: ${project.defaultLocation ?? 'Not set'}\n💱 Currency: ${project.defaultCurrency}`, env.TELEGRAM_BOT_TOKEN, {
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
          });
          break;
        }
        case 'archive':
          await handleCommand('/archive', chatId, telegramUser, env);
          break;
        case 'back':
          await handleCommand('/m', chatId, telegramUser, env);
          break;
      }
      break;
    }

    case 'switch': {
      // Switch to selected project
      const projectId = id;
      const userId = query.from.id;

      await env.DB.prepare(
        'UPDATE users SET current_project_id = ? WHERE id = ?'
      ).bind(projectId, userId).run();

      const switchedProject = await env.DB.prepare(
        'SELECT name FROM projects WHERE id = ?'
      ).bind(projectId).first();

      await editMessageText(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        `📁 Switched to *${switchedProject?.name ?? 'project'}*`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case 'txedit': {
      // Transaction edit - id format: field_txId
      const chatId = query.message?.chat.id ?? 0;
      const [field, txId] = id.split('_');

      if (field === 'cancel') {
        await deleteMessage(chatId, query.message?.message_id ?? 0, env.TELEGRAM_BOT_TOKEN);
        break;
      }

      if (field === 'category') {
        // Show category picker
        const categories = ['dining', 'grocery', 'gas', 'shopping', 'travel', 'transport', 'entertainment', 'health', 'utilities', 'other'];
        const keyboard = [];
        for (let i = 0; i < categories.length; i += 3) {
          keyboard.push(categories.slice(i, i + 3).map(c => ({
            text: c,
            callback_data: `txset_category_${c}_${txId}`,
          })));
        }
        await sendMessage(chatId, '🏷️ Select category:', env.TELEGRAM_BOT_TOKEN, {
          reply_markup: { inline_keyboard: keyboard },
        });
      } else {
        // For amount, merchant, split - ask for text input
        const prompts: Record<string, string> = {
          amount: '💰 Reply with the new amount (e.g., 50.00):',
          merchant: '📍 Reply with the new merchant name:',
          split: '👥 Reply with split (e.g., "Bodhi 30, Sherry 20" or "equal"):',
        };
        await sendMessage(chatId, `${prompts[field]}\n\n_Transaction ID: ${txId}_`, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      }
      break;
    }

    case 'txset': {
      // Transaction set value - id format: field_value_txId
      const chatId = query.message?.chat.id ?? 0;
      const parts = id.split('_');
      const field = parts[0];
      const txId = parts[parts.length - 1];
      const value = parts.slice(1, -1).join('_');

      if (field === 'category') {
        await env.DB.prepare(
          'UPDATE transactions SET category = ? WHERE id = ?'
        ).bind(value, txId).run();

        await editMessageText(
          chatId,
          query.message?.message_id ?? 0,
          `✅ Category updated to *${value}*`,
          env.TELEGRAM_BOT_TOKEN,
          { parse_mode: 'Markdown' }
        );
      }
      break;
    }

    case 'set': {
      // Project settings callbacks
      const chatId = query.message?.chat.id ?? 0;
      const telegramUser = query.from;
      const settingAction = id;

      switch (settingAction) {
        case 'location':
          await sendMessage(chatId, '📍 Set location:\n`/setlocation "City Name"`\nor `/setlocation clear`', env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
          break;
        case 'currency':
          await sendMessage(chatId, '💱 Set currency:\n`/setcurrency USD`', env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
          break;
        case 'rename':
          await sendMessage(chatId, '✏️ Rename project:\n`/rename "New Name"`', env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
          break;
        case 'delete':
          await handleCommand('/deleteproject', chatId, telegramUser, env);
          break;
      }
      break;
    }
  }
}

// ============================================
// Telegram API Helpers
// ============================================

async function sendMessage(
  chatId: number,
  text: string,
  token: string,
  options?: Record<string, unknown>
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...options,
    }),
  });
}

async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  token: string,
  options?: Record<string, unknown>
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      ...options,
    }),
  });
}

async function deleteMessage(
  chatId: number,
  messageId: number,
  token: string
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
    }),
  });
}

async function answerCallbackQuery(
  callbackQueryId: string,
  token: string,
  text?: string
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
}

async function setWebhook(
  token: string,
  url: string
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }
  );
  return response.json();
}
