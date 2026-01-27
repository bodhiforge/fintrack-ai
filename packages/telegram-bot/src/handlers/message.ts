/**
 * Message Handlers
 */

import {
  TransactionParser,
  splitExpense,
} from '@fintrack-ai/core';
import type { ConfidenceFactors } from '@fintrack-ai/core';
import type { Environment, TelegramMessage, TelegramUser } from '../types.js';
import { TransactionStatus } from '../constants.js';

// Confidence threshold for triggering clarification flow
const CLARIFICATION_THRESHOLD = 0.7;
import { getOrCreateUser, getCurrentProject, getProjectMembers, getRecentExamples, getSimilarExamples } from '../db/index.js';
import { sendMessage } from '../telegram/api.js';
import { detectCityFromCoords } from '../utils/index.js';
import { handleCommand } from './commands/index.js';
import { transcribeAudio, downloadTelegramFile } from '../services/whisper.js';
import { parseReceipt, blobToBase64, getMimeType } from '../services/vision.js';
import { processWithAgent, type AgentContext } from '../agent/index.js';
import { updateMemoryAfterTransaction } from '../agent/memory-session.js';
import type { LastTransaction } from '@fintrack-ai/core';

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
    const { blob: audioBlob } = await downloadTelegramFile(
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

    // Route through agent for intent classification
    const user = await getOrCreateUser(environment, telegramUser);
    const project = await getCurrentProject(environment, user.id);

    if (project == null) {
      await sendMessage(
        chatId,
        `📁 No project selected.\n\nCreate one with /new or join with /join`,
        environment.TELEGRAM_BOT_TOKEN
      );
      return;
    }

    const agentContext: AgentContext = {
      chatId,
      user,
      project,
      environment,
      telegramUser,
    };

    try {
      const result = await processWithAgent(transcription.text, agentContext);
      await handleAgentResult(result, chatId, telegramUser, environment);
    } catch (error) {
      console.error('[Agent] Error in voice processWithAgent:', error);
      await processTransactionText(transcription.text, chatId, telegramUser, environment);
    }
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
// Photo Message Handler (Receipt OCR)
// ============================================

export async function handlePhotoMessage(
  message: TelegramMessage,
  environment: Environment
): Promise<void> {
  const chatId = message.chat.id;
  const telegramUser = message.from;

  if (telegramUser == null || message.photo == null || message.photo.length === 0) {
    return;
  }

  // Get the largest photo (best quality - last in array)
  const largestPhoto = message.photo[message.photo.length - 1];

  // Send "processing" indicator
  await sendMessage(
    chatId,
    '📷 _Processing receipt image..._',
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );

  try {
    // Download image from Telegram
    const { blob: imageBlob, mimeType } = await downloadTelegramFile(
      largestPhoto.file_id,
      environment.TELEGRAM_BOT_TOKEN
    );

    // Convert to base64 for GPT-4o Vision
    const imageBase64 = await blobToBase64(imageBlob);

    // Parse receipt with GPT-4o Vision
    const receiptData = await parseReceipt(
      imageBase64,
      environment.OPENAI_API_KEY,
      mimeType
    );

    // Process as transaction
    await processReceiptTransaction(receiptData, chatId, telegramUser, environment);
  } catch (error) {
    console.error('Photo processing error:', error);
    await sendMessage(
      chatId,
      `❌ Failed to process receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
      environment.TELEGRAM_BOT_TOKEN
    );
  }
}

/**
 * Process a parsed receipt into a transaction
 */
async function processReceiptTransaction(
  receiptData: {
    readonly merchant: string;
    readonly amount: number;
    readonly currency: string;
    readonly date: string;
    readonly category: string;
    readonly items?: readonly string[];
    readonly confidence: {
      readonly merchant: number;
      readonly amount: number;
      readonly category: number;
    };
  },
  chatId: number,
  telegramUser: TelegramUser,
  environment: Environment
): Promise<void> {
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

  const membership = await environment.DB.prepare(
    'SELECT display_name FROM project_members WHERE project_id = ? AND user_id = ?'
  ).bind(project.id, user.id).first();
  const payerName = (membership?.display_name as string) ?? userName;

  const participants = await getProjectMembers(environment, project.id);

  // Use receipt data for transaction
  const currency = receiptData.currency;
  const category = receiptData.category;

  const splitResult = splitExpense({
    totalAmount: receiptData.amount,
    currency,
    payer: payerName,
    participants: [...participants],
  });

  const transactionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await environment.DB.prepare(`
    INSERT INTO transactions (id, project_id, user_id, chat_id, merchant, amount, currency, category, location, card_last_four, payer, is_shared, splits, status, created_at, raw_input)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    transactionId,
    project.id,
    user.id,
    chatId,
    receiptData.merchant,
    receiptData.amount,
    currency,
    category,
    null,
    null,
    payerName,
    1,
    JSON.stringify(splitResult.shares),
    TransactionStatus.PENDING,
    createdAt,
    '[receipt image]'
  ).run();

  // Update working memory with the new transaction
  const lastTransaction: LastTransaction = {
    id: transactionId,
    merchant: receiptData.merchant,
    amount: receiptData.amount,
    currency,
    category,
    createdAt,
  };
  await updateMemoryAfterTransaction(environment.DB, user.id, chatId, lastTransaction, '[receipt image]');

  const splitLines = Object.entries(splitResult.shares)
    .map(([person, share]) => `  ${person}: $${share.toFixed(2)}`);

  // Check if we need to show clarification
  const confidenceFactors = receiptData.confidence;
  const needsClarification =
    confidenceFactors.merchant < CLARIFICATION_THRESHOLD ||
    confidenceFactors.amount < CLARIFICATION_THRESHOLD ||
    confidenceFactors.category < CLARIFICATION_THRESHOLD;

  const clarificationSection = needsClarification
    ? generateClarificationMessage(
        { merchant: receiptData.merchant, amount: receiptData.amount, category },
        confidenceFactors
      )
    : [];

  const itemsSection = receiptData.items != null && receiptData.items.length > 0
    ? ['', '*Items:*', ...receiptData.items.map(item => `  • ${item}`)]
    : [];

  const responseParts = [
    `🧾 *Receipt Scanned*`,
    `📁 _${project.name}_`,
    '',
    `📍 ${receiptData.merchant}`,
    `💰 $${receiptData.amount.toFixed(2)} ${currency}`,
    `🏷️ ${category}`,
    `📅 ${receiptData.date}`,
    ...itemsSection,
    '',
    '*Split:*',
    ...splitLines,
    ...clarificationSection,
  ];

  // Build keyboard based on whether clarification is needed
  const inlineKeyboard = needsClarification
    ? [...buildClarificationKeyboard(transactionId, confidenceFactors), [{ text: '🏠 Menu', callback_data: 'menu_main' }]]
    : [
        [
          { text: '✅ Confirm', callback_data: `confirm_${transactionId}` },
          { text: '👤 Personal', callback_data: `personal_${transactionId}` },
        ],
        [
          { text: '✏️ Edit', callback_data: `edit_${transactionId}` },
          { text: '❌ Delete', callback_data: `delete_${transactionId}` },
        ],
        [
          { text: '🏠 Menu', callback_data: 'menu_main' },
        ],
      ];

  await sendMessage(chatId, responseParts.join('\n'), environment.TELEGRAM_BOT_TOKEN, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
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

  // Handle persistent keyboard buttons
  const keyboardCommands: Record<string, string> = {
    '📊 Balance': '/balance',
    '📜 History': '/history',
    '🏠 Menu': '/menu',
    '💸 Settle': '/settle',
    '📁 Projects': '/projects',
  };

  const mappedCommand = keyboardCommands[text];
  if (mappedCommand != null) {
    await handleCommand(mappedCommand, chatId, telegramUser, environment);
    return;
  }

  const trimmedText = text.trim();
  if (trimmedText.length < 2) {
    return;
  }

  // Route through agent for intent classification
  const user = await getOrCreateUser(environment, telegramUser);
  const project = await getCurrentProject(environment, user.id);

  if (project == null) {
    await sendMessage(
      chatId,
      `📁 No project selected.\n\nCreate one with /new or join with /join`,
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  const agentContext: AgentContext = {
    chatId,
    user,
    project,
    environment,
    telegramUser,
  };

  try {
    const result = await processWithAgent(trimmedText, agentContext);
    console.log(`[Agent] Result type: ${result.type}`);

    // Handle agent result
    await handleAgentResult(result, chatId, telegramUser, environment);
  } catch (error) {
    console.error('[Agent] Error in processWithAgent:', error);
    // Fallback to legacy parser on agent error
    await processTransactionText(trimmedText, chatId, telegramUser, environment);
  }
}

// ============================================
// Agent Result Handler
// ============================================

async function handleAgentResult(
  result: Awaited<ReturnType<typeof processWithAgent>>,
  chatId: number,
  telegramUser: TelegramUser,
  environment: Environment
): Promise<void> {
  switch (result.type) {
    case 'delegate': {
      // Delegate to existing handlers
      if (result.handler === 'parseTransaction' && result.input != null) {
        await processTransactionText(result.input, chatId, telegramUser, environment);
      } else if (result.handler === 'handleBalance') {
        await handleCommand('/balance', chatId, telegramUser, environment);
      } else if (result.handler === 'handleUndo') {
        await handleCommand('/undo', chatId, telegramUser, environment);
      } else if (result.handler === 'handleHistory') {
        await handleCommand('/history', chatId, telegramUser, environment);
      }
      break;
    }

    case 'message': {
      await sendMessage(chatId, result.message, environment.TELEGRAM_BOT_TOKEN, {
        parse_mode: result.parseMode ?? 'Markdown',
      });
      break;
    }

    case 'confirm':
    case 'select': {
      await sendMessage(chatId, result.message, environment.TELEGRAM_BOT_TOKEN, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: result.keyboard as Array<Array<{ text: string; callback_data: string }>>,
        },
      });
      break;
    }

    case 'error': {
      await sendMessage(chatId, result.message, environment.TELEGRAM_BOT_TOKEN);
      break;
    }
  }
}

// ============================================
// Clarification Helpers
// ============================================

interface ParsedForClarification {
  readonly merchant: string;
  readonly amount: number;
  readonly category: string;
}

function generateClarificationMessage(
  parsed: ParsedForClarification,
  factors: ConfidenceFactors
): readonly string[] {
  const lowConfidenceFields: string[] = [];

  if (factors.merchant < CLARIFICATION_THRESHOLD) {
    lowConfidenceFields.push(`Merchant: "${parsed.merchant}"?`);
  }
  if (factors.amount < CLARIFICATION_THRESHOLD) {
    lowConfidenceFields.push(`Amount: $${parsed.amount.toFixed(2)}?`);
  }
  if (factors.category < CLARIFICATION_THRESHOLD) {
    lowConfidenceFields.push(`Category: ${parsed.category}?`);
  }

  return lowConfidenceFields.length > 0
    ? ['', '🤔 *Please confirm:*', ...lowConfidenceFields]
    : [];
}

interface InlineButton {
  readonly text: string;
  readonly callback_data: string;
}

function buildClarificationKeyboard(
  transactionId: string,
  factors: ConfidenceFactors
): readonly (readonly InlineButton[])[] {
  const editButtons: InlineButton[] = [];

  // Add edit buttons for low confidence fields
  if (factors.amount < CLARIFICATION_THRESHOLD) {
    editButtons.push({ text: '✏️ Amount', callback_data: `txe_amt_${transactionId}` });
  }
  if (factors.merchant < CLARIFICATION_THRESHOLD) {
    editButtons.push({ text: '✏️ Merchant', callback_data: `txe_mrc_${transactionId}` });
  }
  if (factors.category < CLARIFICATION_THRESHOLD) {
    editButtons.push({ text: '✏️ Category', callback_data: `txe_cat_${transactionId}` });
  }

  // Build keyboard rows
  const keyboard: (readonly InlineButton[])[] = [
    // First row: Confirm (this is correct) + highest priority edit
    [
      { text: '✅ Correct', callback_data: `confirm_${transactionId}` },
      ...(editButtons.length > 0 ? [editButtons[0]] : []),
    ],
  ];

  // Second row: remaining edit buttons or standard options
  if (editButtons.length > 1) {
    keyboard.push(editButtons.slice(1));
  }

  // Last row: Personal + Delete options
  keyboard.push([
    { text: '👤 Personal', callback_data: `personal_${transactionId}` },
    { text: '❌ Delete', callback_data: `delete_${transactionId}` },
  ]);

  return keyboard;
}

// ============================================
// Shared Transaction Processing
// ============================================

export async function processTransactionText(
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
    const membership = await environment.DB.prepare(
      'SELECT display_name FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(project.id, user.id).first();
    const payerName = (membership?.display_name as string) ?? userName;

    const participants = await getProjectMembers(environment, project.id);

    // Fetch similar transactions for few-shot learning (semantic search)
    // Clean text for better embedding match (remove emojis, quotes from voice transcription)
    const cleanedText = text.replace(/^🎤\s*[""]?|[""]?\s*$/g, '').trim();
    const semanticExamples = await getSimilarExamples(environment, cleanedText, { topK: 5, minScore: 0.5 });

    // If no semantic matches, fall back to recent transactions
    const historyExamples = semanticExamples.length > 0
      ? semanticExamples
      : await getRecentExamples(environment.DB, user.id, 5);

    console.log(`[Parser] Using ${semanticExamples.length > 0 ? 'semantic' : 'recent'} examples: ${historyExamples.length}`);

    // Parse transaction with project context and few-shot examples
    const parser = new TransactionParser(environment.OPENAI_API_KEY);
    const { parsed, confidence, confidenceFactors, warnings } = await parser.parseNaturalLanguage(text, {
      participants: [...participants],
      defaultCurrency: project.defaultCurrency,
      defaultLocation: project.defaultLocation ?? undefined,
      examples: historyExamples,
    });

    // Parser uses project defaults, but ensure location isn't empty string
    const currency = parsed.currency;
    const location = (parsed.location != null && parsed.location !== '')
      ? parsed.location
      : null;

    const splitResult = splitExpense({
      totalAmount: parsed.amount,
      currency,
      payer: payerName,
      participants: [...participants],
      excludedParticipants: parsed.excludedParticipants != null ? [...parsed.excludedParticipants] : [],
      customSplits: parsed.customSplits,
    });
    const transactionId = crypto.randomUUID();

    const createdAt = new Date().toISOString();

    await environment.DB.prepare(`
      INSERT INTO transactions (id, project_id, user_id, chat_id, merchant, amount, currency, category, location, card_last_four, payer, is_shared, splits, status, created_at, raw_input)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      transactionId,
      project.id,
      user.id,
      chatId,
      parsed.merchant,
      parsed.amount,
      currency,
      parsed.category,
      location,
      parsed.cardLastFour ?? null,
      payerName,
      1,
      JSON.stringify(splitResult.shares),
      TransactionStatus.PENDING,
      createdAt,
      text
    ).run();

    // Update working memory with the new transaction
    const lastTransaction: LastTransaction = {
      id: transactionId,
      merchant: parsed.merchant,
      amount: parsed.amount,
      currency,
      category: parsed.category,
      createdAt,
    };
    await updateMemoryAfterTransaction(environment.DB, user.id, chatId, lastTransaction, text);

    const splitLines = Object.entries(splitResult.shares)
      .map(([person, share]) => `  ${person}: $${share.toFixed(2)}`);

    // TODO: Re-enable card recommendations when ready
    // const userCards = await getUserCards(environment, user.id);
    // const foreignCheck = detectForeignByLocation(location ?? undefined, parsed.currency);
    // const cardRecommendation = recommendCard(parsed, [...userCards], foreignCheck.isForeign);

    const warningsSection = warnings != null && warnings.length > 0
      ? ['', `⚠️ ${warnings.join(', ')}`]
      : [];

    // Check if we need to show clarification
    const needsClarification = confidenceFactors != null && (
      confidenceFactors.merchant < CLARIFICATION_THRESHOLD ||
      confidenceFactors.amount < CLARIFICATION_THRESHOLD ||
      confidenceFactors.category < CLARIFICATION_THRESHOLD
    );

    const clarificationSection = needsClarification
      ? generateClarificationMessage(parsed, confidenceFactors)
      : [];

    const confidenceSection = confidence < 1 && !needsClarification
      ? ['', `_Confidence: ${(confidence * 100).toFixed(0)}%_`]
      : [];

    const responseParts = [
      `💳 *New Transaction*`,
      `📁 _${project.name}_`,
      '',
      `📍 ${parsed.merchant}${location != null ? ` (${location})` : ''}`,
      `💰 $${parsed.amount.toFixed(2)} ${currency}`,
      `🏷️ ${parsed.category}`,
      `📅 ${parsed.date}`,
      '',
      '*Split:*',
      ...splitLines,
      ...warningsSection,
      ...clarificationSection,
      ...confidenceSection,
    ];

    // Build keyboard based on whether clarification is needed
    const inlineKeyboard = needsClarification
      ? [...buildClarificationKeyboard(transactionId, confidenceFactors), [{ text: '🏠 Menu', callback_data: 'menu_main' }]]
      : [
          [
            { text: '✅ Confirm', callback_data: `confirm_${transactionId}` },
            { text: '👤 Personal', callback_data: `personal_${transactionId}` },
          ],
          [
            { text: '✏️ Edit', callback_data: `edit_${transactionId}` },
            { text: '❌ Delete', callback_data: `delete_${transactionId}` },
          ],
          [
            { text: '🏠 Menu', callback_data: 'menu_main' },
          ],
        ];

    await sendMessage(chatId, responseParts.join('\n'), environment.TELEGRAM_BOT_TOKEN, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: inlineKeyboard,
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
