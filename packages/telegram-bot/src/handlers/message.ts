/**
 * Message Handlers
 */

import {
  TransactionParser,
  splitExpense,
  parseNaturalLanguageSplit,
  recommendCard,
  detectForeignByLocation,
  formatRecommendationWithValue,
  formatBenefits,
} from '@fintrack-ai/core';
import type { Environment, TelegramMessage, TelegramUser } from '../types.js';
import { TransactionStatus } from '../constants.js';
import { getOrCreateUser, getCurrentProject, getProjectMembers, getUserCards } from '../db/index.js';
import { sendMessage } from '../telegram/api.js';
import { detectCityFromCoords } from '../utils/index.js';
import { handleCommand } from './commands/index.js';
import { transcribeAudio, downloadTelegramFile } from '../services/whisper.js';

// ============================================
// Location Message Handler
// ============================================

export async function handleLocationMessage(
  message: TelegramMessage,
  environment: Environment
): Promise<void> {
  const chatId = message.chat.id;
  const telegramUser = message.from;

  if (telegramUser == null || message.location == null) {
    return;
  }

  const { latitude, longitude } = message.location;
  const user = await getOrCreateUser(environment, telegramUser);
  const project = await getCurrentProject(environment, user.id);

  if (project == null) {
    await sendMessage(
      chatId,
      `📍 Location received, but no project selected.\n\nCreate a project first with /new`,
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  const city = detectCityFromCoords(latitude, longitude);

  if (city != null) {
    await environment.DB.prepare(
      'UPDATE projects SET default_location = ? WHERE id = ?'
    ).bind(city, project.id).run();

    await sendMessage(
      chatId,
      `📍 Location set to *${city}* for ${project.name}`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
  } else {
    await sendMessage(
      chatId,
      `📍 Got your location (${latitude.toFixed(2)}, ${longitude.toFixed(2)})\n\nUse \`/setlocation "City Name"\` to set it manually.`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
  }
}

// ============================================
// Voice Message Handler
// ============================================

export async function handleVoiceMessage(
  message: TelegramMessage,
  environment: Environment
): Promise<void> {
  const chatId = message.chat.id;
  const telegramUser = message.from;

  if (telegramUser == null || message.voice == null) {
    return;
  }

  // Send "processing" indicator
  await sendMessage(
    chatId,
    '🎤 _Processing voice message..._',
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );

  try {
    // Download audio from Telegram
    const audioBlob = await downloadTelegramFile(
      message.voice.file_id,
      environment.TELEGRAM_BOT_TOKEN
    );

    // Transcribe with Whisper
    const transcription = await transcribeAudio(audioBlob, environment.OPENAI_API_KEY);

    if (transcription.text === '') {
      await sendMessage(
        chatId,
        '❌ Could not understand the voice message. Please try again.',
        environment.TELEGRAM_BOT_TOKEN
      );
      return;
    }

    // Show transcription and process as text
    await sendMessage(
      chatId,
      `🎤 _"${transcription.text}"_`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );

    // Process the transcribed text as a regular message
    await processTransactionText(transcription.text, chatId, telegramUser, environment);
  } catch (error) {
    console.error('Voice processing error:', error);
    await sendMessage(
      chatId,
      `❌ Failed to process voice: ${error instanceof Error ? error.message : 'Unknown error'}`,
      environment.TELEGRAM_BOT_TOKEN
    );
  }
}

// ============================================
// Text Message Handler
// ============================================

export async function handleTextMessage(
  message: TelegramMessage,
  environment: Environment
): Promise<void> {
  const text = message.text ?? '';
  const chatId = message.chat.id;
  const telegramUser = message.from;

  if (telegramUser == null) {
    return;
  }

  // Command handling
  if (text.startsWith('/')) {
    await handleCommand(text, chatId, telegramUser, environment);
    return;
  }

  const trimmedText = text.trim();
  if (trimmedText.length < 2) {
    return;
  }

  await processTransactionText(trimmedText, chatId, telegramUser, environment);
}

// ============================================
// Shared Transaction Processing
// ============================================

async function processTransactionText(
  text: string,
  chatId: number,
  telegramUser: TelegramUser,
  environment: Environment
): Promise<void> {
  // Get or create user and their current project
  const user = await getOrCreateUser(environment, telegramUser);
  const project = await getCurrentProject(environment, user.id);
  const userName = user.firstName ?? 'User';

  if (project == null) {
    await sendMessage(
      chatId,
      `📁 No project selected.\n\nCreate one with /new or join with /join`,
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  try {
    const parser = new TransactionParser(environment.OPENAI_API_KEY);
    const { parsed, confidence, warnings } = await parser.parseNaturalLanguage(text);

    const membership = await environment.DB.prepare(
      'SELECT display_name FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(project.id, user.id).first();
    const payerName = (membership?.display_name as string) ?? userName;

    const participants = await getProjectMembers(environment, project.id);
    const splitMods = parseNaturalLanguageSplit(text, [...participants]);

    const splitResult = splitExpense({
      totalAmount: parsed.amount,
      currency: parsed.currency,
      payer: payerName,
      participants: [...participants],
      excludedParticipants: splitMods.excludedParticipants,
    });

    const location = parsed.location ?? project.defaultLocation ?? null;
    const transactionId = crypto.randomUUID();

    await environment.DB.prepare(`
      INSERT INTO transactions (id, project_id, user_id, chat_id, merchant, amount, currency, category, location, card_last_four, payer, is_shared, splits, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      transactionId,
      project.id,
      user.id,
      chatId,
      parsed.merchant,
      parsed.amount,
      parsed.currency,
      parsed.category,
      location,
      parsed.cardLastFour ?? null,
      payerName,
      1,
      JSON.stringify(splitResult.shares),
      TransactionStatus.PENDING,
      new Date().toISOString()
    ).run();

    const userCards = await getUserCards(environment, user.id);
    const foreignCheck = detectForeignByLocation(location ?? undefined, parsed.currency);
    const cardRecommendation = recommendCard(parsed, [...userCards], foreignCheck.isForeign);

    // Apply foreign warning if needed
    const recommendation = foreignCheck.warning != null && cardRecommendation.best.warning == null
      ? {
          ...cardRecommendation,
          best: { ...cardRecommendation.best, warning: foreignCheck.warning },
        }
      : cardRecommendation;

    const splitLines = Object.entries(splitResult.shares)
      .map(([person, share]) => `  ${person}: $${share.toFixed(2)}`);

    const cardSection = userCards.length > 0
      ? [
          '',
          formatRecommendationWithValue(recommendation),
          ...(recommendation.best.relevantBenefits.length > 0
            ? [formatBenefits(recommendation.best.relevantBenefits)]
            : []),
        ]
      : ['', '💳 _Add your cards with /cards to see rewards_'];

    const suggestionSection = cardRecommendation.missingCardSuggestion != null
      ? ['', `💡 _${cardRecommendation.missingCardSuggestion.reason}_`]
      : [];

    const warningsSection = warnings != null && warnings.length > 0
      ? ['', `⚠️ ${warnings.join(', ')}`]
      : [];

    const confidenceSection = confidence < 1
      ? ['', `_Confidence: ${(confidence * 100).toFixed(0)}%_`]
      : [];

    const responseParts = [
      `💳 *New Transaction*`,
      `📁 _${project.name}_`,
      '',
      `📍 ${parsed.merchant}${location != null ? ` (${location})` : ''}`,
      `💰 $${parsed.amount.toFixed(2)} ${parsed.currency}`,
      `🏷️ ${parsed.category}`,
      `📅 ${parsed.date}`,
      '',
      '*Split:*',
      ...splitLines,
      ...cardSection,
      ...suggestionSection,
      ...warningsSection,
      ...confidenceSection,
    ];

    await sendMessage(chatId, responseParts.join('\n'), environment.TELEGRAM_BOT_TOKEN, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm', callback_data: `confirm_${transactionId}` },
            { text: '👤 Personal', callback_data: `personal_${transactionId}` },
          ],
          [
            { text: '✏️ Edit', callback_data: `edit_${transactionId}` },
            { text: '❌ Delete', callback_data: `delete_${transactionId}` },
          ],
        ],
      },
    });
  } catch (error) {
    console.error('Parse error:', error);
    await sendMessage(
      chatId,
      `❌ Failed to parse: ${error instanceof Error ? error.message : 'Unknown error'}`,
      environment.TELEGRAM_BOT_TOKEN
    );
  }
}
