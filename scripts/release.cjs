#!/usr/bin/env node
// One-command release for Shrimp Check.
//
//   npm run release:check     preflight + test + package, no publish
//   npm run release:publish   the same, then publish to the VS Marketplace and push the git tag
//
// Preflight refuses to continue unless:
//   - you are on main, the working tree is clean, and main matches origin/main
//   - v<version> has not been tagged/released yet
//   - CHANGELOG.md has a real "## <version>" section (no TODO)
//   - compile + tests pass, and the build leaves no tracked files modified
//
// Marketplace auth: set VSCE_PAT for this shell, or run `npx vsce login contractos` once
// (vsce stores the token for you).

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const isWindows = process.platform === 'win32';
const RELEASE_BRANCH = 'main';

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;
const vsixPath = path.join('dist', `${pkg.name}-${version}.vsix`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    shell: options.shell ?? false
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim()
  };
}

const git = (...args) => run('git', args);
const npx = (...args) => run('npx', ['--no-install', ...args], { inherit: true, shell: isWindows });
const npm = (...args) => run('npm', args, { inherit: true, shell: isWindows });

function step(label) {
  process.stdout.write(`• ${label} … `);
}
function ok(detail = '') {
  console.log(`ok${detail ? ` (${detail})` : ''}`);
}
function fail(message, hint) {
  console.log('FAILED');
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint.split('\n').join('\n  ')}`);
  console.error('');
  process.exit(1);
}

console.log(`\n🦐 ${checkOnly ? 'Checking' : 'Releasing'} ${pkg.displayName} ${tag}\n`);

// ── Git state ──────────────────────────────────────────────────────────────
step('on release branch');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout;
if (branch !== RELEASE_BRANCH) fail(`On branch "${branch}", expected "${RELEASE_BRANCH}".`, `git switch ${RELEASE_BRANCH}`);
ok(branch);

step('working tree clean');
const dirty = git('status', '--porcelain').stdout;
if (dirty) fail('Uncommitted changes:', `${dirty}\n\nCommit and push them first.`);
ok();

step('in sync with origin');
const fetch = git('fetch', '--quiet', 'origin', RELEASE_BRANCH, '--tags');
if (fetch.status !== 0) fail('git fetch failed.', fetch.stderr);
const counts = git('rev-list', '--left-right', '--count', `HEAD...origin/${RELEASE_BRANCH}`).stdout.split(/\s+/).map(Number);
const [ahead, behind] = counts;
if (ahead > 0) fail(`Local ${RELEASE_BRANCH} is ${ahead} commit(s) ahead of origin.`, 'git push');
if (behind > 0) fail(`Local ${RELEASE_BRANCH} is ${behind} commit(s) behind origin.`, 'git pull');
ok();

step(`${tag} not released yet`);
const remoteTag = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`).stdout;
if (remoteTag) fail(`${tag} is already tagged on origin.`, 'Bump first: npm run version:patch');
const localTag = git('rev-parse', '-q', '--verify', `refs/tags/${tag}`);
if (localTag.status === 0 && localTag.stdout !== git('rev-parse', 'HEAD').stdout) {
  fail(`Local tag ${tag} exists on a different commit.`, `Delete it if it is stale: git tag -d ${tag}`);
}
ok();

// ── Changelog ──────────────────────────────────────────────────────────────
step('CHANGELOG entry');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
const headingMatch = changelog.match(new RegExp(`^## \\[?${version.replace(/\./g, '\\.')}\\]?[ \\t\\r]*$`, 'm'));
if (!headingMatch) fail(`CHANGELOG.md has no "## ${version}" section.`, 'Add one, commit, push, and re-run.');
const sectionStart = headingMatch.index + headingMatch[0].length;
const nextHeading = changelog.slice(sectionStart).search(/^## /m);
const section = changelog.slice(sectionStart, nextHeading === -1 ? undefined : sectionStart + nextHeading).trim();
if (!section) fail(`The "## ${version}" changelog section is empty.`);
if (/\bTODO\b/.test(section)) fail(`The "## ${version}" changelog section still has a TODO.`);
ok();

// ── Build & test ───────────────────────────────────────────────────────────
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

// ── Package ────────────────────────────────────────────────────────────────
console.log(`• package ${vsixPath}`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
if (npx('vsce', 'package', '--out', vsixPath).status !== 0) fail('vsce package failed.');

if (checkOnly) {
  console.log(`\n✓ ${tag} is ready. Publish with: npm run release:publish\n`);
  process.exit(0);
}

// ── Publish ────────────────────────────────────────────────────────────────
console.log('• publish to VS Code Marketplace');
if (npx('vsce', 'publish', '--packagePath', vsixPath).status !== 0) {
  fail(
    'vsce publish failed. Nothing was tagged.',
    `If this is an auth error: set VSCE_PAT, or run npx vsce login ${pkg.publisher}`
  );
}

step(`tag ${tag}`);
if (localTag.status !== 0) {
  const created = git('tag', '-a', tag, '-m', `${pkg.displayName} ${tag}`);
  if (created.status !== 0) fail(`Published, but could not create tag ${tag}.`, created.stderr);
}
const pushed = git('push', 'origin', tag);
if (pushed.status !== 0) fail(`Published, but pushing ${tag} failed.`, `Retry: git push origin ${tag}\n${pushed.stderr}`);
ok();

console.log(`\n✓ ${pkg.displayName} ${tag} published.`);
console.log(`  https://marketplace.visualstudio.com/items?itemName=${pkg.publisher}.${pkg.name}\n`);
