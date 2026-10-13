#!/usr/bin/env node
// Bumps the extension version (package.json + package-lock.json) without
// committing or tagging, and makes sure CHANGELOG.md has a section for it:
// a "## Unreleased" section is renamed to the new version; otherwise a TODO
// stub is added that release:publish will refuse to ship.
//
//   npm run version:patch   0.0.10 → 0.0.11
//   npm run version:minor   0.0.10 → 0.1.0
//   npm run version:major   0.0.10 → 1.0.0
//
// Tagging happens later, in `npm run release:publish`, only after the
// Marketplace accepts the package.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const level = process.argv[2];

if (!['patch', 'minor', 'major'].includes(level)) {
  console.error('Usage: node scripts/version.cjs <patch|minor|major>');
  process.exit(1);
}

const readVersion = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const before = readVersion();

const npm = spawnSync('npm', ['version', level, '--no-git-tag-version'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (npm.status !== 0) process.exit(npm.status ?? 1);

const after = readVersion();
const changelogPath = path.join(root, 'CHANGELOG.md');
let changelogNote = 'CHANGELOG.md already has a section for this version.';

if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const eol = changelog.includes('\r\n') ? '\r\n' : '\n';
  const heading = new RegExp(`^## \\[?${after.replace(/\./g, '\\.')}\\]?[ \\t\\r]*$`, 'm');

  const unreleased = /^## \[?Unreleased\]?[ \t\r]*$/im;

  if (!heading.test(changelog) && unreleased.test(changelog)) {
    fs.writeFileSync(changelogPath, changelog.replace(unreleased, `## ${after}`));
    changelogNote = `Renamed "## Unreleased" to "## ${after}" in CHANGELOG.md.`;
  } else if (!heading.test(changelog)) {
    const stub = `## ${after}${eol}${eol}- TODO: describe this release${eol}${eol}`;
    const firstSection = changelog.search(/^## /m);
    const updated =
      firstSection === -1 ? `${changelog.trimEnd()}${eol}${eol}${stub}` : changelog.slice(0, firstSection) + stub + changelog.slice(firstSection);
    fs.writeFileSync(changelogPath, updated);
    changelogNote = `Added a "## ${after}" stub to CHANGELOG.md. Replace the TODO line; release:publish refuses to ship with it.`;
  }
}

console.log(`
🦐 Shrimp Check ${before} → ${after}

${changelogNote}

Next:
  git add package.json package-lock.json CHANGELOG.md
  git commit -m "Release Shrimp Check v${after}"
  git push
  git status --short          # should print nothing

  npm run release:publish     # or release:check for a dry run
`);
