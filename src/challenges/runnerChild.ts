// Entry point of the disposable Challenge Mode runner process.
//
// Layout inside this process:
//   main thread  — supervisor: receives the payload over IPC, watches memory,
//                  exits when the extension host disconnects or the lifetime
//                  cap passes. It never runs user code, so it stays responsive
//                  even while user code spins.
//   worker thread — evaluates the setup, the solution and each test in a
//                  `vm` context with a heap cap and per-evaluation timeouts.
//
// The extension host still owns the real guarantee: a wall-clock deadline
// that kills this whole process tree. Everything here is the inner layer that
// turns most failures into clean per-test results instead of a kill.
//
// This file must not import `vscode`.

import * as v8 from 'node:v8';
import * as vm from 'node:vm';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { ChildMessage, ParentMessage, RunnerPayload, TestOutcome } from './runnerProtocol';

// ── Supervisor (main thread) ──────────────────────────────────────────────

function runSupervisor(): void {
  let exiting = false;

  const send = (message: ChildMessage, then?: () => void): void => {
    if (!process.send || !process.connected) {
      then?.();
      return;
    }
    try {
      process.send(message, undefined, {}, () => then?.());
    } catch {
      then?.();
    }
  };

  const exit = (): void => {
    if (exiting) return;
    exiting = true;
    // Give queued IPC messages a moment to flush, then go.
    setTimeout(() => process.exit(0), 25);
  };

  const fatal = (reason: 'memory' | 'crash', message?: string): void => {
    if (exiting) return;
    send({ type: 'fatal', reason, message }, exit);
    setTimeout(exit, 250);
  };

  // Extension host gone (closed, crashed, or killed us) → leave immediately.
  process.on('disconnect', () => process.exit(0));

  let started = false;
  process.on('message', (raw: unknown) => {
    const message = raw as ParentMessage;
    if (started || !message || message.type !== 'run') return;
    started = true;
    const payload = message.payload;

    // Self-destruct even if the extension host never comes back to kill us.
    setTimeout(() => process.exit(0), payload.limits.maxLifetimeMs);

    // Covers memory the worker heap cap does not (ArrayBuffers, strings off-heap).
    setInterval(() => {
      if (process.memoryUsage().rss > payload.limits.maxRssBytes) fatal('memory');
    }, 50);

    let worker: Worker;
    try {
      worker = new Worker(__filename, {
        workerData: payload,
        resourceLimits: {
          maxOldGenerationSizeMb: payload.limits.workerHeapMb,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4
        },
        stdout: true,
        stderr: true
      });
    } catch (error) {
      fatal('crash', String((error as Error)?.message ?? error));
      return;
    }

    worker.on('message', (m: ChildMessage) => {
      if (m && m.type === 'done') send(m, exit);
      else send(m);
    });
    worker.on('error', (error: Error & { code?: string }) => {
      fatal(error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'memory' : 'crash', String(error?.message ?? error));
    });
    worker.on('exit', () => setTimeout(() => fatal('crash', 'worker exited'), 100));
  });
}

// ── Worker (user code) ────────────────────────────────────────────────────

/**
 * Installed into the sandbox before any challenge code runs. It only ever
 * receives host *functions* through its closure parameters (never exposed on
 * the global), and only primitives cross back to the host.
 */
