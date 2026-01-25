/**
 * Embedding Service
 * Generates embeddings using OpenAI text-embedding-3-small
 * Stores and retrieves from Cloudflare Vectorize
 */

import OpenAI from 'openai';
import type { Environment } from '../types.js';

// ============================================
// Types
// ============================================

export interface TransactionEmbedding {
  readonly id: string;
  readonly merchant: string;
  readonly amount: number;
  readonly category: string;
  readonly currency: string;
  readonly location?: string;
}

export interface SimilarTransaction {
  readonly id: string;
  readonly merchant: string;
  readonly amount: number;
  readonly category: string;
  readonly currency: string;
  readonly location?: string;
  readonly score: number;
}

// ============================================
// Embedding Service
// ============================================

export class EmbeddingService {
  private readonly client: OpenAI;
  private readonly vectorize: VectorizeIndex;
  private readonly model = 'text-embedding-3-small';

  constructor(environment: Environment) {
    this.client = new OpenAI({ apiKey: environment.OPENAI_API_KEY });
    this.vectorize = environment.VECTORIZE;
  }

  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<readonly number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }

  /**
   * Create searchable text from transaction
   */
  private createSearchText(transaction: TransactionEmbedding): string {
    const parts = [
      transaction.merchant,
      `$${transaction.amount}`,
      transaction.category,
      transaction.currency,
    ];
    if (transaction.location != null) {
      parts.push(transaction.location);
    }
    return parts.join(' ');
  }

  /**
   * Store transaction embedding in Vectorize
   */
  async storeTransaction(transaction: TransactionEmbedding): Promise<void> {
    const text = this.createSearchText(transaction);
    const embedding = await this.embed(text);

    await this.vectorize.upsert([
      {
        id: transaction.id,
        values: embedding as number[],
        metadata: {
          merchant: transaction.merchant,
          amount: transaction.amount,
          category: transaction.category,
          currency: transaction.currency,
          location: transaction.location ?? '',
        },
      },
    ]);

    console.log(`[Embedding] Stored embedding for transaction ${transaction.id}: "${text}"`);
  }

  /**
   * Find similar transactions by text query
   */
  async findSimilar(
    query: string,
    options?: { readonly topK?: number; readonly minScore?: number }
  ): Promise<readonly SimilarTransaction[]> {
    const topK = options?.topK ?? 5;
    const minScore = options?.minScore ?? 0.7;

    const embedding = await this.embed(query);
    const results = await this.vectorize.query(embedding as number[], {
      topK,
      returnMetadata: 'all',
    });

    return results.matches
      .filter(match => match.score >= minScore)
      .map(match => ({
        id: match.id,
        merchant: (match.metadata?.merchant as string) ?? '',
        amount: (match.metadata?.amount as number) ?? 0,
        category: (match.metadata?.category as string) ?? '',
        currency: (match.metadata?.currency as string) ?? '',
        location: (match.metadata?.location as string) || undefined,
        score: match.score,
      }));
  }

  /**
   * Delete transaction embedding
   */
  async deleteTransaction(transactionId: string): Promise<void> {
    await this.vectorize.deleteByIds([transactionId]);
    console.log(`[Embedding] Deleted embedding for transaction ${transactionId}`);
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Format similar transactions as few-shot examples for parser
 */
export function formatFewShotExamples(
  transactions: readonly SimilarTransaction[]
): string {
  if (transactions.length === 0) {
    return '';
  }

  const examples = transactions.map(transaction => {
    const input = `${transaction.merchant} ${transaction.amount}`;
    return `- "${input}" → ${transaction.category}, ${transaction.currency}${transaction.location != null ? `, ${transaction.location}` : ''}`;
  });

  return `Based on similar past transactions:\n${examples.join('\n')}`;
}
