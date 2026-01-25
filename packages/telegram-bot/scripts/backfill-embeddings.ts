/**
 * Backfill embeddings for existing transactions
 * Run with: npx wrangler dev --local then fetch /backfill-embeddings
 */

import OpenAI from 'openai';

interface TransactionRow {
  readonly id: string;
  readonly merchant: string;
  readonly amount: number;
  readonly category: string;
  readonly currency: string;
  readonly location: string | null;
}

export async function backfillEmbeddings(
  db: D1Database,
  vectorize: VectorizeIndex,
  openaiApiKey: string
): Promise<{ readonly processed: number; readonly errors: number }> {
  const client = new OpenAI({ apiKey: openaiApiKey });

  // Fetch all confirmed/personal transactions
  const result = await db.prepare(`
    SELECT id, merchant, amount, category, currency, location
    FROM transactions
    WHERE status IN ('confirmed', 'personal')
  `).all();

  const transactions = (result.results ?? []) as unknown as readonly TransactionRow[];
  console.log(`[Backfill] Found ${transactions.length} transactions to process`);

  let processed = 0;
  let errors = 0;

  // Process in batches of 10
  const batchSize = 10;
  const batches = [];
  for (let i = 0; i < transactions.length; i += batchSize) {
    batches.push(transactions.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    try {
      // Generate embeddings for batch
      const texts = batch.map(t => {
        const parts = [t.merchant, `$${t.amount}`, t.category, t.currency];
        if (t.location != null) parts.push(t.location);
        return parts.join(' ');
      });

      const embedResponse = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: texts,
      });

      // Upsert to Vectorize
      const vectors = batch.map((t, i) => ({
        id: t.id,
        values: embedResponse.data[i].embedding,
        metadata: {
          merchant: t.merchant,
          amount: t.amount,
          category: t.category,
          currency: t.currency,
          location: t.location ?? '',
        },
      }));

      await vectorize.upsert(vectors);
      processed += batch.length;
      console.log(`[Backfill] Processed ${processed}/${transactions.length}`);
    } catch (error) {
      console.error('[Backfill] Batch error:', error);
      errors += batch.length;
    }
  }

  return { processed, errors };
}
