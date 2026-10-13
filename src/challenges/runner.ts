import * as vm from 'node:vm';
import { Challenge, ChallengeTest } from './types';

export const SYNC_TIMEOUT_MS = 2000;
export const ASYNC_TIMEOUT_MS = 3000;

export interface TestResult {
  index: number;
  hidden: boolean;
  passed: boolean;
  /** Shown to the user; for hidden tests this stays generic. */
  label: string;
  expected?: string;
  received?: string;
  error?: string;
}

export interface RunSummary {
  /** Compile / load problem (syntax error, missing function). */
  setupError?: string;
  results: TestResult[];
  passed: number;
  total: number;
  allPassed: boolean;
  logs: string[];
}

export interface RunOptions {
  /** Include hidden tests (Submit) or only visible ones (Run Tests). */
  includeHidden: boolean;
}

/**
 * Executes the user's JavaScript against the challenge tests in an isolated
 * `vm` context with a timeout so an accidental infinite loop cannot hang the
 * extension host. This is a guard against mistakes, not a security sandbox:
 * the code being run is the user's own.
 */
export async function runChallengeTests(
  challenge: Challenge,
  source: string,
  options: RunOptions
): Promise<RunSummary> {
  const tests = challenge.tests
    .map((test, index) => ({ test, index }))
    .filter(({ test }) => options.includeHidden || !test.hidden);

  const logs: string[] = [];
  const sandbox: Record<string, unknown> = {
    console: createConsole(logs),
    setTimeout,
    clearTimeout,
    Promise
  };
  const context = vm.createContext(sandbox);

  try {
    if (challenge.setup) {
      vm.runInContext(challenge.setup, context, { timeout: SYNC_TIMEOUT_MS, filename: 'setup.js' });
    }
    vm.runInContext(source, context, { timeout: SYNC_TIMEOUT_MS, filename: `${challenge.id}.js` });
    const fnType = vm.runInContext(`typeof ${challenge.functionName}`, context);
    if (fnType !== 'function') {
      return failedSetup(
        `Could not find a function named \`${challenge.functionName}\`. Keep the starter function name.`,
        tests.length,
        logs
      );
    }
  } catch (error) {
    return failedSetup(describeError(error), tests.length, logs);
  }

  const results: TestResult[] = [];
  let visibleCounter = 0;
  let hiddenCounter = 0;

  for (const { test, index } of tests) {
    const label = test.hidden ? `Hidden test ${++hiddenCounter}` : `Test ${++visibleCounter}`;
    results.push(await runSingleTest(challenge, context, test, index, label));
  }

  const passed = results.filter((result) => result.passed).length;
  return {
    results,
    passed,
    total: results.length,
    allPassed: results.length > 0 && passed === results.length,
    logs
  };
}

async function runSingleTest(
  challenge: Challenge,
  context: vm.Context,
  test: ChallengeTest,
  index: number,
  label: string
): Promise<TestResult> {
  const hidden = Boolean(test.hidden);
  const args = cloneValue(test.args) as unknown[];

  try {
    context.__shrimpArgs = args;
    let value: unknown = vm.runInContext(`${challenge.functionName}(...__shrimpArgs)`, context, {
      timeout: SYNC_TIMEOUT_MS
    });

    if (isThenable(value)) {
      value = await withTimeout(Promise.resolve(value), ASYNC_TIMEOUT_MS);
    }

    const actual = test.inPlaceArg !== undefined ? args[test.inPlaceArg] : value;
    const passed = valuesMatch(actual, test.expected, test.compare ?? 'deep');

    return {
      index,
      hidden,
      passed,
      label,
      expected: hidden ? undefined : formatValue(test.expected),
      received: hidden ? undefined : formatValue(actual)
    };
  } catch (error) {
    return {
      index,
      hidden,
      passed: false,
      label,
      expected: hidden ? undefined : formatValue(test.expected),
      error: describeError(error)
    };
  } finally {
    delete context.__shrimpArgs;
  }
}

function failedSetup(message: string, total: number, logs: string[]): RunSummary {
  return { setupError: message, results: [], passed: 0, total, allPassed: false, logs };
}

/**
 * Structural equality that tolerates values created in another realm (the vm
 * context has its own Array/Object prototypes, so util.isDeepStrictEqual
 * would reject otherwise-identical arrays).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    const left = a as unknown[];
    const right = b as unknown[];
    return left.length === right.length && left.every((item, i) => deepEqual(item, right[i]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => deepEqual(left[key], right[key]));
}

export function valuesMatch(actual: unknown, expected: unknown, compare: 'deep' | 'sorted'): boolean {
  if (compare === 'sorted' && Array.isArray(actual) && Array.isArray(expected)) {
    return deepEqual(sortForCompare(actual), sortForCompare(expected));
  }
  return deepEqual(actual, expected);
}

function sortForCompare(values: unknown[]): unknown[] {
  return [...values].sort((x, y) => {
    const a = JSON.stringify(x) ?? '';
    const b = JSON.stringify(y) ?? '';
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`Timed out after ${ms} ms (promise never settled)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}

export function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  } catch {
    return String(value);
  }
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const err = error as { name?: string; message?: string; code?: string };
    if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      return `Timed out after ${SYNC_TIMEOUT_MS} ms — possible infinite loop.`;
    }
    if (err.message) return `${err.name ?? 'Error'}: ${err.message}`;
  }
  return String(error);
}

function createConsole(logs: string[]): Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'> {
  const push = (...values: unknown[]) => {
    if (logs.length >= 50) return;
    logs.push(values.map((value) => (typeof value === 'string' ? value : formatValue(value))).join(' '));
  };
  return { log: push, info: push, warn: push, error: push, debug: push };
}
