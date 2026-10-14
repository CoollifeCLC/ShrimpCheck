import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { killProcessTree } from './processTree';
import type { LauncherData, LauncherMessage } from './runnerLauncher';
import { ChildMessage, RunnerLimits, RunnerPayload, TestOutcome } from './runnerProtocol';
import { Challenge } from './types';

export { killProcessTree } from './processTree';

export const SYNC_TIMEOUT_MS = 2000;
export const ASYNC_TIMEOUT_MS = 3000;

/** Time allowed for the runner process to start and load setup + solution. */
export const STARTUP_BUDGET_MS = 5000 + 3 * SYNC_TIMEOUT_MS;
/** Hard wall-clock budget per test, enforced from the extension host. */
export const TEST_BUDGET_MS = SYNC_TIMEOUT_MS + ASYNC_TIMEOUT_MS + 1500;

export const RUNNER_LIMITS: RunnerLimits = {
  syncTimeoutMs: SYNC_TIMEOUT_MS,
  asyncTimeoutMs: ASYNC_TIMEOUT_MS,
  workerHeapMb: 128,
  maxRssBytes: 384 * 1024 * 1024,
  maxLogLines: 50,
  maxLogLineChars: 2000,
  maxLogChars: 16_000,
  maxResultBytes: 1024 * 1024,
  maxLifetimeMs: 120_000
};

export type TestStatus =
  | 'PASSED'
  | 'WRONG_ANSWER'
  | 'RUNTIME_ERROR'
  | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'RUNNER_CRASHED'
  | 'NOT_RUN';

export interface TestResult {
  index: number;
  hidden: boolean;
  passed: boolean;
  /** Shown to the user; for hidden tests this stays generic. */
  label: string;
  expected?: string;
  received?: string;
  error?: string;
  /** Machine-readable outcome. Optional so existing consumers are unaffected. */
  status?: TestStatus;
}

export interface RunSummary {
  /** Compile / load problem (syntax error, missing function). */
  setupError?: string;
  results: TestResult[];
  passed: number;
  total: number;
  allPassed: boolean;
  logs: string[];
  /** Diagnostics about the runner process itself (tests and logging only). */
  runner?: { pid?: number; stopReason: StopReason['kind']; durationMs: number };
}

export interface RunOptions {
  /** Include hidden tests (Submit) or only visible ones (Run Tests). */
  includeHidden: boolean;
}

export const TIME_LIMIT_MESSAGE = 'Timed out — time limit exceeded, the test runner was stopped. Possible infinite loop.';
export const MEMORY_LIMIT_MESSAGE = 'Memory limit exceeded — the test runner was stopped.';
export const CRASH_MESSAGE = 'The test runner stopped unexpectedly.';
export const NOT_RUN_MESSAGE = 'Not run — the test runner was stopped after an earlier test hit a limit.';

type StopReason =
  | { kind: 'done' }
  | { kind: 'setupError'; message: string }
  | { kind: 'missingFunction' }
  | { kind: 'timeout' }
  | { kind: 'memory' }
  | { kind: 'crash'; detail?: string }
  | { kind: 'cancelled' };

interface ActiveRun {
  /** Runner pid while it is alive. */
  pid(): number | undefined;
  cancel(sync: boolean): void;
}

const activeRuns = new Set<ActiveRun>();
const CHILD_ENTRY = path.join(__dirname, 'runnerChild.js');
const LAUNCHER_ENTRY = path.join(__dirname, 'runnerLauncher.js');
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Optional diagnostics hook: receives timestamped runner lifecycle events. Off by default. */
let traceHook: ((event: string, detail?: unknown) => void) | undefined;
export function setRunnerTraceHook(hook: ((event: string, detail?: unknown) => void) | undefined): void {
  traceHook = hook;
}
const trace = (event: string, detail?: unknown): void => {
  if (traceHook) traceHook(event, detail);
};

