/**
 * Card Database Helpers
 */

import { getCardById, type UserCardWithDetails } from '@fintrack-ai/core';
import type { Environment } from '../types.js';

export async function getUserCards(
  environment: Environment,
  userId: number
): Promise<readonly UserCardWithDetails[]> {
  const rows = await environment.DB.prepare(
    'SELECT * FROM user_cards WHERE user_id = ? AND is_active = 1'
  ).bind(userId).all();

  if (rows.results == null) {
    return [];
  }

  const results: UserCardWithDetails[] = [];

  for (const row of rows.results) {
    const record = row as Record<string, unknown>;
    const card = getCardById(record.card_id as string);
    if (card != null) {
      results.push({
        id: record.id as string,
        odId: record.user_id as number,
        cardId: record.card_id as string,
        lastFour: record.last_four as string | undefined,
        nickname: record.nickname as string | undefined,
        isActive: record.is_active === 1,
        addedAt: record.added_at as string,
        card,
      });
    }
  }

  return results;
}
