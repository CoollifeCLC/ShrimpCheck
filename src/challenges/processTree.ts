import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Kills a process and all of its descendants.
 * - Windows: `taskkill /PID <pid> /T /F` (tree, forced). Callers follow up with
 *   a direct kill in `onDone` as a fallback.
 * - POSIX: SIGKILL to the process group (runners are spawned as group leaders).
 *
 * This file must not import `vscode`: it runs on the launcher worker thread too.
 */
export function killProcessTree(pid: number, options: { sync?: boolean; onDone?: () => void } = {}): void {
  const done = options.onDone ?? (() => undefined);
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    const args = ['/PID', String(pid), '/T', '/F'];
    if (options.sync) {
      try {
        spawnSync(taskkill, args, { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      } catch {
        // fall through to the caller's direct kill
      }
      done();
      return;
    }
    let called = false;
    const once = (): void => {
      if (called) return;
      called = true;
      done();
    };
    try {
      const killer = spawn(taskkill, args, { windowsHide: true, stdio: 'ignore' });
      killer.on('exit', once);
      killer.on('error', once);
    } catch {
      once();
    }
    setTimeout(once, 3000).unref?.();
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // group already gone
  }
  done();
}
