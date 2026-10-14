// Containment tests for the Challenge Mode runner.
//
// Every test runs hostile code through the real runChallengeTests() and checks
// three things from the point of view of this process (standing in for the
// VS Code extension host):
//   1. the run returns a structured result within its budget,
//   2. this process's event loop never stalls (50 ms heartbeat),
//   3. the runner process is gone afterwards (no orphans).

const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const runner = require(path.resolve(__dirname, '..', 'out', 'challenges', 'runner.js'));
const { getChallengeById } = require(path.resolve(__dirname, '..', 'out', 'challenges', 'catalog.js'));
const { runChallengeTests, activeRunnerCount, cancelAllChallengeRuns, killProcessTree } = runner;

/**
 * Max tolerated host event-loop gap. The failure this guards against froze the
 * host for seconds (or forever). A wall-clock heartbeat also sees OS scheduling
 * noise on a busy Windows desktop (observed up to ~260 ms while a runner pins a
 * core), so the threshold sits well above that. The narrower regression (a
 * ~400 ms synchronous fork() on the host thread) is covered deterministically
 * by the "never starts processes" test below instead of by timing.
 */
const MAX_STALL_MS = 1000;
const HEARTBEAT_MS = 20;

const probe = {
  id: 'probe',
  functionName: 'f',
  tests: [
    { args: [1], expected: 1 },
    { args: [2], expected: 2 },
    { args: [3], expected: 3, hidden: true }
  ]
};

function isAlive(pid) {
  assert.ok(Number.isInteger(pid) && pid > 0, `isAlive() needs a real pid, got ${pid}`);
  if (process.platform === 'win32') {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true });
    return out.includes(`"${pid}"`);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function waitForExit(pid, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isAlive(pid);
}

async function waitFor(check, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return check();
}

/** Runs code through the runner while measuring host responsiveness, then checks cleanup. */
async function contained(source, { challenge = probe, includeHidden = true, budgetMs } = {}) {
  let last = Date.now();
  let maxStall = 0;
  const heartbeat = setInterval(() => {
    const now = Date.now();
    maxStall = Math.max(maxStall, now - last - HEARTBEAT_MS);
    last = now;
  }, HEARTBEAT_MS);
  const rssBefore = process.memoryUsage().rss;
  const startedAt = Date.now();
  const summary = await runChallengeTests(challenge, source, { includeHidden });
  const tookMs = Date.now() - startedAt;
  clearInterval(heartbeat);

  const pid = summary.runner && summary.runner.pid;
  assert.ok(pid, 'runner pid reported');
  const exited = await waitForExit(pid);
  const rssGrowthMb = (process.memoryUsage().rss - rssBefore) / 1e6;

  const report = { tookMs, maxStallMs: maxStall, pid, exited, rssGrowthMb: Math.round(rssGrowthMb), stop: summary.runner.stopReason };
  // Machine-readable evidence line for the closeout report.
  console.log(`# evidence ${JSON.stringify({ source: source.slice(0, 60), ...report })}`);

  assert.ok(maxStall < MAX_STALL_MS, `host event loop stalled ${maxStall} ms`);
  assert.ok(exited, `runner pid ${pid} still alive after the run`);
  assert.ok(await waitFor(() => activeRunnerCount() === 0), 'no runner left registered');
  if (budgetMs) assert.ok(tookMs < budgetMs, `run took ${tookMs} ms (budget ${budgetMs})`);
  return { summary, ...report };
}

const statuses = (summary) => summary.results.map((r) => r.status);

// ── 1. Synchronous infinite loops ─────────────────────────────────────────

test('1a. sync infinite loop inside the solution → TIME_LIMIT_EXCEEDED per test, host never stalls', async () => {
  const { summary } = await contained('function f() { while (true) {} }', { budgetMs: 12_000 });
  assert.deepEqual(statuses(summary), ['TIME_LIMIT_EXCEEDED', 'TIME_LIMIT_EXCEEDED', 'TIME_LIMIT_EXCEEDED']);
  assert.match(summary.results[0].error, /Timed out/);
  assert.equal(summary.allPassed, false);
});

test('1b. sync infinite loop at top level → setup error, host never stalls', async () => {
  const { summary } = await contained('while (true) {} function f(x) { return x; }', { budgetMs: 6000 });
  assert.match(summary.setupError, /Timed out/);
});

