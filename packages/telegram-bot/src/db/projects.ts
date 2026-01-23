/**
 * Project Database Helpers
 */

import type { Project, Currency } from '@fintrack-ai/core';
import type { Environment } from '../types.js';

export function rowToProject(row: Readonly<Record<string, unknown>>): Project {
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

export async function getCurrentProject(
  environment: Environment,
  userId: number
): Promise<Project | null> {
  const user = await environment.DB.prepare(
    'SELECT current_project_id FROM users WHERE id = ?'
  ).bind(userId).first();

  if (user == null || user.current_project_id == null) {
    return null;
  }

  const project = await environment.DB.prepare(
    'SELECT * FROM projects WHERE id = ?'
  ).bind(user.current_project_id).first();

  return project != null ? rowToProject(project as Record<string, unknown>) : null;
}

export async function getProjectMembers(
  environment: Environment,
  projectId: string
): Promise<readonly string[]> {
  const rows = await environment.DB.prepare(
    'SELECT display_name FROM project_members WHERE project_id = ?'
  ).bind(projectId).all();

  return rows.results?.map((row) =>
    (row as Record<string, unknown>).display_name as string
  ) ?? [];
}
