/**
 * Evaluation metrics calculation
 */

import type {
  TestResult,
  FieldMetrics,
  TagMetrics,
  EvalReport,
  EvalTestCase,
} from './types.js';

// ============================================
// Calculate Metrics
// ============================================

export function calculateFieldMetrics(results: TestResult[]): FieldMetrics[] {
  const fieldStats = new Map<string, {
    total: number;
    correct: number;
    errors: FieldMetrics['errors'];
  }>();

  for (const result of results) {
    for (const fr of result.fieldResults) {
      const stats = fieldStats.get(fr.field) ?? { total: 0, correct: 0, errors: [] };
      stats.total++;
      if (fr.passed) {
        stats.correct++;
      } else {
        stats.errors.push({
          testId: result.testId,
          input: result.input,
          expected: fr.expected,
          actual: fr.actual,
        });
      }
      fieldStats.set(fr.field, stats);
    }
  }

  return Array.from(fieldStats.entries())
    .map(([field, stats]) => ({
      field,
      total: stats.total,
      correct: stats.correct,
      accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
      errors: stats.errors,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}

export function calculateTagMetrics(
  results: TestResult[],
  testCases: EvalTestCase[]
): TagMetrics[] {
  const tagStats = new Map<string, { total: number; passed: number }>();

  // Create a map for quick lookup
  const resultMap = new Map(results.map(r => [r.testId, r]));

  for (const testCase of testCases) {
    const tags = testCase.metadata?.tags ?? ['untagged'];
    const result = resultMap.get(testCase.id);
    const passed = result?.passed ?? false;

    for (const tag of tags) {
      const stats = tagStats.get(tag) ?? { total: 0, passed: 0 };
      stats.total++;
      if (passed) stats.passed++;
      tagStats.set(tag, stats);
    }
  }

  return Array.from(tagStats.entries())
    .map(([tag, stats]) => ({
      tag,
      total: stats.total,
      passed: stats.passed,
      accuracy: stats.total > 0 ? stats.passed / stats.total : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}

// ============================================
// Generate Report
// ============================================

export function generateReport(
  results: TestResult[],
  testCases: EvalTestCase[],
  options: {
    model: string;
    datasetVersion: string;
    startTime: number;
  }
): EvalReport {
  const passedCases = results.filter(r => r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

  return {
    timestamp: new Date().toISOString(),
    model: options.model,
    datasetVersion: options.datasetVersion,

    summary: {
      totalCases: results.length,
      passedCases,
      overallAccuracy: results.length > 0 ? passedCases / results.length : 0,
      durationMs: Date.now() - options.startTime,
    },

    fieldMetrics: calculateFieldMetrics(results),
    tagMetrics: calculateTagMetrics(results, testCases),
    failures: results.filter(r => !r.passed),
  };
}

// ============================================
// Format Report
// ============================================

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];

  lines.push('='.repeat(50));
  lines.push('Parser Evaluation Report');
  lines.push('='.repeat(50));
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Model: ${report.model}`);
  lines.push(`Duration: ${(report.summary.durationMs / 1000).toFixed(1)}s`);
  lines.push('');

  // Summary
  const { totalCases, passedCases, overallAccuracy } = report.summary;
  const pct = (overallAccuracy * 100).toFixed(1);
  const status = overallAccuracy >= 0.9 ? '✓' : overallAccuracy >= 0.8 ? '⚠' : '✗';
  lines.push(`OVERALL: ${passedCases}/${totalCases} passed (${pct}%) ${status}`);
  lines.push('');

  // Field accuracy
  lines.push('FIELD ACCURACY:');
  for (const fm of report.fieldMetrics) {
    const pct = (fm.accuracy * 100).toFixed(1);
    const status = fm.accuracy >= 0.95 ? '✓' : fm.accuracy >= 0.8 ? '⚠' : '✗';
    const pad = ' '.repeat(Math.max(0, 12 - fm.field.length));
    lines.push(`  ${fm.field}:${pad}${fm.correct}/${fm.total} (${pct}%) ${status}`);
  }
  lines.push('');

  // Tag metrics
  if (report.tagMetrics.length > 0) {
    lines.push('BY TAG:');
    for (const tm of report.tagMetrics) {
      const pct = (tm.accuracy * 100).toFixed(1);
      const status = tm.accuracy >= 0.95 ? '✓' : tm.accuracy >= 0.8 ? '⚠' : '✗';
      const pad = ' '.repeat(Math.max(0, 12 - tm.tag.length));
      lines.push(`  ${tm.tag}:${pad}${tm.passed}/${tm.total} (${pct}%) ${status}`);
    }
    lines.push('');
  }

  // Failures
  if (report.failures.length > 0) {
    lines.push('FAILURES:');
    for (const f of report.failures.slice(0, 10)) {
      lines.push(`  [${f.testId}] "${f.input}"`);
      for (const fr of f.fieldResults.filter(r => !r.passed)) {
        lines.push(`    ${fr.field}: expected ${JSON.stringify(fr.expected)}, got ${JSON.stringify(fr.actual)}`);
      }
    }
    if (report.failures.length > 10) {
      lines.push(`  ... and ${report.failures.length - 10} more failures`);
    }
  }

  return lines.join('\n');
}