test('1c. sync infinite loop in challenge setup code → setup error', async () => {
  const challenge = { ...probe, setup: 'for (;;) {}' };
  const { summary } = await contained('function f(x) { return x; }', { challenge, budgetMs: 6000 });
  assert.match(summary.setupError, /Timed out/);
});

// ── 2. Infinite loop after await ──────────────────────────────────────────

test('2. infinite loop after await → TIME_LIMIT_EXCEEDED, host never stalls', async () => {
  const { summary } = await contained('async function f(x) { await null; while (true) {} }', { budgetMs: 12_000 });
  assert.deepEqual(statuses(summary), ['TIME_LIMIT_EXCEEDED', 'TIME_LIMIT_EXCEEDED', 'TIME_LIMIT_EXCEEDED']);
});

// ── 3. .then() infinite loops ─────────────────────────────────────────────

test('3a. .then() infinite loop at top level → setup error, host never stalls', async () => {
  const { summary } = await contained('Promise.resolve().then(() => { for (;;) {} }); function f(x) { return x; }', {
    budgetMs: 6000
  });
  assert.match(summary.setupError, /Timed out/);
});

test('3b. .then() infinite loop inside the solution → TIME_LIMIT_EXCEEDED', async () => {
  const { summary } = await contained('function f(x) { return Promise.resolve(x).then(() => { for (;;) {} }); }', {
    budgetMs: 12_000
  });
  assert.ok(summary.results.every((r) => r.status === 'TIME_LIMIT_EXCEEDED'), JSON.stringify(statuses(summary)));
});

// ── 4. Timer-triggered infinite loops ─────────────────────────────────────

test('4a. loop scheduled with setTimeout after returning → host never stalls, runner killed', async () => {
  // Return values are correct, so tests pass; the stray timer dies with the runner.
  const { summary } = await contained('function f(x) { setTimeout(() => { while (true) {} }, 0); return x; }', {
    budgetMs: 6000
  });
  assert.equal(summary.results.length, 3);
});

test('4b. solution that awaits a timer whose callback loops → TIME_LIMIT_EXCEEDED', async () => {
  const { summary } = await contained(
    'function f(x) { return new Promise((r) => setTimeout(() => { for (;;) {} r(x); }, 1)); }',
    { budgetMs: 15_000 }
  );
  assert.ok(summary.results.every((r) => r.status === 'TIME_LIMIT_EXCEEDED'), JSON.stringify(statuses(summary)));
});

test('4c. legitimate setTimeout-based async solution still passes', async () => {
  const { summary } = await contained(
    'async function f(x) { await new Promise((r) => setTimeout(r, 5)); const t = setTimeout(() => {}, 50); clearTimeout(t); return x; }',
    { budgetMs: 6000 }
  );
  assert.equal(summary.allPassed, true, JSON.stringify(summary.results));
});

// ── 5. Unresolved promise ─────────────────────────────────────────────────

test('5. promise that never settles → TIME_LIMIT_EXCEEDED, host never stalls', async () => {
  const { summary } = await contained('function f() { return new Promise(() => {}); }', { budgetMs: 15_000 });
  assert.deepEqual(statuses(summary), ['TIME_LIMIT_EXCEEDED', 'TIME_LIMIT_EXCEEDED', 'TIME_LIMIT_EXCEEDED']);
  assert.match(summary.results[0].error, /promise never settled/);
});

// ── 7. Memory balloons ────────────────────────────────────────────────────

test('7a. heap allocation balloon → MEMORY_LIMIT_EXCEEDED, host memory unchanged', async () => {
  const { summary, rssGrowthMb } = await contained(
    'var keep = []; function f(x) { for (;;) keep.push(new Array(1e6).fill(x)); }',
    { budgetMs: 10_000 }
  );
  assert.equal(summary.results[0].status, 'MEMORY_LIMIT_EXCEEDED', JSON.stringify(summary.results[0]));
  assert.ok(summary.results.slice(1).every((r) => r.status === 'NOT_RUN'));
  assert.ok(rssGrowthMb < 50, `host RSS grew ${rssGrowthMb} MB`);
});

test('7b. off-heap (ArrayBuffer) balloon → MEMORY_LIMIT_EXCEEDED, host memory unchanged', async () => {
  const { summary, rssGrowthMb } = await contained(
    'var keep = []; function f(x) { for (;;) keep.push(new Uint8Array(64 * 1024 * 1024).fill(1)); }',
    { budgetMs: 10_000 }
  );
  assert.equal(summary.results[0].status, 'MEMORY_LIMIT_EXCEEDED', JSON.stringify(summary.results[0]));
  assert.ok(rssGrowthMb < 50, `host RSS grew ${rssGrowthMb} MB`);
});

