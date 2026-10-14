// Worker-thread launcher for the Challenge Mode runner process.
//
// On Windows, starting a process (CreateProcess) blocks the calling thread for
// hundreds of milliseconds. Doing the fork() here, on a worker thread, keeps
// that cost off the extension host's main thread. This thread only forks the
// runner, relays its messages, and kills its process tree on request. The
// main thread keeps the wall-clock deadlines and a direct-kill fallback.
//
// This file must not import `vscode`.

import { ChildProcess, ForkOptions, fork } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';
import { killProcessTree } from './processTree';
import { RunnerPayload } from './runnerProtocol';

export interface LauncherData {
  childEntry: string;
  forkOptions: ForkOptions & { windowsHide: boolean };
  payload: RunnerPayload;
}

/** Launcher → main thread. */
export type LauncherMessage =
  | { type: 'spawned'; pid: number; forkMs?: number }
  | { type: 'child'; message: unknown }
  | { type: 'exit' }
  | { type: 'spawnError'; message: string }
  | { type: 'killed' };

/** Main thread → launcher. */
export type LauncherCommand = { type: 'kill' };

function main(): void {
  const port = parentPort;
  if (!port) return;
  const data = workerData as LauncherData;
  const post = (message: LauncherMessage): void => port.postMessage(message);

  let child: ChildProcess;
  const forkStart = Date.now();
  try {
    child = fork(data.childEntry, [], data.forkOptions);
  } catch (error) {
    post({ type: 'spawnError', message: String(error) });
    return;
  }

  let exited = false;
  if (typeof child.pid === 'number') post({ type: 'spawned', pid: child.pid, forkMs: Date.now() - forkStart });
  child.on('message', (message) => post({ type: 'child', message }));
  child.on('error', (error) => post({ type: 'spawnError', message: String(error) }));
  child.on('exit', () => {
    exited = true;
    post({ type: 'exit' });
  });

  port.on('message', (command: LauncherCommand) => {
    if (!command || command.type !== 'kill') return;
    if (exited || typeof child.pid !== 'number') {
      post({ type: 'killed' });
      return;
    }
    killProcessTree(child.pid, {
      onDone: () => {
        try {
          if (!exited) child.kill('SIGKILL');
        } catch {
          // already gone
        }
        if (exited) post({ type: 'killed' });
        else child.once('exit', () => post({ type: 'killed' }));
      }
    });
  });

  child.send({ type: 'run', payload: data.payload }, (error) => {
    if (error) post({ type: 'spawnError', message: String(error) });
  });
}

main();
