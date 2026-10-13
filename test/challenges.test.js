const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const out = (file) => require(path.resolve(__dirname, '..', 'out', 'challenges', file));
const { CHALLENGES, getChallengeById } = out('catalog.js');
const scoring = out('scoring.js');
const { runChallengeTests } = out('runner.js');
const { ChallengeSession } = out('session.js');
const history = out('history.js');
const selection = out('selection.js');
const settings = out('settings.js');
const types = out('types.js');

const MIN = 60_000;
const DEFAULTS = scoring.DEFAULT_STAR_THRESHOLDS;

// Reference solutions prove every seeded challenge is solvable and its tests are right.
const REFERENCE_SOLUTIONS = {
  'reverse-in-place': `function reverseInPlace(chars) {
    for (let l = 0, r = chars.length - 1; l < r; l++, r--) { const t = chars[l]; chars[l] = chars[r]; chars[r] = t; }
  }`,
  'run-length-squeeze': `function squeeze(s) {
    let out = '';
    for (let i = 0; i < s.length; ) { let j = i; while (j < s.length && s[j] === s[i]) j++; out += s[i] + (j - i > 1 ? (j - i) : ''); i = j; }
    return out;
  }`,
  'best-shrimp-trade': `function maxProfit(prices) {
    let lo = Infinity, best = 0;
    for (const p of prices) { best = Math.max(best, p - lo); lo = Math.min(lo, p); }
    return best;
  }`,
  'pair-to-target': `function pairToTarget(nums, target) {
    const seen = new Map();
    for (let i = 0; i < nums.length; i++) { if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i]; seen.set(nums[i], i); }
  }`,
  'same-letters': `function sameLetters(a, b) {
    if (a.length !== b.length) return false;
    const c = {};
    for (const ch of a) c[ch] = (c[ch] || 0) + 1;
    for (const ch of b) { if (!c[ch]) return false; c[ch]--; }
    return true;
  }`,
  'seen-it-before': `function hasRepeat(nums) { return new Set(nums).size !== nums.length; }`,
  'mirror-check': `function isMirror(s) {
    const t = s.toLowerCase().replace(/[^a-z0-9]/g, '');
    return t === t.split('').reverse().join('');
  }`,
  'zeroes-to-the-back': `function zeroesToBack(nums) {
    let w = 0;
    for (let r = 0; r < nums.length; r++) if (nums[r] !== 0) { [nums[w], nums[r]] = [nums[r], nums[w]]; w++; }
  }`,
  'longest-fresh-stretch': `function longestFreshStretch(s) {
    const last = new Map(); let left = 0, best = 0;
    for (let r = 0; r < s.length; r++) { if (last.has(s[r]) && last.get(s[r]) >= left) left = last.get(s[r]) + 1; last.set(s[r], r); best = Math.max(best, r - left + 1); }
    return best;
  }`,
  'bracket-balance': `function isBalanced(s) {
    const pairs = { ')': '(', ']': '[', '}': '{' }; const st = [];
    for (const c of s) { if ('([{'.includes(c)) st.push(c); else if (st.pop() !== pairs[c]) return false; }
    return st.length === 0;
  }`,
  'find-in-sorted': `function findInSorted(nums, target) {
    let lo = 0, hi = nums.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (nums[m] === target) return m; if (nums[m] < target) lo = m + 1; else hi = m - 1; }
    return -1;
  }`,
  'unpack-the-crates': `function unpack(crates) {
    const out = []; (function visit(xs) { for (const x of xs) Array.isArray(x) ? visit(x) : out.push(x); })(crates); return out;
  }`,
  'how-deep-is-the-reef': `function reefDepth(root) { return root ? 1 + Math.max(reefDepth(root.left), reefDepth(root.right)) : 0; }`,
  'query-string-builder': `function buildQuery(params) {
    const pairs = [];
    for (const [k, v] of Object.entries(params)) { if (v === null) continue; (Array.isArray(v) ? v : [v]).forEach((x) => pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(x)))); }
    return pairs.length ? '?' + pairs.join('&') : '';
  }`,
  'gather-the-profiles': `async function gatherProfiles(ids) {
    const results = await Promise.allSettled(ids.map(fetchProfile));
    return results.filter((r) => r.status === 'fulfilled').map((r) => r.value.name);
  }`,
  'hex-color-check': `function isHexColor(s) { return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s); }`
};

function fakeMemento() {
  const store = new Map();
  return {
    store,
    get(key, fallback) {
      return store.has(key) ? store.get(key) : fallback;
    },
    async update(key, value) {
      store.set(key, value);
    }
  };
}