// ── Backstop + lifecycle ──────────────────────────────────────────────────

test('host-side hard deadline kills a runner the inner vm timeout cannot stop', async () => {
  // The getter runs while the worker serializes the result — outside any vm
  // timeout — so only the extension-side deadline can end it.
  const { summary } = await contained('function f(x) { return { get v() { for (;;) {} } }; }', { budgetMs: 15_000 });
  assert.equal(summary.runner.stopReason, 'timeout');
  assert.equal(summary.results[0].status, 'TIME_LIMIT_EXCEEDED');
  assert.deepEqual(statuses(summary).slice(1), ['NOT_RUN', 'NOT_RUN']);
});

test('cancelAllChallengeRuns() kills an in-flight runner immediately', async () => {
  const pending = runChallengeTests(probe, 'async function f() { await null; for (;;) {} }', { includeHidden: true });
  // fork() alone takes ~400 ms on Windows: wait until the runner process actually exists.
  assert.ok(await waitFor(() => runner.activeRunnerPids().length === 1, 10_000), 'runner never started');
  const runnerPid = runner.activeRunnerPids()[0];
  const t0 = Date.now();
  cancelAllChallengeRuns();
  const summary = await pending;
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(summary.runner.stopReason, 'cancelled');
  assert.equal(activeRunnerCount(), 0);
  assert.ok(await waitForExit(runnerPid), `cancelled runner ${runnerPid} still alive`);
});

test('cancel that lands while fork() is still in progress leaves no orphan', async () => {
  let spawnedPid;
  runner.setRunnerTraceHook((event, detail) => {
    if (event === 'spawned') spawnedPid = detail && detail.pid;
  });
  try {
    const pending = runChallengeTests(probe, 'async function f() { await null; for (;;) {} }', { includeHidden: true });
    cancelAllChallengeRuns(); // immediately: the launcher has not forked yet
    const summary = await pending;
    assert.equal(summary.runner.stopReason, 'cancelled');
    assert.equal(activeRunnerCount(), 0);
    // The launcher still forks, then kills what it forked.
    assert.ok(await waitFor(() => spawnedPid !== undefined, 10_000), 'launcher never reported a pid');
    assert.ok(await waitForExit(spawnedPid, 5000), `runner ${spawnedPid} forked after cancel is still alive`);
    console.log(`# evidence ${JSON.stringify({ cancelDuringFork: true, runnerPid: spawnedPid, exited: true })}`);
  } finally {
    runner.setRunnerTraceHook(undefined);
  }
});

test('large console output and return values are bounded', async () => {
  const { summary } = await contained(
    'function f(x) { for (let i = 0; i < 500; i++) console.log("y".repeat(1e6)); return "z".repeat(5e6); }',
    { budgetMs: 10_000 }
  );
  assert.ok(summary.logs.length <= 50);
  assert.ok(summary.logs.join('').length <= 16_000 + 50 * 32, `logs ${summary.logs.join('').length} chars`);
  assert.equal(summary.results[0].status, 'OUTPUT_LIMIT_EXCEEDED');
});

test('sandbox does not expose process, require, or host constructors', async () => {
  const source =
    'function f(x) { const probes = [' +
    'typeof process, typeof require, typeof Buffer, ' +
    '(function(){ try { return this.constructor.constructor("return typeof process")(); } catch (e) { return "blocked"; } })(), ' +
    '(function(){ try { return console.log.constructor("return typeof process")(); } catch (e) { return "blocked"; } })(), ' +
    '(function(){ try { return setTimeout.constructor("return typeof process")(); } catch (e) { return "blocked"; } })()' +
    ']; return probes.every((p) => p === "undefined" || p === "blocked") ? x : probes.join(","); }';
  const { summary } = await contained(source);
  assert.equal(summary.allPassed, true, JSON.stringify(summary.results));
});

test('every catalog async/regular reference still behaves: gather-the-profiles passes through the child', async () => {
  const challenge = getChallengeById('gather-the-profiles');
  const source =
    'async function gatherProfiles(ids) { const r = await Promise.allSettled(ids.map(fetchProfile)); return r.filter((x) => x.status === "fulfilled").map((x) => x.value.name); }';
  const { summary } = await contained(source, { challenge });
  assert.equal(summary.allPassed, true, JSON.stringify(summary.results));
});

