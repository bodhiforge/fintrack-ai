/**
 * Callback Query Router - Map-based routing
 */

import type { Environment, CallbackQuery } from '../../types.js';
import { answerCallbackQuery } from '../../telegram/api.js';
import { handleTransactionCallbacks } from './transaction.js';
import { handleMenuCallbacks, handleProjectCallbacks, handleSettingsCallbacks, handleSwitchCallback } from './menu.js';
import { handleCardCallbacks, handleCardAddCallback } from './cards.js';
import { handleEditCallbacks, handleCategoryCallback } from './edit.js';

// ============================================
// Callback Router
// ============================================

type CallbackHandler = (
  query: CallbackQuery,
  actionId: string,
  environment: Environment
) => Promise<void>;

const callbackHandlers = new Map<string, CallbackHandler>([
  ['confirm', handleTransactionCallbacks],
  ['personal', handleTransactionCallbacks],
  ['delete', handleTransactionCallbacks],
  ['edit', handleTransactionCallbacks],
  ['menu', handleMenuCallbacks],
  ['proj', handleProjectCallbacks],
  ['switch', handleSwitchCallback],
  ['txe', handleEditCallbacks],
  ['txc', handleCategoryCallback],
  ['set', handleSettingsCallbacks],
  ['card', handleCardCallbacks],
  ['cadd', handleCardAddCallback],
]);

// ============================================
// Main Callback Handler
// ============================================

export async function handleCallbackQuery(
  query: CallbackQuery,
  environment: Environment
): Promise<void> {
  const data = query.data ?? '';
  const underscoreIndex = data.indexOf('_');
  const action = underscoreIndex > 0 ? data.substring(0, underscoreIndex) : data;
  const actionId = underscoreIndex > 0 ? data.substring(underscoreIndex + 1) : '';

  await answerCallbackQuery(query.id, environment.TELEGRAM_BOT_TOKEN);

  const handler = callbackHandlers.get(action);
  if (handler != null) {
    await handler(query, actionId, environment);
  }
}