/**
 * Runs the user's JavaScript against the challenge tests in a disposable
 * child process. The extension host never executes user code: it only sends
 * the payload, receives structured results, and enforces a wall-clock
 * deadline that kills the runner's whole process tree. An infinite loop, a
 * runaway promise chain or a memory balloon becomes a failed test result
 * (TIME_LIMIT_EXCEEDED / MEMORY_LIMIT_EXCEEDED) instead of a hung editor.
 *
 * Inside the child, code runs in a `vm` context on a worker thread with a heap
 * cap; that is defense in depth, not the guarantee.
 */
export function runChallengeTests(challenge: Challenge, source: string, options: RunOptions): Promise<RunSummary> {
  const tests = challenge.tests
    .map((test, index) => ({ test, index }))
    .filter(({ test }) => options.includeHidden || !test.hidden);

  let visibleCounter = 0;
  let hiddenCounter = 0;
  const labels = new Map<number, string>();
  for (const { test, index } of tests) {
    labels.set(index, test.hidden ? `Hidden test ${++hiddenCounter}` : `Test ${++visibleCounter}`);
  }

  if (!IDENTIFIER.test(challenge.functionName)) {
    return Promise.resolve(failedSetup(`Invalid challenge function name.`, tests.length, []));
  }

  const payload: RunnerPayload = {
    challengeId: challenge.id,
    functionName: challenge.functionName,
    setup: challenge.setup,
    source,
    tests: tests.map(({ test, index }) => ({
      index,
      argsJson: JSON.stringify(test.args ?? []),
      inPlaceArg: test.inPlaceArg
    })),
    limits: RUNNER_LIMITS
  };

  return new Promise<RunSummary>((resolve) => {
    const startedAt = Date.now();
    const logs: string[] = [];
    let logChars = 0;
    const outcomes = new Map<number, TestOutcome>();
    let currentTest: number | undefined;
    let loaded = false;
    let finished = false;
    let phaseTimer: ReturnType<typeof setTimeout> | undefined;
    let pid: number | undefined;
    let childExited = false;
    let afterKilled: (() => void) | undefined;
    let launcher: Worker;

    const launcherData: LauncherData = {
      childEntry: CHILD_ENTRY,
      forkOptions: {
        cwd: os.tmpdir(),
        env: runnerEnv(),
        execArgv: ['--max-old-space-size=64'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        serialization: 'advanced',
        windowsHide: true,
        // POSIX: own process group so the whole tree can be killed at once.
        detached: process.platform !== 'win32'
      },
      payload
    };

    try {
      // fork() blocks its calling thread (~400 ms on Windows), so it happens on
      // a launcher worker thread; this thread only exchanges messages.
      trace('worker:new:before');
      launcher = new Worker(LAUNCHER_ENTRY, { workerData: launcherData, stdout: true, stderr: true });
      trace('worker:new:after');
    } catch (error) {
      resolve(failedSetup(`Could not start the test runner: ${String(error)}`, tests.length, logs));
      return;
    }

    const run: ActiveRun = {
      pid: () => (childExited ? undefined : pid),
      cancel: (sync) => {
        if (!finished) {
          finish({ kind: 'cancelled' }, sync);
        } else if (sync) {
          // Already reported but kill not yet confirmed (e.g. shutdown mid-teardown).
          directKill(true);
          activeRuns.delete(run);
        }
      }
    };
    activeRuns.add(run);

    const arm = (ms: number): void => {
      if (phaseTimer) clearTimeout(phaseTimer);
      phaseTimer = setTimeout(() => finish({ kind: 'timeout' }), ms);
    };
    arm(STARTUP_BUDGET_MS);

    launcher.on('message', (m: LauncherMessage) => {
      if (!m || typeof m !== 'object') return;
      switch (m.type) {
        case 'spawned':
          pid = m.pid;
          trace('spawned', { pid: m.pid, forkMsInLauncher: m.forkMs });
          return;
        case 'exit':
          trace('child:exit');
          childExited = true;
          finish({ kind: 'crash', detail: 'runner exited' });
          afterKilled?.();
          return;
        case 'killed':
          trace('killed');
          childExited = true;
          afterKilled?.();
          return;
        case 'spawnError':
          finish({ kind: 'crash', detail: m.message });
          return;
        case 'child':
          trace(`child:${(m.message as { type?: string } | undefined)?.type}`);
          onChildMessage(m.message);
          return;
      }
    });
    launcher.on('error', (error) => {
      finish({ kind: 'crash', detail: String(error) });
      directKill();
    });
    launcher.on('online', () => trace('worker:online'));
    launcher.on('exit', () => {
      trace('worker:exit');
      // Launcher gone without confirming: make sure the runner is too.
      if (!childExited) directKill();
      activeRuns.delete(run);
    });

    function onChildMessage(raw: unknown): void {
      if (finished) return;
      const message = raw as ChildMessage;
      if (!message || typeof message !== 'object') return;
      switch (message.type) {
        case 'log': {
          if (typeof message.line !== 'string' || logs.length >= RUNNER_LIMITS.maxLogLines) return;
          const line = message.line.slice(0, RUNNER_LIMITS.maxLogLineChars + 16);
          if (logChars + line.length > RUNNER_LIMITS.maxLogChars) return;
          logChars += line.length;
          logs.push(line);
          return;
        }
        case 'setupError':
          finish({ kind: 'setupError', message: String(message.message) });
          return;
        case 'missingFunction':
          finish({ kind: 'missingFunction' });
          return;
        case 'loaded':
          loaded = true;
          return;
        case 'testStart':
          currentTest = message.index;
          arm(TEST_BUDGET_MS);
          return;
        case 'testDone':
          outcomes.set(message.index, message.outcome);
          currentTest = undefined;
          return;
        case 'fatal':
          finish(message.reason === 'memory' ? { kind: 'memory' } : { kind: 'crash', detail: message.message });
          return;
        case 'done':
          finish({ kind: 'done' });
          return;
      }
    }

    /** Main-thread kill that does not depend on the launcher (fallback / shutdown). */
    function directKill(sync = false): void {
      if (pid === undefined || childExited) return;
      const target = pid;
      killProcessTree(target, { sync, onDone: () => killPid(target) });
    }

    function stopRunner(sync: boolean): void {
      if (childExited) {
        terminateLauncher();
        return;
      }
      // Shutdown (sync): kill the tree from this thread right now.
      // Normal path: the launcher thread runs taskkill / group kill, keeping
      // process creation off this thread.
      // Either way the launcher stays up until it has reaped the runner's exit
      // (no zombie on POSIX); fallback: kill from here and drop the launcher.
      if (sync) directKill(true);
      const fallback = setTimeout(() => {
        directKill();
        terminateLauncher();
      }, 2000);
      afterKilled = () => {
        clearTimeout(fallback);
        afterKilled = undefined;
        terminateLauncher();
      };
      trace('kill:post');
      launcher.postMessage({ type: 'kill' });
    }

    function terminateLauncher(): void {
      trace('worker:terminate:call');
      void launcher.terminate().then(() => trace('worker:terminate:resolved'));
      trace('worker:terminate:returned');
    }

    function finish(reason: StopReason, sync = false): void {
      if (finished) return;
      finished = true;
      if (phaseTimer) clearTimeout(phaseTimer);
      if (sync) activeRuns.delete(run);
      stopRunner(sync);
      trace(`finish:${reason.kind}`);
      resolve(buildSummary(reason));
    }

    function buildSummary(reason: StopReason): RunSummary {
      const runner = { pid, stopReason: reason.kind, durationMs: Date.now() - startedAt };
      if (reason.kind === 'setupError') return { ...failedSetup(reason.message, tests.length, logs), runner };
      if (reason.kind === 'missingFunction') {
        return {
          ...failedSetup(
            `Could not find a function named \`${challenge.functionName}\`. Keep the starter function name.`,
            tests.length,
            logs
          ),
          runner
        };
      }
      if (!loaded) {
        const message =
          reason.kind === 'timeout'
            ? TIME_LIMIT_MESSAGE
            : reason.kind === 'memory'
              ? MEMORY_LIMIT_MESSAGE
              : reason.kind === 'cancelled'
                ? 'Run cancelled.'
                : CRASH_MESSAGE;
        return { ...failedSetup(message, tests.length, logs), runner };
      }

      const results: TestResult[] = tests.map(({ test, index }) => {
        const hidden = Boolean(test.hidden);
        const label = labels.get(index) as string;
        const expected = hidden ? undefined : formatValue(test.expected);
        const outcome = outcomes.get(index);

        if (!outcome) {
          const [status, error] = stoppedOutcome(reason, index === currentTest);
          return { index, hidden, passed: false, label, expected, error, status };
        }
        switch (outcome.kind) {
          case 'value': {
            const actual = outcome.value;
            const passed = valuesMatch(actual, test.expected, test.compare ?? 'deep');
            return {
              index,
              hidden,
              passed,
              label,
              expected,
              received: hidden ? undefined : formatValue(actual),
              status: passed ? 'PASSED' : 'WRONG_ANSWER'
            };
          }
          case 'unclonable':
            return {
              index,
              hidden,
              passed: false,
              label,
              expected,
              received: hidden ? undefined : String(outcome.text),
              status: 'WRONG_ANSWER'
            };
          case 'tooLarge':
            return {
              index,
              hidden,
              passed: false,
              label,
              expected,
              error: `Output limit exceeded — the returned value was ${outcome.bytes} bytes (limit ${RUNNER_LIMITS.maxResultBytes}).`,
              status: 'OUTPUT_LIMIT_EXCEEDED'
            };
          case 'error':
            return {
              index,
              hidden,
              passed: false,
              label,
              expected,
              error: String(outcome.message),
              status: outcome.timedOut ? 'TIME_LIMIT_EXCEEDED' : 'RUNTIME_ERROR'
            };
        }
      });

      const passed = results.filter((result) => result.passed).length;
      return {
        results,
        passed,
        total: results.length,
        allPassed: results.length > 0 && passed === results.length,
        logs,
        runner
      };
    }
  });
}

function stoppedOutcome(reason: StopReason, wasRunning: boolean): [TestStatus, string] {
  if (!wasRunning) return ['NOT_RUN', NOT_RUN_MESSAGE];
  switch (reason.kind) {
    case 'timeout':
      return ['TIME_LIMIT_EXCEEDED', TIME_LIMIT_MESSAGE];
    case 'memory':
      return ['MEMORY_LIMIT_EXCEEDED', MEMORY_LIMIT_MESSAGE];
    case 'cancelled':
      return ['NOT_RUN', 'Run cancelled.'];
    default:
      return ['RUNNER_CRASHED', CRASH_MESSAGE];
  }
}

/** Kills every in-flight runner. Called on dispose / deactivate. */
export function cancelAllChallengeRuns(): void {
  for (const run of [...activeRuns]) run.cancel(true);
}

/** Number of runner processes currently alive from this module (for tests). */
export function activeRunnerCount(): number {
  return activeRuns.size;
}

/** PIDs of runner processes currently alive from this module (for tests). */
export function activeRunnerPids(): number[] {
  return [...activeRuns].map((run) => run.pid()).filter((pid): pid is number => typeof pid === 'number');
}

function runnerEnv(): NodeJS.ProcessEnv {
  // Nothing from the editor's environment: no tokens, no NODE_OPTIONS.
  const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' };
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (process.env.windir) env.windir = process.env.windir;
  }
  return env;
}

function killPid(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
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