// ── Process-tree cleanup (Windows: taskkill /PID <pid> /T /F) ─────────────

test('the extension host thread never starts or kills processes itself (fork/spawn stay on the launcher thread)', async () => {
  // Process creation blocks the calling thread (~400 ms per fork on Windows).
  // Record every child_process call made from this (main) thread during a run
  // that times out and gets its runner killed. Worker threads load their own
  // copy of child_process, so the launcher's legitimate calls are not counted.
  const cp = require('node:child_process');
  const names = ['fork', 'spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'];
  const original = {};
  const calls = [];
  for (const name of names) {
    original[name] = cp[name];
    cp[name] = function (...args) {
      calls.push(`${name}(${String(args[0])})`);
      return original[name].apply(this, args);
    };
  }
  let summary;
  try {
    const oneTest = { id: 'probe', functionName: 'f', tests: [{ args: [1], expected: 1 }] };
    summary = await runChallengeTests(oneTest, 'function f() { while (true) {} }', { includeHidden: true });
    assert.ok(await waitFor(() => activeRunnerCount() === 0), 'runner teardown finished');
  } finally {
    Object.assign(cp, original);
  }
  assert.equal(summary.results[0].status, 'TIME_LIMIT_EXCEEDED');
  assert.ok(await waitForExit(summary.runner.pid), 'runner exited');
  assert.deepEqual(calls, [], `main-thread process calls: ${calls.join(', ')}`);
});

test('killProcessTree() removes a runner and its grandchildren', async () => {
  // parent → grandchild, both long-lived; mirrors a runner that spawned something.
  const script =
    "const { spawn } = require('node:child_process');" +
    "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });" +
    'process.stdout.write(String(g.pid) + "\\n");' +
    'setInterval(() => {}, 1000);';
  const parent = spawn(process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: process.platform !== 'win32',
    windowsHide: true
  });
  const grandchildPid = await new Promise((resolve, reject) => {
    parent.stdout.once('data', (d) => resolve(Number(String(d).trim())));
    parent.once('error', reject);
  });
  assert.ok(isAlive(parent.pid) && isAlive(grandchildPid), 'tree started');

  await new Promise((resolve) => killProcessTree(parent.pid, { onDone: resolve }));

  assert.ok(await waitForExit(parent.pid), `runner ${parent.pid} survived`);
  assert.ok(await waitForExit(grandchildPid), `grandchild ${grandchildPid} survived (orphan)`);
  console.log(`# evidence ${JSON.stringify({ treeKill: process.platform, parent: parent.pid, grandchild: grandchildPid, bothGone: true })}`);
});

test('runner exits on its own when the extension host is killed mid-loop (no orphan)', async () => {
  // Stand-in extension host: starts a run whose loop no vm timeout can stop, reports the runner pid.
  const hostScript =
    `const r = require(${JSON.stringify(path.resolve(__dirname, '..', 'out', 'challenges', 'runner.js'))});` +
    "r.runChallengeTests({ id: 'p', functionName: 'f', tests: [{ args: [1], expected: 1 }] }," +
    " 'function f() { return { get v() { for (;;) {} } }; }', { includeHidden: true });" +
    // fork() alone takes ~400 ms on Windows (longer under load): report the pid once the runner exists.
    "const t0 = Date.now(); const poll = setInterval(() => { const pid = r.activeRunnerPids()[0];" +
    " if (pid || Date.now() - t0 > 15000) { clearInterval(poll); process.stdout.write(String(pid) + '\\n'); } }, 25);";
  const host = spawn(process.execPath, ['-e', hostScript], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const runnerPid = await new Promise((resolve, reject) => {
    host.stdout.once('data', (d) => resolve(Number(String(d).trim())));
    host.once('error', reject);
  });
  assert.ok(runnerPid > 0 && isAlive(runnerPid), 'runner started and spinning');

  host.kill('SIGKILL'); // TerminateProcess on Windows: no cleanup code runs in the host
  const t0 = Date.now();
  const exited = await waitForExit(runnerPid, 8000);
  console.log(`# evidence ${JSON.stringify({ hostKilled: true, runnerPid, exited, exitAfterMs: Date.now() - t0 })}`);
  if (!exited) killProcessTree(runnerPid, { sync: true });
  assert.ok(exited, `runner ${runnerPid} outlived its extension host`);
});
