/**
 * Field matching logic for evaluation
 */

import type { ExpectedValue } from './types.js';

// ============================================
// Normalize Functions
// ============================================

function normalizeString(value: string): string {
  return value.toLowerCase().trim();
}

function normalizeArray(arr: string[]): string[] {
  return arr.map(normalizeString).sort();
}

// ============================================
// Matchers
// ============================================

export function matchValue<T>(expected: ExpectedValue<T>, actual: T): boolean {
  if ('skip' in expected && expected.skip) {
    return true;
  }

  if ('exact' in expected) {
    return isEqual(expected.exact, actual);
  }

  if ('oneOf' in expected) {
    return expected.oneOf.some(e => isEqual(e, actual));
  }

  if ('pattern' in expected && typeof actual === 'string') {
    const regex = new RegExp(expected.pattern, 'i');
    return regex.test(actual);
  }

  if ('range' in expected && typeof actual === 'number') {
    return actual >= expected.range.min && actual <= expected.range.max;
  }

  return false;
}

function isEqual<T>(expected: T, actual: T): boolean {
  // String comparison (case-insensitive)
  if (typeof expected === 'string' && typeof actual === 'string') {
    return normalizeString(expected) === normalizeString(actual);
  }

  // Number comparison
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(expected - actual) < 0.01;
  }

  // Array comparison (string arrays)
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const normExpected = normalizeArray(expected as string[]);
    const normActual = normalizeArray(actual as string[]);
    if (normExpected.length !== normActual.length) return false;
    return normExpected.every((e, i) => e === normActual[i]);
  }

  // Object comparison (shallow)
  if (typeof expected === 'object' && typeof actual === 'object') {
    if (expected === null || actual === null) {
      return expected === actual;
    }
    const expKeys = Object.keys(expected as object).sort();
    const actKeys = Object.keys(actual as object).sort();
    if (expKeys.length !== actKeys.length) return false;
    return expKeys.every((key, i) => {
      if (key !== actKeys[i]) return false;
      return isEqual(
        (expected as Record<string, unknown>)[key],
        (actual as Record<string, unknown>)[key]
      );
    });
  }

  return expected === actual;
}

// ============================================
// Field Comparison
// ============================================

export interface CompareResult {
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

export function compareField(
  fieldName: string,
  expected: ExpectedValue<unknown> | undefined,
  actual: unknown
): CompareResult {
  // No expectation defined for this field
  if (expected === undefined) {
    return { passed: true, expected: undefined, actual };
  }

  // Skip this field
  if ('skip' in expected && expected.skip) {
    return { passed: true, expected: 'skip', actual };
  }

  const passed = matchValue(expected as ExpectedValue<typeof actual>, actual);

  // Format expected for display
  let expectedDisplay: unknown;
  if ('exact' in expected) expectedDisplay = expected.exact;
  else if ('oneOf' in expected) expectedDisplay = `oneOf: ${JSON.stringify(expected.oneOf)}`;
  else if ('pattern' in expected) expectedDisplay = `pattern: ${expected.pattern}`;
  else if ('range' in expected) expectedDisplay = `range: [${expected.range.min}, ${expected.range.max}]`;

  return { passed, expected: expectedDisplay, actual };
}
