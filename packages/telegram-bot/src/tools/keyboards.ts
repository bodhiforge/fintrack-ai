/**
 * Shared Keyboard Builders
 * Reusable Telegram inline keyboards for tool responses
 */

import type { Keyboard } from '@fintrack-ai/core';

export function transactionKeyboard(transactionId: string): Keyboard {
  return [
    [
      { text: '\u2705 Confirm', callback_data: `confirm_${transactionId}` },
      { text: '\u270f\ufe0f Edit', callback_data: `edit_${transactionId}` },
    ],
    [
      { text: '\ud83d\udc64 Personal', callback_data: `personal_${transactionId}` },
      { text: '\u274c Delete', callback_data: `delete_${transactionId}` },
    ],
    [{ text: '\ud83c\udfe0 Menu', callback_data: 'menu_main' }],
  ];
}

export function deleteConfirmKeyboard(transactionId: string): Keyboard {
  return [
    [
      { text: '\u2705 Yes, Delete', callback_data: `delete_${transactionId}` },
      { text: '\u274c Cancel', callback_data: 'menu_main' },
    ],
    [{ text: '\ud83c\udfe0 Menu', callback_data: 'menu_main' }],
  ];
}
