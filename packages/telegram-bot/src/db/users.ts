/**
 * User Database Helpers
 */

import type { User } from '@fintrack-ai/core';
import type { Environment, TelegramUser } from '../types.js';
import { DEFAULT_PROJECT_ID } from '../constants.js';
import { ProjectRole } from '../constants.js';

export function rowToUser(row: Readonly<Record<string, unknown>>): User {
  return {
    id: row.id as number,
    username: row.username as string | undefined,
    firstName: row.first_name as string | undefined,
    currentProjectId: row.current_project_id as string | undefined,
    createdAt: row.created_at as string,
  };
}

export async function getOrCreateUser(
  environment: Environment,
  telegramUser: TelegramUser
): Promise<User> {
  const existing = await environment.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(telegramUser.id).first();

  if (existing != null) {
    return rowToUser(existing as Record<string, unknown>);
  }

  // Create new user with default project
  const now = new Date().toISOString();
  await environment.DB.prepare(`
    INSERT INTO users (id, username, first_name, current_project_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    telegramUser.id,
    telegramUser.username ?? null,
    telegramUser.first_name,
    DEFAULT_PROJECT_ID,
    now
  ).run();

  // Add to default project
  await environment.DB.prepare(`
    INSERT OR IGNORE INTO project_members (project_id, user_id, display_name, role, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(DEFAULT_PROJECT_ID, telegramUser.id, telegramUser.first_name, ProjectRole.MEMBER, now).run();

  return {
    id: telegramUser.id,
    username: telegramUser.username,
    firstName: telegramUser.first_name,
    currentProjectId: DEFAULT_PROJECT_ID,
    createdAt: now,
  };
}
