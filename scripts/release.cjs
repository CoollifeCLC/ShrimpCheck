#!/usr/bin/env node
// Resumable one-command release for Shrimp Check.
//
//   npm run release:check     preflight + test + package; reads remote state, changes nothing remote
//   npm run release:publish   the same, then:
//                               1. push tag v<version>
//                               2. GitHub draft release with the .vsix attached
//                               3. verify the draft asset (download + sha256)
//                               4. publish to the VS Code Marketplace
//                               5. flip the GitHub release from draft to published (--latest)
//
// Re-running after ANY failure resumes the same version: every step first reads
// remote state (Marketplace, tag, GitHub release) and skips what is already done.
// Nothing is bumped, rebuilt after the Marketplace has the version, or re-tagged.
//
// Network failures: transient errors (DNS, reset, timeout, HTTP 5xx) are retried
// up to 4 attempts (waits 2s, 5s, 10s). Steps that are not naturally idempotent
// (creating the draft, Marketplace publish) re-read remote state before each
// retry, so a retry never duplicates or changes what is being released.
// Auth/permission errors are never retried.
//
// Marketplace auth: set VSCE_PAT for this shell, or run `npx vsce login <publisher>` once.
// GitHub auth: `gh auth login` once (the GitHub CLI must be installed).

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const isWindows = process.platform === 'win32';
const RELEASE_BRANCH = 'main';
const RETRY_DELAYS_MS = (process.env.SHRIMP_RELEASE_RETRY_DELAYS_MS || '2000,5000,10000').split(',').map(Number);
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const extensionId = `${pkg.publisher}.${pkg.name}`;
const vsixName = `${pkg.name}-${version}.vsix`;
const vsixPath = path.join('dist', vsixName);
const vsixAbs = path.join(root, vsixPath);

// ── Process helpers ───────────────────────────────────────────────────────

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    shell: options.shell ?? false,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) {
    return { status: -1, stdout: '', stderr: String(result.error.message || result.error), missing: result.error.code === 'ENOENT' };
  }
  return { status: result.status, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);
