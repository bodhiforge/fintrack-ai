/**
 * Transaction Edit Command Handlers
 */

import type { CommandHandlerContext } from './index.js';
import { sendMessage } from '../../telegram/api.js';
import { getProjectMembers } from '../../db/index.js';
import { DEFAULT_PROJECT_ID } from '../../constants.js';

export async function handleEditAmount(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, project, environment } = context;

  const [transactionId, ...amountParts] = args;
  const newAmount = parseFloat(amountParts.join(''));

  if (transactionId == null || isNaN(newAmount)) {
    await sendMessage(chatId, '❌ Usage: /editamount <txId> <amount>', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const transaction = await environment.DB.prepare(
    'SELECT id FROM transactions WHERE id = ? AND project_id = ?'
  ).bind(transactionId, project?.id ?? DEFAULT_PROJECT_ID).first();

  if (transaction == null) {
    await sendMessage(chatId, '❌ Transaction not found or no permission.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  await environment.DB.prepare('UPDATE transactions SET amount = ? WHERE id = ?')
    .bind(newAmount, transactionId).run();

  await sendMessage(chatId, `✅ Amount updated to $${newAmount.toFixed(2)}`, environment.TELEGRAM_BOT_TOKEN);
}

export async function handleEditMerchant(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, project, environment } = context;

  const [transactionId, ...merchantParts] = args;
  const newMerchant = merchantParts.join(' ').replace(/"/g, '').trim();

  if (transactionId == null || newMerchant === '') {
    await sendMessage(chatId, '❌ Usage: /editmerchant <txId> <name>', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const transaction = await environment.DB.prepare(
    'SELECT id FROM transactions WHERE id = ? AND project_id = ?'
  ).bind(transactionId, project?.id ?? DEFAULT_PROJECT_ID).first();

  if (transaction == null) {
    await sendMessage(chatId, '❌ Transaction not found or no permission.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  await environment.DB.prepare('UPDATE transactions SET merchant = ? WHERE id = ?')
    .bind(newMerchant, transactionId).run();

  await sendMessage(
    chatId,
    `✅ Merchant updated to *${newMerchant}*`,
    environment.TELEGRAM_BOT_TOKEN,
    { parse_mode: 'Markdown' }
  );
}

export async function handleEditSplit(context: CommandHandlerContext): Promise<void> {
  const { args, chatId, user, project, environment } = context;

  const [transactionId, ...splitParts] = args;
  const splitText = splitParts.join(' ').trim();

  if (transactionId == null || splitText === '') {
    await sendMessage(
      chatId,
      '❌ Usage: /editsplit <txId> <splits>\nExample: /editsplit abc123 Bodhi 30, Sherry 20',
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  const transaction = await environment.DB.prepare(
    'SELECT * FROM transactions WHERE id = ? AND project_id = ?'
  ).bind(transactionId, project?.id ?? DEFAULT_PROJECT_ID).first();

  if (transaction == null) {
    await sendMessage(chatId, '❌ Transaction not found.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const newSplits: Readonly<Record<string, number>> = await (async () => {
    if (splitText.toLowerCase() === 'equal') {
      const members = project != null
        ? await getProjectMembers(environment, project.id)
        : [user.firstName ?? 'User', 'Sherry'];
      const share = (transaction.amount as number) / members.length;
      return Object.fromEntries(
        [...members].map(member => [member, Math.round(share * 100) / 100])
      );
    }

    const parts = splitText.split(',').map(p => p.trim());
    return parts.reduce<Record<string, number>>((accumulator, part) => {
      const match = part.match(/^(.+?)\s+([\d.]+)$/);
      if (match != null) {
        return { ...accumulator, [match[1].trim()]: parseFloat(match[2]) };
      }
      return accumulator;
    }, {});
  })();

  if (Object.keys(newSplits).length === 0) {
    await sendMessage(
      chatId,
      '❌ Could not parse splits. Use format: "Bodhi 30, Sherry 20"',
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  await environment.DB.prepare('UPDATE transactions SET splits = ? WHERE id = ?')
    .bind(JSON.stringify(newSplits), transactionId).run();

  const splitDisplay = Object.entries(newSplits)
    .map(([name, amount]) => `${name}: $${amount.toFixed(2)}`)
    .join(', ');

  await sendMessage(chatId, `✅ Split updated: ${splitDisplay}`, environment.TELEGRAM_BOT_TOKEN);
}