const PRELUDE = `(function (schedule, cancel, limits) {
  'use strict';
  var stringify = JSON.stringify, parse = JSON.parse, toStr = String;
  var apply = Reflect.apply, defineProperty = Object.defineProperty, freeze = Object.freeze;
  var PromiseCtor = Promise, resolve = Promise.resolve.bind(Promise);
  var promiseThen = Promise.prototype.then;

  var lines = [], lineCount = 0, charCount = 0;
  function fmt(value) {
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return stringify(value);
    try {
      var text = stringify(value);
      if (text === undefined) return toStr(value);
      return text.length > 200 ? text.slice(0, 197) + '...' : text;
    } catch (e) {
      try { return toStr(value); } catch (e2) { return '[unprintable]'; }
    }
  }
  function push() {
    if (lineCount >= limits.maxLogLines) return;
    var line = '';
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      var part = typeof v === 'string' ? v : fmt(v);
      if (part.length > limits.maxLogLineChars) part = part.slice(0, limits.maxLogLineChars);
      line = i === 0 ? part : line + ' ' + part;
      if (line.length > limits.maxLogLineChars) break;
    }
    if (line.length > limits.maxLogLineChars) line = line.slice(0, limits.maxLogLineChars) + '… [truncated]';
    if (charCount + line.length > limits.maxLogChars) { lineCount = limits.maxLogLines; return; }
    charCount += line.length;
    lineCount++;
    lines[lines.length] = line;
  }
  globalThis.console = { log: push, info: push, warn: push, error: push, debug: push };

  var timers = Object.create(null), nextTimer = 1;
  globalThis.setTimeout = function setTimeout(callback, ms) {
    if (typeof callback !== 'function') throw new TypeError('setTimeout callback must be a function');
    var extra = [];
    for (var i = 2; i < arguments.length; i++) extra[extra.length] = arguments[i];
    var id = nextTimer++;
    timers[id] = { fn: callback, args: extra };
    schedule(id, +ms || 0);
    return id;
  };
  globalThis.clearTimeout = function clearTimeout(id) {
    if (typeof id === 'number' && timers[id]) { delete timers[id]; cancel(id); }
  };

  var pending = null;
  function describe(error) {
    try {
      if (error && typeof error === 'object') {
        var message = error.message;
        if (message) return toStr(error.name === undefined ? 'Error' : error.name) + ': ' + toStr(message);
      }
      return toStr(error);
    } catch (e) { return 'Error'; }
  }

  defineProperty(globalThis, '__shrimp', {
    value: freeze({
      call: function (fn, argsJson, inPlaceArg) {
        var args = parse(argsJson);
        pending = null;
        var pick = function (v) { return inPlaceArg === undefined ? v : args[inPlaceArg]; };
        var value = apply(fn, undefined, args);
        if (value !== null && (typeof value === 'object' || typeof value === 'function') &&
            typeof value.then === 'function') {
          var state = { done: false, ok: false, value: undefined, error: '' };
          pending = state;
          apply(promiseThen, resolve(value), [
            function (v) { state.done = true; state.ok = true; state.value = pick(v); },
            function (e) { state.done = true; state.ok = false; state.error = describe(e); }
          ]);
          return { pending: true };
        }
        return { pending: false, value: pick(value) };
      },
      poll: function () {
        var s = pending;
        if (!s || !s.done) return { done: false };
        pending = null;
        return { done: true, ok: s.ok, value: s.value, error: s.error };
      },
      fire: function (id) {
        var entry = timers[id];
        if (!entry) return;
        delete timers[id];
        apply(entry.fn, undefined, entry.args);
      },
      drainLogs: function () {
        var out = lines;
        lines = [];
        return out;
      },
      describe: describe
    }),
    writable: false,
    configurable: false,
    enumerable: false
  });
})`;

