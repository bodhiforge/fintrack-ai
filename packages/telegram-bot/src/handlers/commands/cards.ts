/**
 * Card Command Handlers
 */

import { PRESET_CARDS } from '@fintrack-ai/core';
import type { CommandHandlerContext } from './index.js';
import { sendMessage } from '../../telegram/api.js';
import { getUserCards } from '../../db/index.js';

function chunkArray<T>(array: readonly T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(array.length / size) },
    (_, index) => array.slice(index * size, (index + 1) * size) as T[]
  );
}

export async function handleCards(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, environment } = context;

  const userCards = await getUserCards(environment, user.id);

  if (userCards.length === 0) {
    await sendMessage(
      chatId,
      `💳 *My Cards*\n\nNo cards added yet.\n\nTap "Add Card" to get started:`,
      environment.TELEGRAM_BOT_TOKEN,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Add Card', callback_data: 'card_add' }],
          ],
        },
      }
    );
    return;
  }

  const cardLines = userCards.map(userCard => {
    const lastFour = userCard.lastFour != null ? ` (...${userCard.lastFour})` : '';
    const name = userCard.nickname ?? userCard.card.name;
    const topReward = userCard.card.rewards[0];
    const rewardLine = topReward != null
      ? `  ${topReward.multiplier}x on ${topReward.category === 'all' ? 'everything' : topReward.category}`
      : '';
    return `• *${name}*${lastFour}\n${rewardLine}`;
  });

  const message = [
    '💳 *My Cards*',
    '',
    ...cardLines,
  ].join('\n');

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '➕ Add', callback_data: 'card_add' },
          { text: '➖ Remove', callback_data: 'card_remove' },
        ],
        [{ text: '📋 All Available Cards', callback_data: 'card_browse' }],
      ],
    },
  });
}

export async function handleAddCard(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, environment } = context;

  const userCards = await getUserCards(environment, user.id);
  const existingCardIds = new Set(userCards.map(userCard => userCard.cardId));

  const availableCards = PRESET_CARDS.filter(card => !existingCardIds.has(card.id));

  if (availableCards.length === 0) {
    await sendMessage(chatId, '✅ You have all available cards added!', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const cardButtons = availableCards.map(card => ({
    text: card.name,
    callback_data: `cadd_${card.id}`,
  }));
  const keyboard = [
    ...chunkArray(cardButtons, 2),
    [{ text: '⬅️ Cancel', callback_data: 'card_cancel' }],
  ];

  await sendMessage(
    chatId,
    `➕ *Add a Card*\n\nTap to add:`,
    environment.TELEGRAM_BOT_TOKEN,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    }
  );
}

export async function handleRemoveCard(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, environment } = context;

  const userCards = await getUserCards(environment, user.id);

  if (userCards.length === 0) {
    await sendMessage(chatId, '💳 No cards to remove.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const keyboard = [
    ...userCards.map(userCard => [{
      text: `❌ ${userCard.nickname ?? userCard.card.name}`,
      callback_data: `card_rm_${userCard.id.slice(0, 8)}`,
    }]),
    [{ text: '⬅️ Cancel', callback_data: 'card_cancel' }],
  ];

  await sendMessage(chatId, '➖ *Remove a Card*\n\nSelect card to remove:', environment.TELEGRAM_BOT_TOKEN, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  });
}
