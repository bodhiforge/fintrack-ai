/**
 * User Database Helpers
 */

import type { User } from '@fintrack-ai/core';
import type { Environment, TelegramUser } from '../types.js';

export interface UserWithIsNew extends User {
  readonly isNewUser: boolean;
}

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
): Promise<UserWithIsNew> {
  const existing = await environment.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(telegramUser.id).first();

  if (existing != null) {
    return {
      ...rowToUser(existing as Record<string, unknown>),
      isNewUser: false,
    };
  }

  // Create new user without default project - they'll be prompted to create/join one
  const now = new Date().toISOString();
  await environment.DB.prepare(`
    INSERT INTO users (id, username, first_name, current_project_id, created_at)
    VALUES (?, ?, ?, NULL, ?)
  `).bind(
    telegramUser.id,
    telegramUser.username ?? null,
    telegramUser.first_name,
    now
  ).run();

  return {
    id: telegramUser.id,
    username: telegramUser.username,
    firstName: telegramUser.first_name,
    currentProjectId: undefined,
    createdAt: now,
    isNewUser: true,
  };
}
