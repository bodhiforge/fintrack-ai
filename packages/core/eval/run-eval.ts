#!/usr/bin/env npx tsx
/**
 * Parser evaluation runner
 *
 * Usage:
 *   pnpm eval                    # Run full evaluation
 *   pnpm eval --tag chinese      # Filter by tag
 *   pnpm eval --dataset golden   # Specific dataset
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TransactionParser } from '../src/parser.js';
import { compareField } from './matchers.js';
import { generateReport, formatReport } from './metrics.js';
import type { EvalDataset, EvalTestCase, TestResult, FieldResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================
// CLI Args
// ============================================

interface CliArgs {
  dataset: string;
  tag?: string;
  model: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    dataset: 'golden',
    model: 'gpt-4o-mini',
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dataset' && args[i + 1]) {
      result.dataset = args[++i];
    } else if (args[i] === '--tag' && args[i + 1]) {
      result.tag = args[++i];
    } else if (args[i] === '--model' && args[i + 1]) {
      result.model = args[++i];
    }
  }

  return result;
}

// ============================================
// Load Dataset
// ============================================

function loadDataset(name: string): EvalDataset {
  const path = resolve(__dirname, 'datasets', `${name}.json`);
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as EvalDataset;
}

// ============================================
// Run Single Test
// ============================================

async function runTest(
  parser: TransactionParser,
  testCase: EvalTestCase
): Promise<TestResult> {
  const start = Date.now();

  try {
    const response = await parser.parseNaturalLanguage(testCase.input, {
      participants: testCase.participants,
    });

    const parsed = response.parsed;
    const fieldResults: FieldResult[] = [];

    // Compare each expected field
    const fields = ['merchant', 'amount', 'currency', 'category', 'date', 'location', 'excludedParticipants', 'customSplits'] as const;

    for (const field of fields) {
      const expected = testCase.expected[field];
      if (expected === undefined) continue;

      const actual = parsed[field];
      const result = compareField(field, expected, actual);

      fieldResults.push({
        field,
        passed: result.passed,
        expected: result.expected,
        actual: result.actual,
      });
    }

    const passed = fieldResults.every(r => r.passed);

    return {
      testId: testCase.id,
      input: testCase.input,
      passed,
      fieldResults,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      testId: testCase.id,
      input: testCase.input,
      passed: false,
      fieldResults: [{
        field: 'error',
        passed: false,
        expected: 'success',
        actual: error instanceof Error ? error.message : String(error),
      }],
      durationMs: Date.now() - start,
    };
  }
}

// ============================================
// Main
// ============================================

async function main() {
  const args = parseArgs();

  // Check API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  // Load dataset
  console.log(`Loading dataset: ${args.dataset}`);
  const dataset = loadDataset(args.dataset);

  // Filter by tag if specified
  let cases = dataset.cases;
  if (args.tag) {
    cases = cases.filter(c => c.metadata?.tags?.includes(args.tag!));
    console.log(`Filtered to tag "${args.tag}": ${cases.length} cases`);
  }

  if (cases.length === 0) {
    console.error('No test cases to run');
    process.exit(1);
  }

  // Create parser
  const parser = new TransactionParser(apiKey, { model: args.model });

  // Run tests
  console.log(`\nRunning ${cases.length} test cases with ${args.model}...\n`);
  const startTime = Date.now();
  const results: TestResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    process.stdout.write(`  [${i + 1}/${cases.length}] ${testCase.id}... `);

    const result = await runTest(parser, testCase);
    results.push(result);

    const status = result.passed ? '✓' : '✗';
    console.log(`${status} (${result.durationMs}ms)`);
  }

  // Generate report
  const report = generateReport(results, cases, {
    model: args.model,
    datasetVersion: dataset.version,
    startTime,
  });

  // Print report
  console.log('\n' + formatReport(report));
}

main().catch(console.error);