// npx is a .cmd shim on Windows, so it needs the shell there (args contain no spaces or quotes).
const npx = (args, options = {}) => run('npx', ['--no-install', ...args], { shell: isWindows, ...options });
const npm = (...args) => run('npm', args, { inherit: true, shell: isWindows });

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function step(label) {
  process.stdout.write(`• ${label} … `);
}
function ok(detail = '') {
  console.log(`ok${detail ? ` (${detail})` : ''}`);
}
function skip(detail) {
  console.log(`skip (${detail})`);
}
function fail(message, hint) {
  console.log('FAILED');
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint.split('\n').join('\n  ')}`);
  console.error('');
  process.exit(1);
}
const output = (r) => [r.stdout, r.stderr].filter(Boolean).join('\n');
const tail = (text, n = 12) => text.split(/\r?\n/).slice(-n).join('\n');

// ── Failure classification ────────────────────────────────────────────────

const NON_RETRYABLE =
  /\b(?:401|403)\b|unauthori[sz]ed|forbidden|authentication failed|not logged in|gh auth login|personal access token|\bPAT\b|token[^\n]*(?:invalid|expired)|insufficient (?:scope|permission)|permission denied|repository not found|could not resolve to a repository|unknown (?:command|flag)|usage:/i;
const TRANSIENT =
  /could not resolve host|no such host|temporary failure in name resolution|name or service not known|getaddrinfo|\b(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_[A-Z_]+)\b|connection (?:reset|refused|timed out|was reset|closed)|connect[^\n]*timed out|operation timed out|i\/o timeout|network is unreachable|tls handshake timeout|ssl_error_syscall|schannel|openssl ssl_(?:read|connect)|gnutls|socket hang up|unexpected eof|early eof|unexpected disconnect|remote end hung up|rpc failed|http2[^\n]*(?:lost|stream)|failed to connect to|error connecting to|server closed the connection|\bHTTP (?:408|429|500|502|503|504)\b|returned error: (?:408|429|500|502|503|504)|status code (?:408|429|500|502|503|504)|\b(?:502|503|504) (?:bad gateway|service unavailable|gateway time-?out)\b|fetch failed|request timed out|timed out after/i;

function isTransient(result) {
  const text = output(result);
  if (NON_RETRYABLE.test(text)) return false;
  return TRANSIENT.test(text);
}

/**
 * Runs an operation up to MAX_ATTEMPTS times while it fails transiently.
 * `attempt()` returns a result object; `{ done: true }` ends the loop early.
 * `beforeRetry()` (optional) re-reads remote state and may return
 * `{ done: true }` when the previous attempt actually landed.
 */
function withRetries(label, attempt, { beforeRetry } = {}) {
  let last;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    last = attempt(i);
    if (last.status === 0 || last.done) return last;
    if (!isTransient(last) || i === MAX_ATTEMPTS) return last;
    const wait = RETRY_DELAYS_MS[i - 1];
    console.log(`\n    ↻ ${label}: transient network failure (attempt ${i}/${MAX_ATTEMPTS}), retrying in ${wait / 1000}s`);
    console.log(`      ${tail(output(last), 2).replace(/\n/g, '\n      ')}`);
    sleep(wait);
    if (beforeRetry) {
      const settled = beforeRetry();
      if (settled && settled.done) return settled;
    }
  }
  return last;
}

// ── Remote state (all read-only) ──────────────────────────────────────────

function githubRepo() {
  if (process.env.SHRIMP_RELEASE_GITHUB_REPO) return process.env.SHRIMP_RELEASE_GITHUB_REPO; // tests only
  const url = git('remote', 'get-url', 'origin').stdout;
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!match) fail(`origin is not a GitHub repository: ${url || '(none)'}`);
  return `${match[1]}/${match[2]}`;
}

/** Marketplace: does the version exist? Returns true/false. */
function marketplaceHasVersion() {
  const r = withRetries('read Marketplace versions', () => npx(['vsce', 'show', extensionId, '--json']));
  if (r.status !== 0) {
    if (/not found|doesn't exist|does not exist/i.test(output(r))) return false;
    fail(`Could not read ${extensionId} from the Marketplace.`, tail(output(r)));
  }
  let info;
  try {
    info = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
  } catch {
    fail('vsce show returned unexpected output.', tail(r.stdout));
  }
  const versions = Array.isArray(info.versions) ? info.versions.map((v) => v.version) : [];
  return versions.includes(version);
}

/** Commit the remote tag points at, or null when the tag is not on origin. */
function remoteTagCommit() {
  const r = withRetries('read remote tag', () => git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`));
  if (r.status !== 0) fail(`Could not read tags from origin.`, tail(output(r)));
  if (!r.stdout) return null;
  const lines = r.stdout.split(/\r?\n/).map((l) => l.split(/\s+/));
  const peeled = lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`);
  const direct = lines.find(([, ref]) => ref === `refs/tags/${tag}`);
  return (peeled || direct)[0];
}

/** GitHub release for the tag: null, or { isDraft, assets: [{name, size, digest}], url }. */
function githubRelease(repo) {
  const view = () => gh('release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,isPrerelease,assets,url');
  const r = withRetries('read GitHub release', view);
  if (r.status !== 0) {
    if (/release not found|not found/i.test(output(r)) && !isTransient(r)) return null;
    fail(`Could not read the GitHub release for ${tag}.`, tail(output(r)));
  }
  try {
    return JSON.parse(r.stdout);
  } catch {
    fail('gh release view returned unexpected output.', tail(r.stdout));
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function recoveryCommands(repo) {
  return [
    `Check it:    gh release view ${tag} --repo ${repo} --json tagName,isDraft,isPrerelease,assets,url`,
    `Publish it:  gh release edit ${tag} --repo ${repo} --draft=false --latest`,
    `Or re-run:   npm run release:publish   (resumes; never re-publishes or re-tags)`
  ].join('\n');
}

// ── Start ─────────────────────────────────────────────────────────────────

console.log(`\n🦐 ${checkOnly ? 'Checking' : 'Releasing'} ${pkg.displayName} ${tag}\n`);

step('GitHub CLI available and signed in');
const ghVersion = gh('--version');
if (ghVersion.missing || ghVersion.status !== 0) fail('The GitHub CLI (gh) is not installed or not on PATH.', 'Install it from https://cli.github.com, then run: gh auth login');
const auth = withRetries('check gh auth', () => gh('auth', 'status', '--hostname', 'github.com'));
if (auth.status !== 0) fail('gh is not signed in to github.com.', `${tail(output(auth), 4)}\n\nRun: gh auth login`);
ok();

const repo = githubRepo();

// ── Git state ─────────────────────────────────────────────────────────────
step('on release branch');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
if (branch !== RELEASE_BRANCH) fail(`On branch "${branch}", expected "${RELEASE_BRANCH}".`, `git switch ${RELEASE_BRANCH}`);
ok(branch);

step('working tree clean');
const dirty = git('status', '--porcelain').stdout;
if (dirty) fail('Uncommitted changes:', `${dirty}\n\nCommit and push them first.`);
ok();

step('in sync with origin');
const fetch = withRetries('git fetch', () => git('fetch', '--quiet', 'origin', RELEASE_BRANCH));
if (fetch.status !== 0) fail('git fetch failed.', tail(output(fetch)));
const [ahead, behind] = git('rev-list', '--left-right', '--count', `HEAD...origin/${RELEASE_BRANCH}`).stdout.split(/\s+/).map(Number);
if (ahead > 0) fail(`Local ${RELEASE_BRANCH} is ${ahead} commit(s) ahead of origin.`, 'git push');
if (behind > 0) fail(`Local ${RELEASE_BRANCH} is ${behind} commit(s) behind origin.`, 'git pull');
ok();

const head = git('rev-parse', 'HEAD').stdout;

// ── Remote release state ──────────────────────────────────────────────────
step(`release state of ${tag}`);
const localTag = git('rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`);
const localTagCommit = localTag.status === 0 ? localTag.stdout : null;
const remoteTag = remoteTagCommit();
const release = githubRelease(repo);
const onMarketplace = marketplaceHasVersion();

