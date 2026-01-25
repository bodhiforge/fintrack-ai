/**
 * Evaluation system types
 */

// ============================================
// Expected Value Types
// ============================================

export type ExpectedValue<T> =
  | { exact: T }
  | { oneOf: T[] }
  | { pattern: string }
  | { range: { min: number; max: number } }
  | { skip: true };

// ============================================
// Test Case
// ============================================

export interface EvalTestCase {
  id: string;
  input: string;
  participants?: string[];

  expected: {
    merchant?: ExpectedValue<string>;
    amount?: ExpectedValue<number>;
    currency?: ExpectedValue<string>;
    category?: ExpectedValue<string>;
    date?: ExpectedValue<string>;
    excludedParticipants?: ExpectedValue<string[]>;
    customSplits?: ExpectedValue<Record<string, number>>;
  };

  metadata?: {
    tags?: string[];
    difficulty?: 'easy' | 'medium' | 'hard';
    note?: string;
  };
}

export interface EvalDataset {
  version: string;
  cases: EvalTestCase[];
}

// ============================================
// Results
// ============================================

export interface FieldResult {
  field: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export interface TestResult {
  testId: string;
  input: string;
  passed: boolean;
  fieldResults: FieldResult[];
  durationMs: number;
}

// ============================================
// Metrics
// ============================================

export interface FieldMetrics {
  field: string;
  total: number;
  correct: number;
  accuracy: number;
  errors: Array<{
    testId: string;
    input: string;
    expected: unknown;
    actual: unknown;
  }>;
}

export interface TagMetrics {
  tag: string;
  total: number;
  passed: number;
  accuracy: number;
}

export interface EvalReport {
  timestamp: string;
  model: string;
  datasetVersion: string;

  summary: {
    totalCases: number;
    passedCases: number;
    overallAccuracy: number;
    durationMs: number;
  };

  fieldMetrics: FieldMetrics[];
  tagMetrics: TagMetrics[];
  failures: TestResult[];
}