function passingRun() {
  return { results: [], passed: 3, total: 3, allPassed: true, logs: [] };
}

function failingRun() {
  return { results: [], passed: 2, total: 3, allPassed: false, logs: [] };
}

function attempt(overrides = {}) {
  return {
    challengeId: 'mirror-check',
    category: 'twoPointers',
    difficulty: 'easy',
    startedAt: 0,
    completedAt: 5 * MIN,
    elapsedMs: 5 * MIN,
    correct: true,
    stars: 5,
    assistance: [],
    submissions: 1,
    outcome: 'solved',
    ...overrides
  };
}

// ── Catalog ───────────────────────────────────────────────────────────────

test('every seeded challenge is well formed and solvable by its reference solution', async () => {
  const ids = new Set();
  for (const challenge of CHALLENGES) {
    assert.ok(!ids.has(challenge.id), `duplicate id ${challenge.id}`);
    ids.add(challenge.id);
    assert.ok(types.isChallengeCategory(challenge.category), `${challenge.id} category`);
    assert.ok(types.isDifficulty(challenge.difficulty), `${challenge.id} difficulty`);
    for (const field of ['title', 'description', 'pattern', 'hint', 'approach', 'expectedTimeComplexity', 'expectedSpaceComplexity']) {
      assert.ok(challenge[field], `${challenge.id} missing ${field}`);
    }
    assert.ok(challenge.examples.length > 0, `${challenge.id} examples`);
    assert.ok(challenge.tests.some((t) => !t.hidden), `${challenge.id} needs a visible test`);
    assert.ok(challenge.tests.some((t) => t.hidden), `${challenge.id} needs a hidden test`);
    assert.match(challenge.starterCode, new RegExp(`function ${challenge.functionName}\\(`));

    const reference = REFERENCE_SOLUTIONS[challenge.id];
    assert.ok(reference, `no reference solution for ${challenge.id}`);
    const run = await runChallengeTests(challenge, reference, { includeHidden: true });
    assert.equal(run.setupError, undefined, `${challenge.id}: ${run.setupError}`);
    assert.ok(run.allPassed, `${challenge.id} reference failed: ${JSON.stringify(run.results.filter((r) => !r.passed))}`);

    const starter = await runChallengeTests(challenge, challenge.starterCode, { includeHidden: true });
    assert.equal(starter.allPassed, false, `${challenge.id} starter code should not pass`);
  }
});

test('seed library covers the v1 spread', () => {
  const count = (category) => CHALLENGES.filter((c) => c.category === category).length;
  assert.ok(count('strings') + count('arrays') >= 3);
  assert.ok(count('hashing') >= 2);
  assert.ok(count('twoPointers') >= 2);
  assert.ok(count('slidingWindow') >= 1);
  assert.ok(count('stacksQueues') >= 1);
  assert.ok(count('binarySearch') >= 1);
});

// ── Runner ────────────────────────────────────────────────────────────────

test('Run Tests only runs visible tests; Submit runs hidden ones too', async () => {
  const challenge = getChallengeById('mirror-check');
  const source = REFERENCE_SOLUTIONS['mirror-check'];
  const visible = challenge.tests.filter((t) => !t.hidden).length;

  const run = await runChallengeTests(challenge, source, { includeHidden: false });
  assert.equal(run.total, visible);
  assert.ok(run.results.every((r) => !r.hidden));

  const submit = await runChallengeTests(challenge, source, { includeHidden: true });
  assert.equal(submit.total, challenge.tests.length);
});

test('runner reports wrong answers, syntax errors, missing functions, and infinite loops', async () => {
  const challenge = getChallengeById('find-in-sorted');

  const wrong = await runChallengeTests(challenge, 'function findInSorted() { return 0; }', { includeHidden: false });
  assert.equal(wrong.allPassed, false);
  const firstFail = wrong.results.find((r) => !r.passed);
  assert.equal(firstFail.expected, '4');
  assert.equal(firstFail.received, '0');

  const syntax = await runChallengeTests(challenge, 'function findInSorted( {', { includeHidden: false });
  assert.match(syntax.setupError, /SyntaxError/);

  const missing = await runChallengeTests(challenge, 'function somethingElse() {}', { includeHidden: false });
  assert.match(missing.setupError, /findInSorted/);

  const loop = await runChallengeTests(challenge, 'function findInSorted() { while (true) {} }', { includeHidden: false });
  assert.equal(loop.allPassed, false);
  assert.match(loop.results[0].error, /Timed out/);
});