for (const [where, commit] of [['local tag', localTagCommit], ['tag on origin', remoteTag]]) {
  if (commit && commit !== head) {
    fail(
      `${where} ${tag} points at ${commit.slice(0, 8)}, but HEAD is ${head.slice(0, 8)}.`,
      `This version was started from another commit. Check out that commit to resume it,\nor bump to a new version: npm run version:patch`
    );
  }
}
if (release && release.isPrerelease) fail(`The GitHub release for ${tag} is marked as a prerelease.`, 'Fix it on GitHub or delete it, then re-run.');

const state = {
  tag: remoteTag ? 'pushed' : localTagCommit ? 'local only' : 'none',
  github: release ? (release.isDraft ? 'draft' : 'published') : 'none',
  marketplace: onMarketplace ? 'published' : 'not published'
};
ok(`tag ${state.tag}, GitHub release ${state.github}, Marketplace ${state.marketplace}`);

if (remoteTag && release && !release.isDraft && onMarketplace) {
  const asset = (release.assets || []).find((a) => a.name === vsixName);
  console.log(`\n✓ ${tag} is already fully released${asset ? '' : ' (note: the GitHub release has no .vsix attached)'}. Nothing to do.`);
  console.log(`  ${release.url}\n`);
  process.exit(0);
}

const resuming = Boolean(remoteTag || release || onMarketplace || localTagCommit);
if (resuming) console.log(`  ↪ resuming ${tag}: completed steps are skipped, nothing is re-published or re-tagged.`);

