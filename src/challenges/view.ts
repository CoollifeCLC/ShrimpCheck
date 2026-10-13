// HTML for the Challenge Mode webviews. No `vscode` import: the extension
// passes in the CSP source and nonce, which also lets these pages be rendered
// in a plain browser for previews and screenshots.

import { ChallengeStats } from './history';
import { RunSummary, formatValue } from './runner';
import { ASSISTANCE_CAPS, formatElapsed, renderStars } from './scoring';
import {
  AssistanceKind,
  CATEGORY_LABELS,
  Challenge,
  DIFFICULTY_LABELS,
  StarThresholds
} from './types';

export interface ChallengeViewState {
  challenge: {
    id: string;
    title: string;
    difficulty: string;
    difficultyKey: string;
    category: string;
    description: string;
    examples: Challenge['examples'];
    constraints: string[];
    functionName: string;
    visibleTests: Array<{ call: string; expected: string }>;
    hiddenTestCount: number;
  };
  startedAt: number;
  thresholds: StarThresholds;
  caps: Record<AssistanceKind, number>;
  revealed: Partial<Record<AssistanceKind, string>>;
  lastRun?: { kind: 'run' | 'submit'; summary: RunSummary };
  result?: ChallengeResultView;
}

export interface ChallengeResultView {
  stars: number;
  starsText: string;
  elapsedText: string;
  correctness: 'Passed';
  timeComplexity: string;
  spaceComplexity: string;
  pattern: string;
  assistanceUsed: string[];
  submissions: number;
  rawTimingStars: number;
  cap: number;
}

export const ASSISTANCE_LABELS: Record<AssistanceKind, string> = {
  pattern: 'Reveal Pattern',
  hint: 'Show Hint',
  approach: 'Show Approach'
};

export function buildChallengeViewState(
  challenge: Challenge,
  startedAt: number,
  thresholds: StarThresholds,
  revealed: Partial<Record<AssistanceKind, string>>,
  lastRun?: ChallengeViewState['lastRun'],
  result?: ChallengeResultView
): ChallengeViewState {
  const visible = challenge.tests.filter((test) => !test.hidden);
  return {
    challenge: {
      id: challenge.id,
      title: challenge.title,
      difficulty: DIFFICULTY_LABELS[challenge.difficulty],
      difficultyKey: challenge.difficulty,
      category: CATEGORY_LABELS[challenge.category],
      description: challenge.description,
      examples: challenge.examples,
      constraints: challenge.constraints,
      functionName: challenge.functionName,
      visibleTests: visible.map((test) => ({
        call: `${challenge.functionName}(${test.args.map((arg) => formatValue(arg)).join(', ')})`,
        expected: formatValue(test.expected)
      })),
      hiddenTestCount: challenge.tests.length - visible.length
    },
    startedAt,
    thresholds,
    caps: { ...ASSISTANCE_CAPS },
    revealed,
    lastRun,
    result
  };
}