test('hidden test details are never exposed', async () => {
  const challenge = getChallengeById('mirror-check');
  const run = await runChallengeTests(challenge, 'function isMirror() { return false; }', { includeHidden: true });
  for (const result of run.results.filter((r) => r.hidden)) {
    assert.equal(result.expected, undefined);
    assert.equal(result.received, undefined);
  }
});

// ── Scoring ───────────────────────────────────────────────────────────────

test('correct solution scoring follows the default timing thresholds', () => {
  const score = (minutes) =>
    scoring.scoreAttempt({ correct: true, elapsedMs: minutes * MIN, assistance: [], thresholds: DEFAULTS }).stars;

  assert.equal(score(8.7), 5);
  assert.equal(score(10), 5);
  assert.equal(score(10.01), 4);
  assert.equal(score(15), 4);
  assert.equal(score(19), 3);
  assert.equal(score(20), 3);
  assert.equal(score(29.9), 2);
  assert.equal(score(30), 2);
  assert.equal(score(31), 1);
  assert.equal(score(240), 1);
});

test('incorrect submission cannot receive a completion rating, however fast', () => {
  const result = scoring.scoreAttempt({ correct: false, elapsedMs: 30_000, assistance: [], thresholds: DEFAULTS });
  assert.equal(result.stars, 0);
  assert.equal(result.correct, false);
  assert.equal(result.rawTimingStars, 5, 'timing alone would have been 5');

  const session = new ChallengeSession(getChallengeById('mirror-check'), 0);
  const outcome = session.submit(failingRun(), 60_000, DEFAULTS);
  assert.equal(outcome.score.stars, 0);
  assert.equal(outcome.attempt, undefined, 'incorrect submission does not complete the attempt');
  assert.equal(session.isFinished, false, 'session stays open for another try');
});

test('custom star thresholds are respected and normalised', () => {
  const custom = scoring.normalizeThresholds({ five: 5, four: 8, three: 12, two: 20 });
  assert.equal(scoring.timingStars(6 * MIN, custom), 4);
  assert.equal(scoring.timingStars(21 * MIN, custom), 1);

  const broken = scoring.normalizeThresholds({ five: 20, four: 10, three: -1, two: NaN });
  assert.deepEqual(broken, { five: 20, four: 20, three: 20, two: 30 });
});

test('Reveal Pattern caps the rating at 4 stars', () => {
  const s = scoring.scoreAttempt({ correct: true, elapsedMs: 2 * MIN, assistance: ['pattern'], thresholds: DEFAULTS });
  assert.equal(s.rawTimingStars, 5);
  assert.equal(s.cap, 4);
  assert.equal(s.stars, 4);
});

test('Show Hint caps the rating at 3 stars (8 minute solve example)', () => {
  const s = scoring.scoreAttempt({ correct: true, elapsedMs: 8 * MIN, assistance: ['hint'], thresholds: DEFAULTS });
  assert.equal(s.rawTimingStars, 5);
  assert.equal(s.stars, 3);
});

test('Show Approach caps the rating at 2 stars', () => {
  const s = scoring.scoreAttempt({ correct: true, elapsedMs: 2 * MIN, assistance: ['approach'], thresholds: DEFAULTS });
  assert.equal(s.stars, 2);
});

test('caps limit the rating rather than subtracting stars', () => {
  // 25 minutes → 2 stars by time; a hint cap of 3 does not lower it further.
  const s = scoring.scoreAttempt({ correct: true, elapsedMs: 25 * MIN, assistance: ['hint'], thresholds: DEFAULTS });
  assert.equal(s.stars, 2);
});

test('combined assistance uses the lowest applicable cap', () => {
  assert.equal(scoring.assistanceCap(['pattern', 'hint']), 3);
  assert.equal(scoring.assistanceCap(['hint', 'pattern', 'approach']), 2);
  assert.equal(scoring.assistanceCap([]), 5);

  const session = new ChallengeSession(getChallengeById('pair-to-target'), 0);
  assert.equal(session.useAssistance('hint'), getChallengeById('pair-to-target').hint);
  session.useAssistance('pattern');
  assert.equal(session.maxStarsNow(MIN, DEFAULTS), 3);
  const outcome = session.submit(passingRun(), 3 * MIN, DEFAULTS);
  assert.equal(outcome.attempt.stars, 3);
  assert.deepEqual(outcome.attempt.assistance, ['pattern', 'hint']);
});

test('challenge timer does not hard-fail after the last threshold', () => {
  const session = new ChallengeSession(getChallengeById('bracket-balance'), 0);
  const wayLate = 3 * 60 * MIN;

  assert.equal(session.isFinished, false);
  assert.equal(session.maxStarsNow(wayLate, DEFAULTS), 1, 'still worth a star');

  const miss = session.submit(failingRun(), wayLate, DEFAULTS);
  assert.equal(miss.attempt, undefined);
  assert.equal(session.isFinished, false);

  const solve = session.submit(passingRun(), wayLate + MIN, DEFAULTS);
  assert.equal(solve.attempt.correct, true);
  assert.equal(solve.attempt.stars, 1);
  assert.equal(solve.attempt.submissions, 2);
});