async function runWorker(payload: RunnerPayload): Promise<void> {
  const port = parentPort;
  if (!port) return;
  const post = (message: ChildMessage): void => port.postMessage(message);
  const { limits } = payload;
  const timeout = limits.syncTimeoutMs;

  // A null-prototype sandbox: `this.constructor` etc. resolve inside the
  // context, never to this realm's Object/Function (and so never to `process`).
  const context = vm.createContext(Object.create(null), { microtaskMode: 'afterEvaluate' });
  const evaluate = (code: string, filename?: string): unknown =>
    vm.runInContext(code, context, { timeout, filename });

  // Host timers only see numeric ids; firing goes back through vm so the
  // callback has the same sync timeout and the context's microtasks drain.
  const hostTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const schedule = (id: number, ms: number): void => {
    const delay = Math.min(Math.max(0, Number(ms) || 0), 60_000);
    hostTimers.set(
      id,
      setTimeout(() => {
        hostTimers.delete(id);
        try {
          evaluate(`__shrimp.fire(${Number(id)})`);
        } catch {
          // A throwing or timed-out callback only affects the user's own promise.
        }
        flushLogs();
      }, delay)
    );
  };
  const cancel = (id: number): void => {
    const handle = hostTimers.get(id);
    if (handle) clearTimeout(handle);
    hostTimers.delete(id);
  };

  const flushLogs = (): void => {
    try {
      const drained = evaluate('__shrimp.drainLogs()') as unknown;
      if (!Array.isArray(drained)) return;
      for (const line of drained) {
        if (typeof line === 'string') post({ type: 'log', line: line.slice(0, limits.maxLogLineChars + 16) });
      }
    } catch {
      // Logging must never fail a run.
    }
  };

  const installPrelude = vm.runInContext(PRELUDE, context, { timeout }) as (
    schedule: (id: number, ms: number) => void,
    cancel: (id: number) => void,
    limits: Record<string, number>
  ) => void;
  installPrelude(
    schedule,
    cancel,
    Object.assign(Object.create(null), {
      maxLogLines: limits.maxLogLines,
      maxLogLineChars: limits.maxLogLineChars,
      maxLogChars: limits.maxLogChars
    })
  );

  // ── Load setup + solution ──
  const fn = payload.functionName;
  try {
    if (payload.setup) evaluate(payload.setup, 'setup.js');
    evaluate(payload.source, `${payload.challengeId}.js`);
    const fnType = evaluate(`typeof ${fn}`);
    flushLogs();
    if (fnType !== 'function') {
      post({ type: 'missingFunction' });
      post({ type: 'done' });
      return;
    }
  } catch (error) {
    flushLogs();
    post({ type: 'setupError', message: describeHostError(error, limits.syncTimeoutMs) });
    post({ type: 'done' });
    return;
  }
  post({ type: 'loaded' });

  // ── Tests ──
  for (const test of payload.tests) {
    post({ type: 'testStart', index: test.index });
    const outcome = await runOneTest(test.argsJson, test.inPlaceArg);
    flushLogs();
    postOutcome(test.index, outcome);
  }

  post({ type: 'done' });

  async function runOneTest(argsJson: string, inPlaceArg: number | undefined): Promise<TestOutcome> {
    try {
      const call =
        `__shrimp.call(typeof ${fn} === 'function' ? ${fn} : undefined, ` +
        `${JSON.stringify(argsJson)}, ${inPlaceArg === undefined ? 'undefined' : Number(inPlaceArg)})`;
      const first = evaluate(call) as { pending: boolean; value?: unknown };
      if (!first.pending) return { kind: 'value', value: first.value };

      const deadline = Date.now() + limits.asyncTimeoutMs;
      for (;;) {
        const state = evaluate('__shrimp.poll()') as { done: boolean; ok?: boolean; value?: unknown; error?: string };
        if (state.done) {
          return state.ok
            ? { kind: 'value', value: state.value }
            : { kind: 'error', message: String(state.error), timedOut: false };
        }
        if (Date.now() >= deadline) {
          return {
            kind: 'error',
            message: `Error: Timed out after ${limits.asyncTimeoutMs} ms (promise never settled)`,
            timedOut: true
          };
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    } catch (error) {
      return {
        kind: 'error',
        message: describeHostError(error, limits.syncTimeoutMs),
        timedOut: isTimeout(error)
      };
    }
  }

  function postOutcome(index: number, outcome: TestOutcome): void {
    if (outcome.kind === 'value') {
      let bytes: number;
      try {
        bytes = v8.serialize(outcome.value).length;
      } catch {
        post({ type: 'testDone', index, outcome: { kind: 'unclonable', text: displayText(outcome.value) } });
        return;
      }
      if (bytes > limits.maxResultBytes) {
        post({ type: 'testDone', index, outcome: { kind: 'tooLarge', bytes } });
        return;
      }
    }
    try {
      post({ type: 'testDone', index, outcome });
    } catch {
      post({ type: 'testDone', index, outcome: { kind: 'unclonable', text: '[value could not be transferred]' } });
    }
  }
}

function isTimeout(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
}

function describeHostError(error: unknown, syncTimeoutMs: number): string {
  try {
    if (isTimeout(error)) return `Timed out after ${syncTimeoutMs} ms — possible infinite loop.`;
    if (error && typeof error === 'object') {
      const err = error as { name?: string; message?: string };
      if (err.message) return `${err.name ?? 'Error'}: ${err.message}`;
    }
    return String(error);
  } catch {
    return 'Error';
  }
}

function displayText(value: unknown): string {
  try {
    const text = String(value);
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  } catch {
    return '[unprintable]';
  }
}

// Dispatch last so every module-level constant above is initialized.
if (isMainThread) {
  runSupervisor();
} else {
  void runWorker(workerData as RunnerPayload);
}
