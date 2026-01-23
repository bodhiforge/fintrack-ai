/**
 * Command Router - Map-based routing
 */

import type { Project, User } from '@fintrack-ai/core';
import type { Environment, TelegramUser } from '../../types.js';
import { getOrCreateUser, getCurrentProject } from '../../db/index.js';
import { sendMessage } from '../../telegram/api.js';

// Import command handlers
import { handleMenu, handleHelp } from './menu.js';
import {
  handleNewProject,
  handleJoin,
  handleSwitch,
  handleProjects,
  handleInvite,
  handleLeave,
  handleArchive,
  handleUnarchive,
  handleDeleteProject,
  handleRename,
  handleSetLocation,
  handleSetCurrency,
} from './projects.js';
import { handleBalance, handleSettle, handleHistory, handleUndo } from './balance.js';
import { handleCards, handleAddCard, handleRemoveCard } from './cards.js';
import { handleEditAmount, handleEditMerchant, handleEditSplit } from './edit.js';

// ============================================
// Command Context
// ============================================

export interface CommandHandlerContext {
  readonly args: readonly string[];
  readonly chatId: number;
  readonly user: User;
  readonly project: Project | null;
  readonly telegramUser: TelegramUser;
  readonly environment: Environment;
}

type CommandHandler = (context: CommandHandlerContext) => Promise<void>;

// ============================================
// Command Registry
// ============================================

const commandHandlers = new Map<string, CommandHandler>([
  // Menu commands
  ['/start', handleMenu],
  ['/menu', handleMenu],
  ['/m', handleMenu],
  ['/help', handleHelp],
  ['/h', handleHelp],

  // Project commands
  ['/newproject', handleNewProject],
  ['/new', handleNewProject],
  ['/join', handleJoin],
  ['/switch', handleSwitch],
  ['/projects', handleProjects],
  ['/p', handleProjects],
  ['/invite', handleInvite],
  ['/leave', handleLeave],
  ['/archive', handleArchive],
  ['/unarchive', handleUnarchive],
  ['/deleteproject', handleDeleteProject],
  ['/delproj', handleDeleteProject],
  ['/rename', handleRename],
  ['/setlocation', handleSetLocation],
  ['/setcurrency', handleSetCurrency],

  // Balance commands
  ['/balance', handleBalance],
  ['/b', handleBalance],
  ['/settle', handleSettle],
  ['/s', handleSettle],
  ['/history', handleHistory],
  ['/hi', handleHistory],
  ['/undo', handleUndo],
  ['/u', handleUndo],

  // Card commands
  ['/cards', handleCards],
  ['/c', handleCards],
  ['/addcard', handleAddCard],
  ['/removecard', handleRemoveCard],

  // Edit commands
  ['/editamount', handleEditAmount],
  ['/editmerchant', handleEditMerchant],
  ['/editsplit', handleEditSplit],
]);

// ============================================
// Main Command Handler
// ============================================

export async function handleCommand(
  text: string,
  chatId: number,
  telegramUser: TelegramUser,
  environment: Environment
): Promise<void> {
  const [command, ...args] = text.split(' ');
  const user = await getOrCreateUser(environment, telegramUser);
  const project = await getCurrentProject(environment, user.id);

  const handler = commandHandlers.get(command);

  if (handler != null) {
    await handler({
      args,
      chatId,
      user,
      project,
      telegramUser,
      environment,
    });
  } else {
    await sendMessage(
      chatId,
      `Unknown command. Try /help`,
      environment.TELEGRAM_BOT_TOKEN
    );
  }
}
