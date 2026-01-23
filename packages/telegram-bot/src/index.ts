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
    inviteCode: row.invite_code as string,
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
      project?.defaultLocation ?? null,
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
    response += `\n📍 ${parsed.merchant}\n`;
    response += `💰 $${parsed.amount.toFixed(2)} ${parsed.currency}\n`;
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
      await sendMessage(
        chatId,
        `📁 *${project?.name ?? 'Daily'}*\n\n直接发消息记账，或点击下方按钮：`,
        env.TELEGRAM_BOT_TOKEN,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📊 余额', callback_data: 'menu_balance' },
                { text: '💸 结算', callback_data: 'menu_settle' },
                { text: '📜 历史', callback_data: 'menu_history' },
              ],
              [
                { text: '📁 项目', callback_data: 'menu_projects' },
                { text: '💳 卡片', callback_data: 'menu_cards' },
                { text: '❓ 帮助', callback_data: 'menu_help' },
              ],
            ],
          },
        }
      );
      break;

    case '/help':
    case '/h':
      await sendMessage(
        chatId,
        `*快捷命令:*\n/m - 主菜单\n/b - 余额\n/s - 结算\n/h - 历史\n/p - 项目\n\n*项目管理:*\n/new <名称> - 新建项目\n/join <邀请码> - 加入项目\n\n*记账:*\n直接发消息！\n"午饭 50 麦当劳"\n"Costco 150"`,
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
      const inviteCode = generateInviteCode();

      await env.DB.prepare(`
        INSERT INTO projects (id, name, type, default_currency, invite_code, owner_id, created_at)
        VALUES (?, ?, 'trip', 'CAD', ?, ?, ?)
      `).bind(projectId, projectName, inviteCode, user.id, new Date().toISOString()).run();

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
        `✅ Created project *${projectName}*\n\n📎 Invite code: \`${inviteCode}\`\n\nShare this code with your group!`,
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
        await sendMessage(chatId, '❌ Invalid invite code.', env.TELEGRAM_BOT_TOKEN);
        break;
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
        msg += `  👥 ${p.member_count} members | 📝 ${p.tx_count} transactions\n`;
        if (p.is_active === 1) {
          msg += `  📎 \`${p.invite_code}\`\n`;
        }
        msg += '\n';
      }

      await sendMessage(chatId, msg, env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
      break;
    }

    case '/invite': {
      if (!project) {
        await sendMessage(chatId, '❌ No current project.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      await sendMessage(
        chatId,
        `📎 *${project.name}* invite code:\n\n\`${project.inviteCode}\`\n\nShare this with your group!`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/leave': {
      if (!project || project.id === 'default') {
        await sendMessage(chatId, '❌ Cannot leave the default project.', env.TELEGRAM_BOT_TOKEN);
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

      // Switch to default project
      await env.DB.prepare(
        'UPDATE users SET current_project_id = ? WHERE id = ?'
      ).bind('default', user.id).run();

      await sendMessage(
        chatId,
        `👋 Left *${project.name}*. Switched to Daily.`,
        env.TELEGRAM_BOT_TOKEN,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    case '/archive': {
      if (!project || project.id === 'default') {
        await sendMessage(chatId, '❌ Cannot archive the default project.', env.TELEGRAM_BOT_TOKEN);
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

      // Switch all members to default
      await env.DB.prepare(`
        UPDATE users SET current_project_id = 'default'
        WHERE current_project_id = ?
      `).bind(project.id).run();

      await sendMessage(
        chatId,
        `📦 Archived *${project.name}*.\n\nHistorical data preserved. Use /projects to see archived.`,
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

      if (!project || project.id === 'default') {
        await sendMessage(chatId, '❌ Cannot rename the default project.', env.TELEGRAM_BOT_TOKEN);
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
      const balances = calculateBalances(transactions);

      if (balances.length === 0) {
        await sendMessage(chatId, '📊 All balanced! No one owes anything.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      let balanceMsg = `📊 *${project?.name ?? 'Daily'} Balances*\n\n`;
      balances.forEach((b) => {
        const emoji = b.netBalance > 0 ? '💚' : '🔴';
        const status = b.netBalance > 0 ? 'is owed' : 'owes';
        balanceMsg += `${emoji} ${b.person} ${status} $${Math.abs(b.netBalance).toFixed(2)}\n`;
      });

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

      const txns = settleRows.results.map((row) => rowToTransaction(row as Record<string, unknown>));
      const settlements = simplifyDebts(txns, project?.defaultCurrency ?? 'CAD');

      if (settlements.length === 0) {
        await sendMessage(chatId, '💸 All settled! No payments needed.', env.TELEGRAM_BOT_TOKEN);
        break;
      }

      let settleMsg = `💸 *${project?.name ?? 'Daily'} Settlement*\n\n`;
      settleMsg += formatSettlements(settlements);

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
  const [action, txId] = data.split('_');

  // Acknowledge the callback
  await answerCallbackQuery(query.id, env.TELEGRAM_BOT_TOKEN);

  switch (action) {
    case 'confirm':
      // Update transaction status to confirmed
      await env.DB.prepare(`
        UPDATE transactions SET status = 'confirmed', confirmed_at = ? WHERE id = ?
      `).bind(new Date().toISOString(), txId).run();

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
      `).bind(new Date().toISOString(), txId).run();

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
      `).bind(txId).run();

      await deleteMessage(
        query.message?.chat.id ?? 0,
        query.message?.message_id ?? 0,
        env.TELEGRAM_BOT_TOKEN
      );
      break;

    case 'edit':
      await sendMessage(
        query.message?.chat.id ?? 0,
        'Reply to this message with your correction.',
        env.TELEGRAM_BOT_TOKEN
      );
      break;

    // Menu callbacks - redirect to command handlers
    case 'menu': {
      const chatId = query.message?.chat.id ?? 0;
      const telegramUser = query.from;
      const subAction = txId; // txId is actually the sub-action here

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
          await sendMessage(chatId, '📁 *项目管理*', env.TELEGRAM_BOT_TOKEN, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📋 我的项目', callback_data: 'proj_list' },
                  { text: '🔄 切换', callback_data: 'proj_switch' },
                ],
                [
                  { text: '➕ 新建', callback_data: 'proj_new' },
                  { text: '🔗 加入', callback_data: 'proj_join' },
                ],
                [
                  { text: '📎 邀请码', callback_data: 'proj_invite' },
                  { text: '⬅️ 返回', callback_data: 'proj_back' },
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
      const subAction = txId;

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
          await sendMessage(chatId, '发送命令创建项目：\n`/new 项目名称`', env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
          break;
        case 'join':
          await sendMessage(chatId, '发送命令加入项目：\n`/join 邀请码`', env.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
          break;
        case 'back':
          await handleCommand('/m', chatId, telegramUser, env);
          break;
      }
      break;
    }

    case 'switch': {
      // Switch to selected project
      const projectId = txId; // txId is actually the project ID here
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
