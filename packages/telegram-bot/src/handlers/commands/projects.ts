/**
 * Project Command Handlers
 */

import type { CommandHandlerContext } from './index.js';
import { sendMessage } from '../../telegram/api.js';
import { getProjectMembers } from '../../db/index.js';
import { generateInviteCode } from '../../utils/index.js';
import { ProjectRole, Threshold } from '../../constants.js';

export async function handleNewProject(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, user, environment } = context;

  const projectName = args.join(' ').replace(/"/g, '').trim();
  if (projectName === '') {
    await sendMessage(chatId, '❌ Usage: /newproject "Project Name"', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const projectId = crypto.randomUUID();
  const now = new Date().toISOString();

  await environment.DB.prepare(`
    INSERT INTO projects (id, name, type, default_currency, owner_id, created_at)
    VALUES (?, ?, 'trip', 'CAD', ?, ?)
  `).bind(projectId, projectName, user.id, now).run();

  await environment.DB.prepare(`
    INSERT INTO project_members (project_id, user_id, display_name, role, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(projectId, user.id, user.firstName ?? 'User', ProjectRole.OWNER, now).run();

  await environment.DB.prepare(
    'UPDATE users SET current_project_id = ? WHERE id = ?'
  ).bind(projectId, user.id).run();

  await sendMessage(
    chatId,
    `✅ Created project *${projectName}*\n\nUse /invite to generate a share code when ready.`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}

export async function handleJoin(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, user, environment } = context;

  const inviteCode = args[0]?.toUpperCase().trim();
  if (inviteCode == null || inviteCode === '') {
    await sendMessage(chatId, '❌ Usage: /join <invite_code>', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const projectToJoin = await environment.DB.prepare(
    'SELECT * FROM projects WHERE invite_code = ?'
  ).bind(inviteCode).first();

  if (projectToJoin == null) {
    await sendMessage(chatId, '❌ Invalid or expired invite code.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (projectToJoin.invite_expires_at != null) {
    const expiresAt = new Date(projectToJoin.invite_expires_at as string);
    if (expiresAt < new Date()) {
      await sendMessage(chatId, '❌ This invite code has expired. Ask the owner for a new one.', environment.TELEGRAM_BOT_TOKEN);
      return;
    }
  }

  const existingMember = await environment.DB.prepare(
    'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?'
  ).bind(projectToJoin.id, user.id).first();

  if (existingMember != null) {
    await sendMessage(chatId, `ℹ️ You're already in *${projectToJoin.name}*`, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
    return;
  }

  await environment.DB.prepare(`
    INSERT INTO project_members (project_id, user_id, display_name, role, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(projectToJoin.id, user.id, user.firstName ?? 'User', ProjectRole.MEMBER, new Date().toISOString()).run();

  await environment.DB.prepare(
    'UPDATE users SET current_project_id = ? WHERE id = ?'
  ).bind(projectToJoin.id, user.id).run();

  const members = await getProjectMembers(environment, projectToJoin.id as string);
  await sendMessage(
    chatId,
    `✅ Joined *${projectToJoin.name}*!\n\nMembers: ${members.join(', ')}`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}

export async function handleSwitch(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, project, environment } = context;

  const userProjects = await environment.DB.prepare(`
    SELECT p.* FROM projects p
    JOIN project_members pm ON p.id = pm.project_id
    WHERE pm.user_id = ? AND p.is_active = 1
  `).bind(user.id).all();

  if (userProjects.results == null || userProjects.results.length === 0) {
    await sendMessage(chatId, '📁 No projects found. Create one with /newproject', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const keyboard = userProjects.results.map((projectRow) => [{
    text: `${projectRow.id === project?.id ? '✓ ' : ''}${projectRow.name}`,
    callback_data: `switch_${projectRow.id}`,
  }]);

  await sendMessage(chatId, '📁 *Select Project:*', environment.TELEGRAM_BOT_TOKEN, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleProjects(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, project, environment } = context;

  const userProjects = await environment.DB.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
      (SELECT COUNT(*) FROM transactions WHERE project_id = p.id AND status = 'confirmed') as tx_count
    FROM projects p
    JOIN project_members pm ON p.id = pm.project_id
    WHERE pm.user_id = ?
    ORDER BY p.is_active DESC, p.created_at DESC
  `).bind(user.id).all();

  if (userProjects.results == null || userProjects.results.length === 0) {
    await sendMessage(chatId, '📁 No projects. Create one with /newproject', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const projectLines = userProjects.results.map((projectRow) => {
    const current = projectRow.id === project?.id ? ' ← current' : '';
    const archived = projectRow.is_active === 0 ? ' 📦' : '';
    return [
      `*${projectRow.name}*${current}${archived}`,
      `  👥 ${projectRow.member_count} members | 📝 ${projectRow.tx_count} transactions`,
    ].join('\n');
  });

  const message = [
    '📁 *My Projects*',
    '',
    ...projectLines,
    '',
    '_Use /invite to generate a share link_',
  ].join('\n');

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
}

export async function handleInvite(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, project, environment } = context;

  if (project == null) {
    await sendMessage(chatId, '❌ No current project.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project.ownerId !== user.id) {
    await sendMessage(chatId, '❌ Only the project owner can generate invite codes.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const newCode = generateInviteCode();
  const expiresAt = new Date(Date.now() + Threshold.INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await environment.DB.prepare(
    'UPDATE projects SET invite_code = ?, invite_expires_at = ? WHERE id = ?'
  ).bind(newCode, expiresAt, project.id).run();

  const expiryDate = new Date(expiresAt).toLocaleDateString('en-CA');
  await sendMessage(
    chatId,
    `📎 *${project.name}* invite code:\n\n\`${newCode}\`\n\n_Expires: ${expiryDate}_`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}

export async function handleLeave(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, project, environment } = context;

  if (project == null) {
    await sendMessage(chatId, '❌ No current project.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project.ownerId === user.id) {
    await sendMessage(chatId, '❌ Owner cannot leave. Transfer ownership or /archive the project.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  await environment.DB.prepare(
    'DELETE FROM project_members WHERE project_id = ? AND user_id = ?'
  ).bind(project.id, user.id).run();

  await environment.DB.prepare(
    'UPDATE users SET current_project_id = NULL WHERE id = ?'
  ).bind(user.id).run();

  await sendMessage(
    chatId,
    `👋 Left *${project.name}*.\n\nUse /p to see your projects or /new to create one.`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}

export async function handleArchive(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, project, environment } = context;

  if (project == null) {
    await sendMessage(chatId, '❌ No current project.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project.ownerId !== user.id) {
    await sendMessage(chatId, '❌ Only the project owner can archive.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  await environment.DB.prepare(
    'UPDATE projects SET is_active = 0 WHERE id = ?'
  ).bind(project.id).run();

  await environment.DB.prepare(`
    UPDATE users SET current_project_id = NULL
    WHERE current_project_id = ?
  `).bind(project.id).run();

  await sendMessage(
    chatId,
    `📦 Archived *${project.name}*.\n\nData preserved. Use /unarchive to restore.`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}

export async function handleUnarchive(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, user, environment } = context;

  const projectName = args.join(' ').replace(/"/g, '').trim();

  if (projectName !== '') {
    const targetProject = await environment.DB.prepare(`
      SELECT * FROM projects WHERE name = ? AND owner_id = ? AND is_active = 0
    `).bind(projectName, user.id).first();

    if (targetProject == null) {
      await sendMessage(chatId, '❌ Archived project not found.', environment.TELEGRAM_BOT_TOKEN);
      return;
    }

    await environment.DB.prepare(
      'UPDATE projects SET is_active = 1 WHERE id = ?'
    ).bind(targetProject.id).run();

    await environment.DB.prepare(
      'UPDATE users SET current_project_id = ? WHERE id = ?'
    ).bind(targetProject.id, user.id).run();

    await sendMessage(
      chatId,
      `✅ Restored *${targetProject.name}*`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
  } else {
    const archivedProjects = await environment.DB.prepare(`
      SELECT name FROM projects WHERE owner_id = ? AND is_active = 0
    `).bind(user.id).all();

    if (archivedProjects.results == null || archivedProjects.results.length === 0) {
      await sendMessage(chatId, '📦 No archived projects.', environment.TELEGRAM_BOT_TOKEN);
      return;
    }

    const names = archivedProjects.results.map(projectRow => `• ${projectRow.name}`).join('\n');
    await sendMessage(chatId, `📦 *Archived Projects:*\n\n${names}\n\nUse: /unarchive "Project Name"`, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
  }
}

export async function handleDeleteProject(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, user, project, environment } = context;

  if (project == null) {
    await sendMessage(chatId, '❌ No current project.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project.ownerId !== user.id) {
    await sendMessage(chatId, '❌ Only the project owner can delete.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const isConfirmed = args[0]?.toLowerCase() === 'confirm';
  if (!isConfirmed) {
    await sendMessage(
      chatId,
      `⚠️ *Delete ${project.name}?*\n\nThis will permanently delete:\n• All transactions\n• All member data\n\nType: /deleteproject confirm`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  try {
    // Use batch to ensure atomicity
    await environment.DB.batch([
      environment.DB.prepare('DELETE FROM transactions WHERE project_id = ?').bind(project.id),
      environment.DB.prepare('DELETE FROM project_members WHERE project_id = ?').bind(project.id),
      environment.DB.prepare('UPDATE users SET current_project_id = NULL WHERE current_project_id = ?').bind(project.id),
      environment.DB.prepare('DELETE FROM projects WHERE id = ?').bind(project.id),
    ]);

    await sendMessage(
      chatId,
      `🗑️ Deleted *${project.name}*`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Failed to delete project:', error);
    await sendMessage(
      chatId,
      '❌ Failed to delete project. Please try again.',
      environment.TELEGRAM_BOT_TOKEN
    );
  }
}

export async function handleRename(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, user, project, environment } = context;

  const newName = args.join(' ').replace(/"/g, '').trim();
  if (newName === '') {
    await sendMessage(chatId, '❌ Usage: /rename "New Name"', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project == null) {
    await sendMessage(chatId, '❌ No current project.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project.ownerId !== user.id) {
    await sendMessage(chatId, '❌ Only the project owner can rename.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  await environment.DB.prepare(
    'UPDATE projects SET name = ? WHERE id = ?'
  ).bind(newName, project.id).run();

  await sendMessage(
    chatId,
    `✅ Renamed to *${newName}*`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}

export async function handleSetLocation(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, user, project, environment } = context;

  const newLocation = args.join(' ').replace(/"/g, '').trim();
  if (newLocation === '') {
    await sendMessage(chatId, '❌ Usage: /setlocation "City" or /setlocation clear', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project == null) {
    await sendMessage(chatId, '❌ No current project.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project.ownerId !== user.id) {
    await sendMessage(chatId, '❌ Only the project owner can change settings.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const locationValue = newLocation.toLowerCase() === 'clear' ? null : newLocation;
  await environment.DB.prepare(
    'UPDATE projects SET default_location = ? WHERE id = ?'
  ).bind(locationValue, project.id).run();

  const message = locationValue != null
    ? `📍 Default location set to *${locationValue}*`
    : `📍 Default location cleared`;

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
}

export async function handleSetCurrency(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, user, project, environment } = context;

  const newCurrency = args[0]?.toUpperCase().trim();
  if (newCurrency == null || newCurrency === '') {
    await sendMessage(chatId, '❌ Usage: /setcurrency CAD|USD|EUR|...', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project == null) {
    await sendMessage(chatId, '❌ No current project.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  if (project.ownerId !== user.id) {
    await sendMessage(chatId, '❌ Only the project owner can change settings.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  await environment.DB.prepare(
    'UPDATE projects SET default_currency = ? WHERE id = ?'
  ).bind(newCurrency, project.id).run();

  await sendMessage(
    chatId,
    `💱 Default currency set to *${newCurrency}*`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}