// ── Changelog ─────────────────────────────────────────────────────────────
step('CHANGELOG entry');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
const headingMatch = changelog.match(new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?[ \\t]*$`, 'm'));
if (!headingMatch) fail(`CHANGELOG.md has no "## ${version}" section.`, 'Add one, commit, push, and re-run.');
const sectionStart = headingMatch.index + headingMatch[0].length;
const nextHeading = changelog.slice(sectionStart).search(/^## /m);
const releaseNotes = changelog.slice(sectionStart, nextHeading === -1 ? undefined : sectionStart + nextHeading).trim();
if (!releaseNotes) fail(`The "## ${version}" changelog section is empty.`);
if (/\bTODO\b/.test(releaseNotes)) fail(`The "## ${version}" changelog section still has a TODO.`);
ok();

// ── Build, test, package ──────────────────────────────────────────────────
// Once the Marketplace has this version, the shipped .vsix is final: never
// rebuild it, only reuse the exact file that was published.
if (onMarketplace) {
  step('tests + package');
  skip('Marketplace already has this version');
  if (!fs.existsSync(vsixAbs) && !(release && (release.assets || []).some((a) => a.name === vsixName))) {
    fail(
      `${vsixPath} is missing, and the Marketplace already has ${version}.`,
      `The published package cannot be rebuilt byte-for-byte. If you still have it, put it at ${vsixPath} and re-run.`
    );
  }
} else {
  console.log('• compile + tests');
  if (npm('test').status !== 0) fail('Tests failed.');

  step('build left tracked files untouched');
  const afterBuild = git('status', '--porcelain').stdout;
  if (afterBuild) {
    fail(
      'The build modified tracked files:',
      `${afterBuild}\n\nIf these are under out/, stop tracking build output once:\n  git rm -r --cached out\n  git commit -m "Stop tracking build output"\n  git push`
    );
  }
  ok();

  console.log(`• package ${vsixPath}`);
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  if (npx(['vsce', 'package', '--out', vsixPath], { inherit: true }).status !== 0) fail('vsce package failed.');
}

if (checkOnly) {
  console.log(`\n✓ ${tag} is ready. Publish with: npm run release:publish\n`);
  process.exit(0);
}

// ── 1. Tag ────────────────────────────────────────────────────────────────
step(`tag ${tag}`);
if (remoteTag) {
  skip('already on origin');
} else {
  if (!localTagCommit) {
    const created = git('tag', '-a', tag, '-m', `${pkg.displayName} ${tag}`);
    if (created.status !== 0) fail(`Could not create tag ${tag}.`, created.stderr);
  }
  // Pushing the same tag object again is a no-op, so retrying is safe.
  const pushed = withRetries(`push ${tag}`, () => git('push', 'origin', `refs/tags/${tag}`));
  if (pushed.status !== 0) {
    fail(
      `Could not push ${tag}. Nothing has been published.`,
      `${tail(output(pushed), 4)}\n\nRe-run when the network is back: npm run release:publish`
    );
  }
  ok('pushed');
}

// ── 2. GitHub draft release with the .vsix ────────────────────────────────
const notesFile = path.join(os.tmpdir(), `shrimp-check-${tag}-notes.md`);
fs.writeFileSync(notesFile, `${releaseNotes}\n`);

let current = release;
step('GitHub draft release');
if (!current) {
  const create = () =>
    gh('release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', `${pkg.displayName} ${tag}`, '--notes-file', notesFile, `${vsixAbs}#${vsixName}`);
  // Creating a release is not idempotent: before each retry, check whether the
  // previous attempt landed, so a retry never makes a second draft.
  const created = withRetries('create draft release', create, {
    beforeRetry: () => {
      const seen = githubRelease(repo);
      return seen ? { status: 0, done: true } : null;
    }
  });
  if (created.status !== 0 && !created.done) {
    fail(`Could not create the GitHub draft release. Nothing has been published.`, `${tail(output(created), 4)}\n\nRe-run: npm run release:publish`);
  }
  current = githubRelease(repo);
  if (!current) fail('GitHub did not return the new draft release.', `Re-run: npm run release:publish`);
  ok('created');
} else {
  skip(current.isDraft ? 'draft exists' : 'already published');
}

