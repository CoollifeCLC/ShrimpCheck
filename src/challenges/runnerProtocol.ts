// Message protocol and limits shared by the extension-side runner (runner.ts)
// and the disposable child process that executes user code (runnerChild.ts).
// No `vscode` import: the child process must be loadable by plain Node.

/** Hard limits applied to every Run / Submit. */
export interface RunnerLimits {
  /** vm timeout for one synchronous evaluation (load, one test call, one timer callback). */
  syncTimeoutMs: number;
  /** How long a returned Promise may stay pending before the test fails. */
  asyncTimeoutMs: number;
  /** Heap cap for the worker thread that runs user code (MB). */
  workerHeapMb: number;
  /** Resident-memory cap for the whole runner process, checked every 50 ms (bytes). */
  maxRssBytes: number;
  maxLogLines: number;
  maxLogLineChars: number;
  maxLogChars: number;
  /** Serialized size cap for one test's returned value (bytes). */
  maxResultBytes: number;
  /** The runner process exits on its own after this long, even if the extension host is gone. */
  maxLifetimeMs: number;
}

export interface RunnerTestInput {
  index: number;
  /** JSON-encoded argument list; decoded inside the sandbox so no host objects cross over. */
  argsJson: string;
  inPlaceArg?: number;
}

export interface RunnerPayload {
  challengeId: string;
  functionName: string;
  setup?: string;
  source: string;
  tests: RunnerTestInput[];
  limits: RunnerLimits;
}

/** Extension host → runner process. */
export type ParentMessage = { type: 'run'; payload: RunnerPayload };

/** Runner process → extension host. */
export type ChildMessage =
  | { type: 'log'; line: string }
  | { type: 'setupError'; message: string }
  | { type: 'missingFunction' }
  | { type: 'loaded' }
  | { type: 'testStart'; index: number }
  | { type: 'testDone'; index: number; outcome: TestOutcome }
  | { type: 'fatal'; reason: 'memory' | 'crash'; message?: string }
  | { type: 'done' };

export type TestOutcome =
  | { kind: 'value'; value: unknown }
  /** The value could not be structured-cloned (e.g. a function); `text` is its display form. */
  | { kind: 'unclonable'; text: string }
  | { kind: 'tooLarge'; bytes: number }
  | { kind: 'error'; message: string; timedOut: boolean };
