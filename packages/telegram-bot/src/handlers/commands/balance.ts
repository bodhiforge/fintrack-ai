/**
 * Balance and Settlement Command Handlers
 */

import { calculateBalances, simplifyDebts, formatSettlements, type Transaction } from '@fintrack-ai/core';
import type { CommandHandlerContext } from './index.js';
import { sendMessage } from '../../telegram/api.js';
import { rowToTransaction } from '../../db/index.js';
import { TransactionStatus } from '../../constants.js';

export async function handleBalance(context: CommandHandlerContext): Promise<void> {
  const { chatId, project, environment } = context;

  if (project == null) {
    await sendMessage(
      chatId,
      '📁 No project selected.\n\nCreate one with /new or join with /join',
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  const projectId = project.id;
  const balanceRows = await environment.DB.prepare(`
    SELECT * FROM transactions
    WHERE project_id = ? AND status = ? AND is_shared = 1
      AND created_at > datetime('now', '-30 days')
    ORDER BY created_at DESC
    LIMIT 200
  `).bind(projectId, TransactionStatus.CONFIRMED).all();

  if (balanceRows.results == null || balanceRows.results.length === 0) {
    await sendMessage(
      chatId,
      `📊 No confirmed expenses in *${project.name}*`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const transactions = balanceRows.results.map((row) =>
    rowToTransaction(row as Record<string, unknown>)
  );

  const byCurrency = groupTransactionsByCurrency(transactions);

  const currencySections = Object.entries(byCurrency).map(([currency, currencyTransactions]) => {
    // Calculate summary stats
    const totalSpent = currencyTransactions.reduce((sum, t) => sum + t.amount, 0);
    const paidByPerson = currencyTransactions.reduce<Record<string, number>>((accumulator, t) => ({
      ...accumulator,
      [t.payer]: (accumulator[t.payer] ?? 0) + t.amount,
    }), {});

    // Format paid by lines
    const paidByLines = Object.entries(paidByPerson)
      .sort(([, a], [, b]) => b - a)
      .map(([person, amount]) => {
        const percentage = Math.round((amount / totalSpent) * 100);
        return `  • ${person}: $${amount.toFixed(2)} (${percentage}%)`;
      });

    return {
      currency,
      totalSpent,
      paidByLines,
    };
  });

  if (currencySections.length === 0) {
    await sendMessage(chatId, '📊 All balanced! No one owes anything.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const messageLines = [`📊 *${project.name} Summary*`, ''];

  currencySections.forEach(section => {
    messageLines.push(`*${section.currency}:*`);
    messageLines.push(`Total: $${section.totalSpent.toFixed(2)}`);
    messageLines.push('');
    messageLines.push('Paid by:');
    messageLines.push(...section.paidByLines);
    messageLines.push('');
  });

  const message = messageLines.join('\n');

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
}

export async function handleSettle(context: CommandHandlerContext): Promise<void> {
  const { chatId, project, environment } = context;

  if (project == null) {
    await sendMessage(
      chatId,
      '📁 No project selected.\n\nCreate one with /new or join with /join',
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  const settleRows = await environment.DB.prepare(`
    SELECT * FROM transactions
    WHERE project_id = ? AND status = ? AND is_shared = 1
      AND created_at > datetime('now', '-30 days')
    ORDER BY created_at DESC
    LIMIT 200
  `).bind(project.id, TransactionStatus.CONFIRMED).all();

  if (settleRows.results == null || settleRows.results.length === 0) {
    await sendMessage(
      chatId,
      `💸 No expenses to settle in *${project.name}*`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const allTransactions = settleRows.results.map((row) =>
    rowToTransaction(row as Record<string, unknown>)
  );

  const byCurrency = groupTransactionsByCurrency(allTransactions);

  const settlementLines = Object.entries(byCurrency).flatMap(([currency, currencyTransactions]) => {
    const settlements = simplifyDebts(currencyTransactions, currency);
    if (settlements.length === 0) return [];
    return ['', `*${currency}:*`, formatSettlements(settlements)];
  });

  if (settlementLines.length === 0) {
    await sendMessage(chatId, '💸 All settled! No payments needed.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const message = [
    `💸 *${project.name} Settlement*`,
    ...settlementLines,
  ].join('\n');

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
}

export async function handleHistory(context: CommandHandlerContext): Promise<void> {
  return handleHistoryPage(context, 0);
}

export async function handleHistoryPage(
  context: CommandHandlerContext,
  page: number
): Promise<void> {
  const { chatId, project, environment } = context;
  const pageSize = 10;
  const offset = page * pageSize;

  if (project == null) {
    await sendMessage(
      chatId,
      '📁 No project selected.\n\nCreate one with /new or join with /join',
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  // Get total count for pagination
  const countResult = await environment.DB.prepare(`
    SELECT COUNT(*) as total FROM transactions
    WHERE project_id = ? AND status IN (?, ?)
  `).bind(project.id, TransactionStatus.CONFIRMED, TransactionStatus.PERSONAL).first();
  const total = (countResult?.total as number) ?? 0;

  const historyRows = await environment.DB.prepare(`
    SELECT * FROM transactions
    WHERE project_id = ? AND status IN (?, ?)
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(project.id, TransactionStatus.CONFIRMED, TransactionStatus.PERSONAL, pageSize, offset).all();

  if (historyRows.results == null || historyRows.results.length === 0) {
    await sendMessage(
      chatId,
      `📜 No history in *${project.name}*`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Store transaction IDs for this page in a simple mapping
  const txIds = historyRows.results.map((row: Record<string, unknown>) => row.id as string);

  // Build numbered list
  const historyLines = historyRows.results.map((row: Record<string, unknown>, index: number) => {
    const date = new Date(row.created_at as string).toLocaleDateString('en-CA');
    const status = row.status === TransactionStatus.PERSONAL ? '👤' : '✅';
    const num = offset + index + 1;
    const category = row.category as string;
    const payer = row.payer as string;
    const payerTag = row.status === TransactionStatus.PERSONAL ? '' : ` | ${payer}`;
    return `${num}. ${status} ${date} | ${row.merchant} | ${category} | $${(row.amount as number).toFixed(2)}${payerTag}`;
  });

  const hasMore = total > offset + pageSize;
  const hasPrev = page > 0;

  // Build buttons - store page number instead of all IDs (callback_data limit is 64 bytes)
  const buttons: Array<{ text: string; callback_data: string }> = [];
  if (hasPrev) {
    buttons.push({ text: '⬅️ Prev', callback_data: `hist_${page - 1}` });
  }
  buttons.push({ text: '✏️ Edit', callback_data: `hist_edit_${page}` });
  if (hasMore) {
    buttons.push({ text: 'More ➡️', callback_data: `hist_${page + 1}` });
  }

  const pageInfo = total > pageSize ? `\n_Page ${page + 1} of ${Math.ceil(total / pageSize)}_` : '';

  const message = [
    `📜 *${project.name} History*`,
    '',
    ...historyLines,
    pageInfo,
  ].join('\n');

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [buttons],
    },
  });
}

export async function handleUndo(context: CommandHandlerContext): Promise<void> {
  const { chatId, user, project, environment } = context;

  if (project == null) {
    await sendMessage(
      chatId,
      '📁 No project selected.\n\nCreate one with /new or join with /join',
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  // Find the user's last confirmed/personal transaction in this project
  const lastTransaction = await environment.DB.prepare(`
    SELECT * FROM transactions
    WHERE project_id = ? AND user_id = ? AND status IN (?, ?)
    ORDER BY confirmed_at DESC, created_at DESC
    LIMIT 1
  `).bind(project.id, user.id, TransactionStatus.CONFIRMED, TransactionStatus.PERSONAL).first();

  if (lastTransaction == null) {
    await sendMessage(
      chatId,
      '⏪ No transactions to undo.',
      environment.TELEGRAM_BOT_TOKEN
    );
    return;
  }

  const transactionId = lastTransaction.id as string;
  const merchant = lastTransaction.merchant as string;
  const amount = lastTransaction.amount as number;
  const previousStatus = lastTransaction.status as string;

  // Revert to pending
  await environment.DB.prepare(`
    UPDATE transactions SET status = ?, confirmed_at = NULL WHERE id = ?
  `).bind(TransactionStatus.PENDING, transactionId).run();

  const statusText = previousStatus === TransactionStatus.PERSONAL ? 'personal' : 'confirmed';

  await sendMessage(
    chatId,
    [
      `⏪ *Undo: ${merchant}* ($${amount.toFixed(2)})`,
      '',
      `Reverted from ${statusText} to pending.`,
      '',
      '_What would you like to do?_',
    ].join('\n'),
    environment.TELEGRAM_BOT_TOKEN,
    {
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
    }
  );
}

function groupTransactionsByCurrency(
  transactions: readonly Transaction[]
): Readonly<Record<string, readonly Transaction[]>> {
  return transactions.reduce<Record<string, Transaction[]>>((accumulator, transaction) => {
    const currency = transaction.currency;
    const existing = accumulator[currency] ?? [];
    return {
      ...accumulator,
      [currency]: [...existing, transaction],
    };
  }, {});
}
