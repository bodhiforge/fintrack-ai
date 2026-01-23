/**
 * Balance and Settlement Command Handlers
 */

import { calculateBalances, simplifyDebts, formatSettlements, type Transaction } from '@fintrack-ai/core';
import type { CommandHandlerContext } from './index.js';
import { sendMessage } from '../../telegram/api.js';
import { rowToTransaction } from '../../db/index.js';
import { TransactionStatus, DEFAULT_PROJECT_ID } from '../../constants.js';

export async function handleBalance(context: CommandHandlerContext): Promise<void> {
  const { chatId, project, environment } = context;

  const projectId = project?.id ?? DEFAULT_PROJECT_ID;
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
      `📊 No confirmed expenses in *${project?.name ?? 'Daily'}*`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const transactions = balanceRows.results.map((row) =>
    rowToTransaction(row as Record<string, unknown>)
  );

  const byCurrency = groupTransactionsByCurrency(transactions);

  const currencyBalanceLines = Object.entries(byCurrency).flatMap(([currency, currencyTransactions]) => {
    const balances = calculateBalances(currencyTransactions);
    if (balances.length === 0) return [];

    const balanceLines = balances.map(balance => {
      const emoji = balance.netBalance > 0 ? '💚' : '🔴';
      const status = balance.netBalance > 0 ? 'is owed' : 'owes';
      return `${emoji} ${balance.person} ${status} $${Math.abs(balance.netBalance).toFixed(2)}`;
    });

    return ['', `*${currency}:*`, ...balanceLines];
  });

  if (currencyBalanceLines.length === 0) {
    await sendMessage(chatId, '📊 All balanced! No one owes anything.', environment.TELEGRAM_BOT_TOKEN);
    return;
  }

  const message = [
    `📊 *${project?.name ?? 'Daily'} Balances*`,
    ...currencyBalanceLines,
  ].join('\n');

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
}

export async function handleSettle(context: CommandHandlerContext): Promise<void> {
  const { chatId, project, environment } = context;

  const projectId = project?.id ?? DEFAULT_PROJECT_ID;
  const settleRows = await environment.DB.prepare(`
    SELECT * FROM transactions
    WHERE project_id = ? AND status = ? AND is_shared = 1
      AND created_at > datetime('now', '-30 days')
    ORDER BY created_at DESC
    LIMIT 200
  `).bind(projectId, TransactionStatus.CONFIRMED).all();

  if (settleRows.results == null || settleRows.results.length === 0) {
    await sendMessage(
      chatId,
      `💸 No expenses to settle in *${project?.name ?? 'Daily'}*`,
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
    `💸 *${project?.name ?? 'Daily'} Settlement*`,
    ...settlementLines,
  ].join('\n');

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
}

export async function handleHistory(context: CommandHandlerContext): Promise<void> {
  const { chatId, project, environment } = context;

  const projectId = project?.id ?? DEFAULT_PROJECT_ID;
  const historyRows = await environment.DB.prepare(`
    SELECT * FROM transactions
    WHERE project_id = ? AND status IN (?, ?)
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(projectId, TransactionStatus.CONFIRMED, TransactionStatus.PERSONAL).all();

  if (historyRows.results == null || historyRows.results.length === 0) {
    await sendMessage(
      chatId,
      `📜 No history in *${project?.name ?? 'Daily'}*`,
      environment.TELEGRAM_BOT_TOKEN,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const historyLines = historyRows.results.map((row: Record<string, unknown>) => {
    const date = new Date(row.created_at as string).toLocaleDateString('en-CA');
    const status = row.status === TransactionStatus.PERSONAL ? '👤' : '✅';
    return `${status} ${date} | ${row.merchant} | $${(row.amount as number).toFixed(2)}`;
  });

  const message = [
    `📜 *${project?.name ?? 'Daily'} History*`,
    '',
    ...historyLines,
  ].join('\n');

  await sendMessage(chatId, message, environment.TELEGRAM_BOT_TOKEN, { parse_mode: 'Markdown' });
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
