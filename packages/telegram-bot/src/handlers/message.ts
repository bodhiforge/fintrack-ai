/**
 * Message Handlers
 */

import type { Environment, TelegramMessage, TelegramUser } from '../types.js';
import { getOrCreateUser, getCurrentProject } from '../db/index.js';
import { sendMessage } from '../telegram/api.js';
import { detectCityFromCoords } from '../utils/index.js';
import { handleCommand } from './commands/index.js';
import { transcribeAudio, downloadTelegramFile } from '../services/whisper.js';
import { parseReceipt, blobToBase64 } from '../services/vision.js';
import { processWithAgent, type AgentContext, type AgentResponse } from '../agent/index.js';

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

  await sendMessage(
    chatId,
    '🎤 _Processing voice message..._',
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );

  try {
    const { blob: audioBlob } = await downloadTelegramFile(
      message.voice.file_id,
      environment.TELEGRAM_BOT_TOKEN
    );

    const transcription = await transcribeAudio(audioBlob, environment.OPENAI_API_KEY);

    if (transcription.text === '') {
      await sendMessage(
        chatId,
        '❌ Could not understand the voice message. Please try again.',
        environment.TELEGRAM_BOT_TOKEN
      );
      return;
    }

    await sendMessage(
      chatId,
      `🎤 _"${transcription.text}"_`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );

    const agentContext = await buildAgentContext(chatId, telegramUser, environment);
    if (agentContext == null) {
      return;
    }

    const response = await processWithAgent(transcription.text, agentContext);
    await sendAgentResponse(response, chatId, environment.TELEGRAM_BOT_TOKEN);
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

  const largestPhoto = message.photo[message.photo.length - 1];

  await sendMessage(
    chatId,
    '📷 _Processing receipt image..._',
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );

  try {
    const { blob: imageBlob, mimeType } = await downloadTelegramFile(
      largestPhoto.file_id,
      environment.TELEGRAM_BOT_TOKEN
    );

    const imageBase64 = await blobToBase64(imageBlob);

    const receiptData = await parseReceipt(
      imageBase64,
      environment.OPENAI_API_KEY,
      mimeType
    );

    // Format receipt as text and route through agent
    const receiptText = formatReceiptForAgent(receiptData);

    const agentContext = await buildAgentContext(chatId, telegramUser, environment);
    if (agentContext == null) {
      return;
    }

    const response = await processWithAgent(receiptText, agentContext);
    await sendAgentResponse(response, chatId, environment.TELEGRAM_BOT_TOKEN);
  } catch (error) {
    console.error('Photo processing error:', error);
    await sendMessage(
      chatId,
      `❌ Failed to process receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

  // Handle persistent keyboard buttons
  const keyboardCommands: Record<string, string> = {
    '🏠': '/menu',
    '💰': '/balance',
    '📜': '/history',
    '↩️': '/undo',
    '🏠 Menu': '/menu',
    '💰 Balance': '/balance',
    '📊 Balance': '/balance',
    '📜 History': '/history',
    '💸 Settle': '/settle',
    '📁 Projects': '/projects',
    '↩️ Undo': '/undo',
    '❓ Help': '/help',
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

  const agentContext = await buildAgentContext(chatId, telegramUser, environment);
  if (agentContext == null) {
    return;
  }

  try {
    const response = await processWithAgent(trimmedText, agentContext);
    console.log(`[Agent] Response: ${response.text.substring(0, 80)}...`);
    await sendAgentResponse(response, chatId, environment.TELEGRAM_BOT_TOKEN);
  } catch (error) {
    console.error('[Agent] Error in processWithAgent:', error);
    await sendMessage(
      chatId,
      `❌ Something went wrong. Please try again.`,
      environment.TELEGRAM_BOT_TOKEN
    );
  }
}

// ============================================
// Helpers
// ============================================

async function buildAgentContext(
  chatId: number,
  telegramUser: TelegramUser,
  environment: Environment
): Promise<AgentContext | null> {
  const user = await getOrCreateUser(environment, telegramUser);
  const project = await getCurrentProject(environment, user.id);

  if (project == null) {
    await sendMessage(
      chatId,
      `📁 No project selected.\n\nCreate one with /new or join with /join`,
      environment.TELEGRAM_BOT_TOKEN
    );
    return null;
  }

  return { chatId, user, project, environment, telegramUser };
}

async function sendAgentResponse(
  response: AgentResponse,
  chatId: number,
  botToken: string
): Promise<void> {
  await sendMessage(chatId, response.text, botToken, {
    parse_mode: 'Markdown',
    ...(response.keyboard != null ? {
      reply_markup: {
        inline_keyboard: response.keyboard as Array<Array<{ text: string; callback_data: string }>>,
      },
    } : {}),
  });
}

function formatReceiptForAgent(receiptData: {
  readonly merchant: string;
  readonly amount: number;
  readonly currency: string;
  readonly date: string;
  readonly category: string;
  readonly items?: readonly string[];
}): string {
  const items = receiptData.items != null && receiptData.items.length > 0
    ? ` (items: ${receiptData.items.join(', ')})`
    : '';
  return `Receipt: ${receiptData.merchant} $${receiptData.amount.toFixed(2)} ${receiptData.currency} ${receiptData.category} on ${receiptData.date}${items}`;
}