test('stars render as filled and empty glyphs', () => {
  assert.equal(scoring.renderStars(5), '★★★★★');
  assert.equal(scoring.renderStars(3), '★★★☆☆');
  assert.equal(scoring.formatElapsed(8 * MIN + 42_000), '08:42');
});

// ── Persistence & stats ───────────────────────────────────────────────────

test('attempts persist through the memento and are pruned', async () => {
  const memento = fakeMemento();
  const session = new ChallengeSession(getChallengeById('mirror-check'), 1_000);
  session.useAssistance('pattern');
  const { attempt: solved } = session.submit(passingRun(), 1_000 + 8 * MIN + 42_000, DEFAULTS);

  await history.recordAttempt(memento, solved);
  const loaded = history.loadAttempts(memento);
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0], {
    challengeId: 'mirror-check',
    category: 'twoPointers',
    difficulty: 'easy',
    startedAt: 1_000,
    completedAt: 1_000 + 8 * MIN + 42_000,
    elapsedMs: 8 * MIN + 42_000,
    correct: true,
    stars: 4,
    assistance: ['pattern'],
    submissions: 1,
    outcome: 'solved'
  });

  const abandoned = new ChallengeSession(getChallengeById('find-in-sorted'), 0).abandon(4 * MIN);
  await history.recordAttempt(memento, abandoned);
  assert.equal(history.loadAttempts(memento)[1].outcome, 'abandoned');
  assert.equal(history.loadAttempts(memento)[1].stars, 0);

  for (let i = 0; i < history.MAX_STORED_ATTEMPTS + 5; i += 1) {
    await history.recordAttempt(memento, attempt({ startedAt: i }));
  }
  assert.equal(history.loadAttempts(memento).length, history.MAX_STORED_ATTEMPTS);

  memento.store.set(history.ATTEMPTS_KEY, [{ junk: true }, attempt()]);
  assert.equal(history.loadAttempts(memento).length, 1, 'malformed entries are ignored');
});

test('in-flight session snapshot restores assistance and start time', () => {
  const challenge = getChallengeById('pair-to-target');
  const original = new ChallengeSession(challenge, 12_345);
  original.useAssistance('hint');
  original.submit(failingRun(), 20_000, DEFAULTS);

  const restored = new ChallengeSession(challenge, 99_999, original.snapshot());
  assert.equal(restored.startedAt, 12_345);
  assert.deepEqual(restored.assistance, ['hint']);
  assert.equal(restored.submissions, 1);
});

test('stats: totals, average time, five-star count, streak, and category scores', () => {
  const day = 24 * 60 * MIN;
  const now = new Date(2026, 9, 13, 15, 0, 0).getTime();
  const attempts = [
    attempt({ completedAt: now - 2 * day, elapsedMs: 4 * MIN, stars: 5 }),
    attempt({ completedAt: now - day, elapsedMs: 12 * MIN, stars: 4, category: 'hashing', challengeId: 'pair-to-target' }),
    attempt({ completedAt: now - 1000, elapsedMs: 8 * MIN, stars: 5 }),
    attempt({ completedAt: now - 500, correct: false, stars: 0, outcome: 'abandoned', category: 'slidingWindow', challengeId: 'longest-fresh-stretch', assistance: ['hint'] })
  ];

  const stats = history.computeStats(attempts, now);
  assert.equal(stats.totalAttempts, 4);
  assert.equal(stats.totalSolved, 3);
  assert.equal(stats.averageSolveMs, 8 * MIN);
  assert.equal(stats.fiveStarCount, 2);
  assert.equal(stats.currentStreakDays, 3);
  assert.equal(stats.assistanceUsage.hint, 1);

  const byCat = Object.fromEntries(stats.byCategory.map((s) => [s.category, s]));
  assert.equal(byCat.twoPointers.score, 1);
  assert.equal(byCat.hashing.score, 0.8);
  assert.equal(byCat.slidingWindow.score, 0);

  assert.equal(history.computeDayStreak([now - 3 * day], now), 0, 'gap breaks the streak');
  assert.equal(history.computeDayStreak([now - day], now), 1, 'yesterday keeps it alive');
});

// ── Selection ─────────────────────────────────────────────────────────────