export function buildResultView(
  challenge: Challenge,
  stars: number,
  elapsedMs: number,
  assistance: AssistanceKind[],
  submissions: number,
  rawTimingStars: number,
  cap: number
): ChallengeResultView {
  return {
    stars,
    starsText: renderStars(stars),
    elapsedText: formatElapsed(elapsedMs),
    correctness: 'Passed',
    timeComplexity: challenge.expectedTimeComplexity,
    spaceComplexity: challenge.expectedSpaceComplexity,
    pattern: challenge.pattern,
    assistanceUsed: assistance.map((kind) => ASSISTANCE_LABELS[kind].replace(/^(Reveal|Show) /, '')),
    submissions,
    rawTimingStars,
    cap
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON safe to embed inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const BASE_STYLES = `
  :root {
    --sc-fg: var(--vscode-foreground, #cccccc);
    --sc-muted: var(--vscode-descriptionForeground, #9d9d9d);
    --sc-bg: var(--vscode-editor-background, #1e1e1e);
    --sc-panel: var(--vscode-sideBar-background, #252526);
    --sc-border: var(--vscode-panel-border, #3c3c3c);
    --sc-accent: var(--vscode-textLink-foreground, #3794ff);
    --sc-btn-bg: var(--vscode-button-background, #0e639c);
    --sc-btn-fg: var(--vscode-button-foreground, #ffffff);
    --sc-btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --sc-btn2-bg: var(--vscode-button-secondaryBackground, #3a3d41);
    --sc-btn2-fg: var(--vscode-button-secondaryForeground, #ffffff);
    --sc-btn2-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
    --sc-code-bg: var(--vscode-textCodeBlock-background, #2a2a2a);
    --sc-pass: var(--vscode-testing-iconPassed, #73c991);
    --sc-fail: var(--vscode-testing-iconFailed, #f14c4c);
    --sc-star: var(--vscode-charts-yellow, #e2c08d);
    --sc-shrimp: #ff8a65;
    --sc-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 20px 24px 40px;
    color: var(--sc-fg); background: var(--sc-bg);
    font-family: var(--vscode-font-family, -apple-system, "Segoe UI", sans-serif);
    font-size: var(--vscode-font-size, 13px); line-height: 1.55;
  }
  h1 { font-size: 1.45em; margin: 0; font-weight: 600; }
  h2 { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-muted); margin: 22px 0 8px; font-weight: 600; }
  code, pre { font-family: var(--sc-mono); font-size: 0.92em; }
  code { background: var(--sc-code-bg); padding: 1px 5px; border-radius: 3px; }
  pre { background: var(--sc-code-bg); padding: 8px 10px; border-radius: 4px; margin: 0; white-space: pre-wrap; word-break: break-word; }
  .muted { color: var(--sc-muted); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .chip { border: 1px solid var(--sc-border); border-radius: 999px; padding: 1px 9px; font-size: 0.85em; color: var(--sc-muted); }
  .chip.easy { color: var(--sc-pass); border-color: color-mix(in srgb, var(--sc-pass) 45%, transparent); }
  .chip.medium { color: var(--sc-star); border-color: color-mix(in srgb, var(--sc-star) 45%, transparent); }
  .chip.hard { color: var(--sc-fail); border-color: color-mix(in srgb, var(--sc-fail) 45%, transparent); }
  .stars { color: var(--sc-star); letter-spacing: 2px; }
  button {
    font: inherit; border: none; border-radius: 3px; padding: 5px 12px; cursor: pointer;
    background: var(--sc-btn-bg); color: var(--sc-btn-fg);
  }
  button:hover { background: var(--sc-btn-hover); }
  button.secondary { background: var(--sc-btn2-bg); color: var(--sc-btn2-fg); }
  button.secondary:hover { background: var(--sc-btn2-hover); }
  button.link { background: none; color: var(--sc-accent); padding: 0; }
  button.link:hover { text-decoration: underline; background: none; }
  button:disabled { opacity: 0.55; cursor: default; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
`;

export interface WebviewSecurity {
  cspSource: string;
  nonce: string;
}

function csp(security: WebviewSecurity, allowScript: boolean): string {
  const script = allowScript ? ` script-src 'nonce-${security.nonce}';` : '';
  return `default-src 'none'; style-src ${security.cspSource} 'unsafe-inline';${script}`;
}

export function renderChallengeHtml(state: ChallengeViewState, security: WebviewSecurity): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(security, true)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(state.challenge.title)}</title>
<style>
${BASE_STYLES}
  .top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
  .clock { text-align: right; min-width: 150px; }
  .clock .time { font-family: var(--sc-mono); font-size: 1.6em; font-variant-numeric: tabular-nums; }
  .clock .max { font-size: 0.85em; }
  .clock .note { font-size: 0.78em; }
  .desc { margin-top: 14px; max-width: 72ch; }
  .example { margin-bottom: 8px; }
  ul.constraints { margin: 0; padding-left: 18px; }
  .tests div { font-family: var(--sc-mono); font-size: 0.9em; padding: 2px 0; }
  .assist { display: grid; gap: 8px; }
  .assist-row { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .assist-row .cost { font-size: 0.82em; }
  .reveal { border-left: 2px solid var(--sc-shrimp); padding: 4px 10px; margin: 2px 0 4px; background: var(--sc-panel); border-radius: 0 3px 3px 0; }
  .reveal b { color: var(--sc-shrimp); font-weight: 600; }
  .actions { display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap; align-items: center; }
  .actions .spacer { flex: 1; }
  .run { margin-top: 16px; border: 1px solid var(--sc-border); border-radius: 4px; overflow: hidden; }
  .run-head { padding: 7px 10px; background: var(--sc-panel); display: flex; justify-content: space-between; }
  .run-row { padding: 6px 10px; border-top: 1px solid var(--sc-border); font-size: 0.92em; }
  .run-row .mark { display: inline-block; width: 1.2em; font-weight: 700; }
  .ok { color: var(--sc-pass); }
  .bad { color: var(--sc-fail); }
  .run-row .detail { font-family: var(--sc-mono); font-size: 0.88em; color: var(--sc-muted); margin-left: 1.2em; white-space: pre-wrap; word-break: break-word; }
  .result { margin-top: 6px; border: 1px solid var(--sc-border); border-radius: 6px; padding: 18px 20px; background: var(--sc-panel); max-width: 460px; }
  .result .big { font-size: 2em; }
  .result .elapsed { font-family: var(--sc-mono); font-size: 1.3em; margin-bottom: 12px; }
  .result dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
  .result dt { color: var(--sc-muted); }
  .result dd { margin: 0; }
  .result .why { font-size: 0.85em; margin-top: 12px; }
</style>
</head>
<body>
<div id="app"></div>
<script nonce="${security.nonce}">
(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage: function () {} };
  let state = ${scriptJson(state)};
  let busy = false;
  const app = document.getElementById('app');

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inline(s) {
    return esc(s)
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  }
  function stars(n) { n = Math.max(0, Math.min(5, n)); return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function fmt(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  function timingStars(ms) {
    const min = ms / 60000, th = state.thresholds;
    if (min <= th.five) return 5; if (min <= th.four) return 4;
    if (min <= th.three) return 3; if (min <= th.two) return 2; return 1;
  }
  function cap() {
    let c = 5;
    Object.keys(state.revealed).forEach(function (k) { c = Math.min(c, state.caps[k]); });
    return c;
  }
  function nextDrop(ms) {
    const min = ms / 60000, th = state.thresholds;
    const tiers = [th.five, th.four, th.three, th.two];
    for (let i = 0; i < tiers.length; i++) { if (min <= tiers[i]) return tiers[i]; }
    return undefined;
  }

  const ASSIST = [
    ['pattern', 'Reveal Pattern', 'Pattern'],
    ['hint', 'Show Hint', 'Hint'],
    ['approach', 'Show Approach', 'Approach']
  ];

  function renderClock() {
    const el = document.getElementById('clock');
    if (!el || state.result) return;
    const ms = Date.now() - state.startedAt;
    const max = Math.min(timingStars(ms), cap());
    const drop = nextDrop(ms);
    const capped = cap() < timingStars(ms);
    let note;
    if (capped) note = 'Capped by assistance';
    else if (drop !== undefined) note = 'Next drop at ' + drop + ':00';
    else note = 'No time limit — a correct solve still counts';
    el.innerHTML =
      '<div class="time">' + fmt(ms) + '</div>' +
      '<div class="max">Max possible <span class="stars">' + stars(max) + '</span></div>' +
      '<div class="note muted">' + esc(note) + '</div>';
  }

  function renderRun() {
    const run = state.lastRun;
    if (!run) return '';
    const s = run.summary;
    const title = run.kind === 'submit' ? 'Submission' : 'Test run';
    if (s.setupError) {
      return '<div class="run"><div class="run-head"><span>' + title + '</span><span class="bad">Could not run</span></div>' +
        '<div class="run-row"><span class="detail">' + esc(s.setupError) + '</span></div></div>';
    }
    let html = '<div class="run"><div class="run-head"><span>' + title + '</span><span class="' +
      (s.allPassed ? 'ok' : 'bad') + '">' + s.passed + ' / ' + s.total + ' passed</span></div>';
    s.results.forEach(function (r) {
      html += '<div class="run-row"><span class="mark ' + (r.passed ? 'ok">✓' : 'bad">✗') + '</span>' + esc(r.label);
      if (!r.passed && !r.hidden) {
        if (r.error) html += '<div class="detail">' + esc(r.error) + '</div>';
        else html += '<div class="detail">expected ' + esc(r.expected) + '\\nreceived ' + esc(r.received) + '</div>';
      } else if (!r.passed && r.error) {
        html += '<div class="detail">' + esc(r.error) + '</div>';
      }
      html += '</div>';
    });
    if (s.logs && s.logs.length) {
      html += '<div class="run-row"><span class="muted">console</span><div class="detail">' + esc(s.logs.join('\\n')) + '</div></div>';
    }
    if (run.kind === 'submit' && !s.allPassed) {
      html += '<div class="run-row muted">Not scored — every test must pass. Keep going, the clock only affects stars.</div>';
    }
    return html + '</div>';
  }

  function renderResult() {
    const r = state.result;
    const c = state.challenge;
    let why = '';
    if (r.cap < r.rawTimingStars) why = 'Time earned ' + stars(r.rawTimingStars) + ', capped at ' + r.cap + ' by assistance.';
    return '<h1>' + esc(c.title) + '</h1>' +
      '<div class="result">' +
      '<div class="big stars" aria-label="' + r.stars + ' of 5 stars">' + r.starsText + '</div>' +
      '<div class="elapsed">' + esc(r.elapsedText) + '</div>' +
      '<dl>' +
      '<dt>Correctness</dt><dd class="ok">' + esc(r.correctness) + '</dd>' +
      '<dt>Time Complexity</dt><dd>' + esc(r.timeComplexity) + '</dd>' +
      '<dt>Space Complexity</dt><dd>' + esc(r.spaceComplexity) + '</dd>' +
      '<dt>Pattern</dt><dd>' + esc(r.pattern) + '</dd>' +
      '<dt>Assistance Used</dt><dd>' + esc(r.assistanceUsed.length ? r.assistanceUsed.join(', ') : 'None') + '</dd>' +
      '<dt>Submissions</dt><dd>' + r.submissions + '</dd>' +
      '</dl>' +
      (why ? '<div class="why muted">' + esc(why) + '</div>' : '') +
      '<div class="muted why">Complexity is the expected target for this problem, not measured from your code.</div>' +
      '</div>' +
      '<div class="actions">' +
      '<button data-action="newChallenge">Next challenge</button>' +
      '<button class="secondary" data-action="stats">View stats</button>' +
      '<button class="secondary" data-action="close">Back to work</button>' +
      '</div>';
  }

  function render() {
    if (state.result) { app.innerHTML = renderResult(); return; }
    const c = state.challenge;
    let html = '<div class="top"><div><h1>' + esc(c.title) + '</h1>' +
      '<div class="chips"><span class="chip ' + esc(c.difficultyKey) + '">' + esc(c.difficulty) + '</span>' +
      '<span class="chip">' + esc(c.category) + '</span></div></div>' +
      '<div class="clock" id="clock" aria-live="off"></div></div>';

    html += '<div class="desc">' + inline(c.description) + '</div>';

    html += '<h2>Examples</h2>';
    c.examples.forEach(function (ex) {
      html += '<div class="example"><pre>Input:  ' + esc(ex.input) + '\\nOutput: ' + esc(ex.output) +
        (ex.explanation ? '\\n<span class="muted">' + esc(ex.explanation) + '</span>' : '') + '</pre></div>';
    });

    if (c.constraints.length) {
      html += '<h2>Constraints</h2><ul class="constraints">' +
        c.constraints.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>';
    }

    html += '<h2>Tests</h2><div class="tests">' +
      c.visibleTests.map(function (t) { return '<div>' + esc(t.call) + ' <span class="muted">→</span> ' + esc(t.expected) + '</div>'; }).join('') +
      (c.hiddenTestCount ? '<div class="muted">+ ' + c.hiddenTestCount + ' hidden test' + (c.hiddenTestCount === 1 ? '' : 's') + ' on Submit</div>' : '') +
      '</div>';

    html += '<h2>Assistance</h2><div class="assist">';
    ASSIST.forEach(function (a) {
      const text = state.revealed[a[0]];
      if (text !== undefined) {
        html += '<div class="reveal"><b>' + a[2] + ':</b> ' + inline(text) + '</div>';
      } else {
        html += '<div class="assist-row"><button class="secondary" data-action="assist" data-kind="' + a[0] + '">' + a[1] +
          '</button><span class="cost muted">max ' + stars(state.caps[a[0]]) + '</span></div>';
      }
    });
    html += '</div>';

    html += '<div class="actions">' +
      '<button data-action="run"' + (busy ? ' disabled' : '') + '>Run Tests</button>' +
      '<button data-action="submit"' + (busy ? ' disabled' : '') + '>Submit</button>' +
      '<button class="secondary" data-action="openEditor">Open solution file</button>' +
      '<span class="spacer"></span>' +
      '<button class="link" data-action="resetCode">Reset code</button>' +
      '<button class="link" data-action="skip">Skip challenge</button>' +
      '</div>';

    html += renderRun();
    app.innerHTML = html;
    renderClock();
  }

  app.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.getAttribute('data-action');
    if (action === 'run' || action === 'submit') { busy = true; render(); }
    vscode.postMessage({ type: action, kind: button.getAttribute('data-kind') || undefined });
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg && msg.type === 'state') { state = msg.state; busy = false; render(); }
    if (msg && msg.type === 'idle') { busy = false; render(); }
  });

  render();
  setInterval(renderClock, 1000);
})();
</script>
</body>
</html>`;
}

export function renderStatsHtml(stats: ChallengeStats, security: WebviewSecurity): string {
  const avg = stats.averageSolveMs === undefined ? '—' : formatElapsed(stats.averageSolveMs);
  const rows = stats.byCategory.length
    ? stats.byCategory
        .map((stat) => {
          const pct = Math.round(stat.score * 100);
          return `<div class="cat">
  <span class="name">${escapeHtml(CATEGORY_LABELS[stat.category])}</span>
  <span class="bar" role="img" aria-label="${pct}%"><span style="width:${pct}%"></span></span>
  <span class="pct">${pct}%</span>
  <span class="count muted">${stat.solved}/${stat.attempts}</span>
