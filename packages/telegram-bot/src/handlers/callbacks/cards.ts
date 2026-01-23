/**
 * Card Callback Handlers
 */

import { PRESET_CARDS, getCardById, benefitEmoji, type CreditCard } from '@fintrack-ai/core';
import type { CallbackQuery, Environment } from '../../types.js';
import { sendMessage, editMessageText, deleteMessage } from '../../telegram/api.js';
import { handleCommand } from '../commands/index.js';

function chunkArray<T>(array: readonly T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(array.length / size) },
    (_, index) => array.slice(index * size, (index + 1) * size) as T[]
  );
}

type CategoryConfig = Readonly<{
  filter: (card: CreditCard) => boolean;
  title: string;
}>;

const CATEGORY_CONFIGS: Readonly<Record<string, CategoryConfig>> = {
  dining: {
    filter: (card) =>
      card.rewards.some(reward => reward.category === 'dining' || reward.category === 'grocery'),
    title: '🍽️ Dining & Grocery Cards',
  },
  travel: {
    filter: (card) =>
      card.rewards.some(reward => reward.category === 'travel') ||
      card.benefits.some(benefit => benefit.triggerCategories?.includes('travel')),
    title: '✈️ Travel Cards',
  },
  nofx: {
    filter: (card) => card.ftf === 0,
    title: '🌍 No Foreign Transaction Fee',
  },
  cashback: {
    filter: (card) =>
      card.rewards.some(reward => reward.rewardType === 'cashback') || card.annualFee === 0,
    title: '💵 Cashback & No Fee Cards',
  },
};

export async function handleCardCallbacks(
  query: CallbackQuery,
  subAction: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const userId = query.from.id;

  if (subAction === 'add' || subAction === 'browse') {
    const cardLines = PRESET_CARDS.map(card => {
      const fee = card.annualFee === 0 ? 'No fee' : `$${card.annualFee}/yr`;
      const topReward = card.rewards[0];
      const rewardText = topReward != null ? `${topReward.multiplier}x ${topReward.category}` : '';
      return `*${card.name}* - ${fee}\n  ${rewardText}`;
    });

    const cardButtons = PRESET_CARDS.map(card => ({
      text: card.name,
      callback_data: `cadd_${card.id}`,
    }));
    const keyboard = [
      ...chunkArray(cardButtons, 2),
      [{ text: '⬅️ Back', callback_data: 'card_cancel' }],
    ];

    const message = [
      '📋 *Available Cards*',
      '',
      ...cardLines,
    ].join('\n');

    await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  } else if (subAction === 'remove') {
    await handleCommand('/removecard', chatId, query.from, environment);
  } else if (subAction === 'cancel') {
    await deleteMessage(chatId, query.message?.message_id ?? 0, environment.TELEGRAM_BOT_TOKEN);
  } else if (subAction.startsWith('cat_')) {
    const category = subAction.replace('cat_', '');
    const config = CATEGORY_CONFIGS[category];

    if (config == null) {
      return;
    }

    const filteredCards = PRESET_CARDS.filter(config.filter);
    const keyboard = [
      ...filteredCards.map(card => [{
        text: card.name,
        callback_data: `cadd_${card.id}`,
      }]),
      [{ text: '⬅️ Back', callback_data: 'card_add' }],
    ];

    await sendMessage(chatId, `${config.title}\n\nSelect a card to add:`, environment.TELEGRAM_BOT_TOKEN, {
      reply_markup: { inline_keyboard: keyboard },
    });
  } else if (subAction.startsWith('rm_')) {
    const cardIdPrefix = subAction.replace('rm_', '');
    await environment.DB.prepare(
      'DELETE FROM user_cards WHERE user_id = ? AND id LIKE ?'
    ).bind(userId, `${cardIdPrefix}%`).run();

    await editMessageText(
      chatId,
      query.message?.message_id ?? 0,
      '✅ Card removed.',
      environment.TELEGRAM_BOT_TOKEN
    );
  }
}

export async function handleCardAddCallback(
  query: CallbackQuery,
  cardId: string,
  environment: Environment
): Promise<void> {
  const chatId = query.message?.chat.id ?? 0;
  const userId = query.from.id;

  const card = getCardById(cardId);
  if (card == null) {
    await sendMessage(chatId, '❌ Card not found.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const existing = await environment.DB.prepare(
    'SELECT id FROM user_cards WHERE user_id = ? AND card_id = ?'
  ).bind(userId, cardId).first();

  if (existing != null) {
    await sendMessage(chatId, `ℹ️ You already have *${card.name}* added.`, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
    return;
  }

  await environment.DB.prepare(`
    INSERT INTO user_cards (id, user_id, card_id, added_at)
    VALUES (?, ?, ?, ?)
  `).bind(crypto.randomUUID(), userId, cardId, new Date().toISOString()).run();

  const rewardLines = card.rewards.slice(0, 3).map(reward => {
    const category = reward.category === 'all' ? 'All purchases' : reward.category;
    return `  • ${reward.multiplier}x on ${category}`;
  });

  const benefitLines = card.benefits.slice(0, 2).map(benefit =>
    `  ${benefitEmoji(benefit.type)} ${benefit.name}`
  );

  const benefitSection = benefitLines.length > 0
    ? ['', '🎁 *Benefits:*', ...benefitLines]
    : [];

  const messageParts = [
    `✅ Added *${card.name}*`,
    '',
    '💰 *Rewards:*',
    ...rewardLines,
    ...benefitSection,
  ];

  await editMessageText(
    chatId,
    query.message?.message_id ?? 0,
    messageParts.join('\n'),
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}