// Make sure the release carries exactly the package that will be (or was) published.
const localSha = fs.existsSync(vsixAbs) ? sha256(vsixAbs) : null;
step(`release asset ${vsixName}`);
{
  const asset = (current.assets || []).find((a) => a.name === vsixName);
  const remoteSha = asset && typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/, '').toLowerCase() : null;
  const matches = asset && localSha && (!remoteSha || remoteSha === localSha);
  if (matches || (asset && !localSha)) {
    skip('already attached');
  } else if (!localSha) {
    fail(`${vsixPath} is missing and the release has no ${vsixName}.`);
  } else if (!current.isDraft && onMarketplace) {
    fail(`The published GitHub release has a different ${vsixName}.`, 'It is public already; inspect it on GitHub before changing anything.');
  } else {
    // --clobber makes the upload idempotent: same name, same bytes.
    const uploaded = withRetries('upload asset', () => gh('release', 'upload', tag, `${vsixAbs}#${vsixName}`, '--repo', repo, '--clobber'));
    if (uploaded.status !== 0) fail('Could not attach the .vsix to the draft release.', `${tail(output(uploaded), 4)}\n\nRe-run: npm run release:publish`);
    ok('uploaded');
  }
}

// ── 3. Verify the asset GitHub actually stores ────────────────────────────
step('verify release asset (download + sha256)');
if (!localSha) {
  skip('no local package to compare; Marketplace already has it');
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shrimp-release-verify-'));
  try {
    const dl = withRetries('download asset', () =>
      gh('release', 'download', tag, '--repo', repo, '--pattern', vsixName, '--dir', dir, '--clobber')
    );
    if (dl.status !== 0) fail('Could not download the release asset to verify it.', `${tail(output(dl), 4)}\n\nRe-run: npm run release:publish`);
    const remoteSha = sha256(path.join(dir, vsixName));
    if (remoteSha !== localSha) fail(`The uploaded ${vsixName} does not match ${vsixPath}.`, `local ${localSha}\nremote ${remoteSha}`);
    ok(localSha.slice(0, 12));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── 4. Marketplace ────────────────────────────────────────────────────────
step('publish to VS Code Marketplace');
if (onMarketplace) {
  skip('already published');
} else {
  console.log('');
  // Not idempotent in general, but the Marketplace refuses a duplicate version,
  // and before each retry we re-read the Marketplace: a publish whose response
  // was lost is detected instead of repeated.
  const published = withRetries(
    'vsce publish',
    () => {
      const r = npx(['vsce', 'publish', '--packagePath', vsixPath]);
      if (r.stdout) console.log(r.stdout);
      if (r.stderr) console.error(r.stderr);
      if (r.status !== 0 && /already exists/i.test(output(r))) return { status: 0, done: true };
      return r;
    },
    { beforeRetry: () => (marketplaceHasVersion() ? { status: 0, done: true } : null) }
  );
  if (published.status !== 0 && !published.done) {
    fail(
      `vsce publish failed. The GitHub release is still a draft (not public) and the tag is pushed.`,
      `${tail(output(published), 4)}\n\nIf this is an auth error: set VSCE_PAT, or run npx vsce login ${pkg.publisher}\nThen re-run: npm run release:publish   (it resumes at this step)`
    );
  }
  console.log('  ✓ Marketplace has the new version');
}

// ── 5. Publish the GitHub release ─────────────────────────────────────────
step('publish GitHub release');
if (current && !current.isDraft) {
  skip('already published');
} else {
  // Setting draft=false is idempotent (same end state), and each retry first
  // checks whether the previous attempt already took effect.
  const flipped = withRetries('publish GitHub release', () => gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--latest'), {
    beforeRetry: () => {
      const seen = githubRelease(repo);
      return seen && !seen.isDraft ? { status: 0, done: true } : null;
    }
  });
  if (flipped.status !== 0 && !flipped.done) {
    fail(
      `The Marketplace has ${version}, but the GitHub release is still a draft.`,
      `${tail(output(flipped), 4)}\n\n${recoveryCommands(repo)}`
    );
  }
  ok();
}

step('verify GitHub release is public');
const final = githubRelease(repo);
if (!final || final.isDraft || final.isPrerelease) {
  fail(`GitHub does not report ${tag} as a published release yet.`, recoveryCommands(repo));
}
ok();

console.log(`\n✓ ${pkg.displayName} ${tag} released.`);
console.log(`  Marketplace: https://marketplace.visualstudio.com/items?itemName=${extensionId}`);
console.log(`  GitHub:      ${final.url}\n`);