</div>`;
        })
        .join('\n')
    : '<p class="muted">No attempts yet. Start a challenge from the Shrimp Check menu.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(security, false)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Challenge Stats</title>
<style>
${BASE_STYLES}
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-top: 14px; max-width: 640px; }
  .tile { background: var(--sc-panel); border: 1px solid var(--sc-border); border-radius: 6px; padding: 10px 12px; }
  .tile .v { font-size: 1.5em; font-variant-numeric: tabular-nums; }
  .tile .k { font-size: 0.8em; color: var(--sc-muted); }
  .cats { max-width: 640px; }
  .cat { display: grid; grid-template-columns: 190px 1fr 46px 50px; gap: 10px; align-items: center; padding: 4px 0; }
  .bar { height: 8px; background: var(--sc-code-bg); border-radius: 4px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--sc-star); }
  .pct { text-align: right; font-variant-numeric: tabular-nums; }
  .count { text-align: right; font-size: 0.85em; }
  .foot { font-size: 0.85em; margin-top: 14px; max-width: 640px; }
</style>
</head>
<body>
<h1>🦐 Challenge Stats</h1>
<div class="tiles">
  <div class="tile"><div class="v">${stats.totalSolved}</div><div class="k">Total solved</div></div>
  <div class="tile"><div class="v">${avg}</div><div class="k">Average solve time</div></div>
  <div class="tile"><div class="v stars">${stats.fiveStarCount}★</div><div class="k">Five-star solves</div></div>
  <div class="tile"><div class="v">${stats.currentStreakDays}</div><div class="k">Day streak</div></div>
</div>
<h2>Performance by category</h2>
<div class="cats">
${rows}
</div>
<p class="foot muted">Category score = average stars ÷ 5 across attempts (skipped challenges count as 0). ${stats.totalAttempts} attempt${stats.totalAttempts === 1 ? '' : 's'} · assistance used: pattern ${stats.assistanceUsage.pattern}, hint ${stats.assistanceUsage.hint}, approach ${stats.assistanceUsage.approach}.</p>
</body>
</html>`;
}

export function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  return nonce;
}