test('category selection only offers enabled categories and difficulties', () => {
  const only = (cfg) => selection.eligibleChallenges(CHALLENGES, cfg).map((c) => c.category);

  const twoPointers = only({ categories: ['twoPointers'], difficulties: ['easy', 'medium'], includePractical: false });
  assert.ok(twoPointers.length >= 2);
  assert.ok(twoPointers.every((c) => c === 'twoPointers'));

  const mediumOnly = selection.eligibleChallenges(CHALLENGES, {
    categories: [...types.CORE_CATEGORIES],
    difficulties: ['medium'],
    includePractical: false
  });
  assert.ok(mediumOnly.length > 0);
  assert.ok(mediumOnly.every((c) => c.difficulty === 'medium'));

  assert.equal(only({ categories: [], difficulties: ['easy'], includePractical: false }).length, 0);
  assert.equal(
    selection.selectChallenge(CHALLENGES, { categories: [], difficulties: ['easy'], includePractical: false }, []),
    undefined
  );
});

test('practical categories need includePractical', () => {
  const cfg = { categories: ['api', 'regex', 'async', 'strings'], difficulties: ['easy', 'medium'] };
  const off = selection.eligibleChallenges(CHALLENGES, { ...cfg, includePractical: false });
  assert.ok(off.every((c) => !types.isPracticalCategory(c.category)));
  const on = selection.eligibleChallenges(CHALLENGES, { ...cfg, includePractical: true });
  assert.ok(on.some((c) => c.category === 'api'));
});

test('disabled challenges are never selected', () => {
  const disabled = CHALLENGES.map((c) => ({ ...c, enabled: c.id === 'mirror-check' }));
  const cfg = { categories: [...types.CORE_CATEGORIES], difficulties: ['easy', 'medium'], includePractical: false };
  for (let i = 0; i < 20; i += 1) {
    assert.equal(selection.selectChallenge(disabled, cfg, [], () => i / 20).id, 'mirror-check');
  }
});

test('weighted selection prefers unseen challenges and weaker categories', () => {
  const pair = getChallengeById('pair-to-target');
  const mirror = getChallengeById('mirror-check');
  const stretch = getChallengeById('longest-fresh-stretch');

  const justSolved = [attempt({ challengeId: 'mirror-check', category: 'twoPointers', stars: 5 })];
  assert.ok(selection.challengeWeight(mirror, justSolved) < selection.challengeWeight(pair, justSolved));

  const weakWindow = [
    attempt({ challengeId: 'x1', category: 'slidingWindow', stars: 1 }),
    attempt({ challengeId: 'x2', category: 'hashing', stars: 5 }),
    attempt({ challengeId: 'x3', category: 'hashing', stars: 5 }),
    attempt({ challengeId: 'x4', category: 'slidingWindow', stars: 1 }),
    attempt({ challengeId: 'x5', category: 'hashing', stars: 5 }),
    attempt({ challengeId: 'x6', category: 'hashing', stars: 5 })
  ];
  assert.ok(selection.challengeWeight(stretch, weakWindow) > selection.challengeWeight(pair, weakWindow));
});

// ── Settings ──────────────────────────────────────────────────────────────

test('settings reader applies defaults and filters bad values', () => {
  const read = (values) =>
    settings.readChallengeSettings({ get: (key, fallback) => (key in values ? values[key] : fallback) });

  const defaults = read({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.intervalMinutes, 60);
  assert.deepEqual(defaults.difficulties, ['easy', 'medium']);
  assert.deepEqual(defaults.categories, [...types.CORE_CATEGORIES]);
  assert.deepEqual(defaults.thresholds, DEFAULTS);

  const messy = read({ 'challenge.categories': ['strings', 'graphs'], 'challenge.difficulties': ['extreme', 'hard'], 'challenge.intervalMinutes': 0 });
  assert.deepEqual(messy.categories, ['strings']);
  assert.deepEqual(messy.difficulties, ['hard']);
  assert.equal(messy.intervalMinutes, 1);
});

test('Interview Sprint preset matches the spec', () => {
  const preset = Object.fromEntries(settings.INTERVIEW_SPRINT_PRESET);
  assert.equal(preset['challenge.enabled'], true);
  assert.deepEqual(preset['challenge.categories'], [
    'strings', 'arrays', 'hashing', 'twoPointers', 'slidingWindow', 'stacksQueues', 'binarySearch'
  ]);
  assert.deepEqual(preset['challenge.difficulties'], ['easy', 'medium']);
  assert.equal(preset['challenge.fiveStarMinutes'], 10);
  assert.ok(preset['challenge.intervalMinutes'] < settings.DEFAULT_INTERVAL_MINUTES, 'more frequent than default');
});
