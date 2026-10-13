# Releasing Shrimp Check

```bash
npm run version:patch          # or version:minor / version:major
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release Shrimp Check v0.0.11"
git push
git status --short             # should print nothing

npm run release:publish
```

## What each step does

**`npm run version:patch`** (`scripts/version.cjs`)
- Bumps `package.json` and `package-lock.json` with `npm version --no-git-tag-version`.
  It does not commit or tag.
- If CHANGELOG.md has a `## Unreleased` section, renames it to `## <new version>`.
  Otherwise it adds a `## <new version>` stub with a TODO line.
- Prints the exact git commands for the next step.

Write changelog notes under `## Unreleased` as you work, and the bump picks them up.

**`npm run release:check`** is a dry run: every check below plus packaging, without publishing.

**`npm run release:publish`** (`scripts/release.cjs`) stops at the first failure:

1. You are on `main`.
2. `git status --porcelain` is empty.
3. `main` matches `origin/main` after a fetch, so you have pushed and have nothing to pull.
4. `v<version>` does not already exist on origin (the release hasn't shipped yet).
5. CHANGELOG.md has a non-empty `## <version>` section with no `TODO`.
6. `npm test` passes (compile + full test suite).
7. The build left no tracked files modified.
8. `vsce package --out dist/shrimp-check-<version>.vsix`.
9. `vsce publish --packagePath <that vsix>`. This publishes the exact file that was tested.
10. Creates the annotated tag `v<version>` and pushes it.

If publishing fails, nothing is tagged, so you can fix the problem and re-run. If publishing
succeeds but the tag push fails, the script prints the `git push origin v<version>` retry command.

## Marketplace auth

`vsce` needs a Personal Access Token for publisher `contractos`, scoped to Marketplace → Manage.
Use either:

- `npx vsce login contractos` once (vsce stores the token), or
- `$env:VSCE_PAT = "<token>"` (PowerShell) / `export VSCE_PAT=<token>` for the session.

## Build output

`out/` and `dist/` are build output and are git-ignored. `out/` used to be committed. If
`release` reports modified files under `out/`, stop tracking it once:

```bash
git rm -r --cached out
git commit -m "Stop tracking build output"
git push
```
