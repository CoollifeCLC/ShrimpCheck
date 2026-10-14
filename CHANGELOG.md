# Changelog

All notable changes to the Shrimp Check extension will be documented in this file.

## 0.1.4

### 🚢 Release tooling
- `npm run release:publish` now resumes instead of starting over. Each step checks the Marketplace, the git tag and the GitHub release first and skips what is already done, so a rerun never re-publishes, re-tags or needs a version bump.
- Transient network failures (DNS, connection resets, timeouts, HTTP 5xx) are retried up to 4 times. Steps that are not naturally repeatable re-check remote state before each retry, so a lost response never causes a duplicate. Authentication errors are not retried.
- Each release now also gets a GitHub release with the `.vsix` attached. It is created as a draft, its asset is verified, and it is made public only after the Marketplace accepts the version. If that last step fails, the error shows the exact `gh` commands to finish it.
- The test suite runs its files one at a time, and the runner tests no longer depend on fixed startup timings, so slow Windows machines no longer produce spurious failures.
- No changes to the extension itself.

## 0.1.3

- Same extension as 0.1.1. Published again because the release script failed while pushing the git tag after the Marketplace upload had already succeeded.

## 0.1.2

- Same extension as 0.1.1. Published again because the release script failed while pushing the git tag after the Marketplace upload had already succeeded.

## 0.1.1

### 🛡️ Challenge Mode: safe code runner
- **Fixed:** an infinite loop in a challenge solution could freeze VS Code. Solutions ran inside the extension host, so a loop reached through `await`, `.then()` or `setTimeout` hung it with no timeout, and a loop that allocated memory could exhaust system memory and leave Windows unresponsive.
- Solutions now run in a separate, disposable runner process with a hard wall-clock limit enforced by the extension. Infinite loops, unsettled promises and runaway memory end as a normal result (time limit or memory limit exceeded) instead of hanging the editor.
- Every run gets a time limit per evaluation, a memory cap, and caps on console output and return-value size.
- The runner is shut down after every run, including timeouts, crashes, cancellation and extension shutdown. On Windows its whole process tree is ended with `taskkill /T /F`, and a runner whose editor closes unexpectedly exits on its own.
- Process startup happens off the editor's main thread, so Run and Submit no longer cause a visible hitch.
- Solution code no longer has access to the editor's environment variables or Node.js APIs.
- Run and Submit now process one run at a time; extra clicks while a run is in progress are ignored.
- Added containment tests covering infinite loops (synchronous, after `await`, in `.then()`, in timers), unsettled promises, memory balloons, output limits, cancellation and process-tree cleanup.

## 0.1.0

### 🧠 Challenge Mode
- Added **Challenge Mode**: an optional, fixed-interval coding challenge that runs independently of posture and hydration reminders (off by default).
- A notification offers the challenge; nothing opens and no clock starts until you choose **Start**, so active work is never interrupted.
- Challenge panel with problem statement, examples, constraints, visible tests, live timer, and the current maximum star rating. Solutions are written in a real editor tab and tested in an isolated, time-limited sandbox.
- **Run Tests** (visible tests) and **Submit** (visible + hidden tests). Correctness gates scoring: an incorrect submission is never rated, and the attempt stays open.
- Star scoring by solve time (defaults ≤10 / 15 / 20 / 30 min, configurable). The timer never fails a challenge; a slow correct solve still earns ★.
- **Reveal Pattern** (max ★★★★), **Show Hint** (max ★★★), **Show Approach** (max ★★) cap the rating instead of subtracting.
- 16 original seed challenges across Strings, Arrays, Hash Maps / Sets, Two Pointers, Sliding Window, Stacks, Binary Search, Recursion, Trees, plus optional practical API, Async, and Regex challenges.
- Practice history (stored locally) with stats: total solved, average solve time, five-star count, day streak, and score by category.
- Simple weighted selection that favours challenges you have not seen recently and categories where you score lower.
- **Interview Sprint** preset: core patterns, Easy + Medium, 10-minute five-star threshold, a challenge every 30 minutes. Everything stays editable.
- New commands: Challenge Mode menu, Start Challenge, Resume Challenge, Challenge Stats. Challenge Mode also appears in the quick menu and hover panel.

### 🚢 Release tooling
- `npm run version:patch|minor|major` bumps package.json and the lockfile and turns this "Unreleased" section into the new version.
- `npm run release:check` runs preflight checks, tests, and packaging into `dist/`. `npm run release:publish` does the same, then publishes to the Marketplace and pushes the `v<version>` tag.

## 0.0.10

### 🛠 Correctness & Hygiene
- Fixed cooked timing so `cookedDelayMinutes` starts when warning state begins.
- Made snooze behavior internally consistent with a 5-minute duration, neutral command label, and real snoozed state.
- Updated quick menus to write to the effective settings scope instead of always writing global settings.
- Aligned contributed setting minimums with the supported 1-minute floor used by the extension.
- Added status bar accessibility metadata and narrowed trusted tooltip commands.
- Cleaned VSIX packaging to omit source, tests, docs, sourcemaps, and dev-only metadata.
- Added regression tests for timer transitions, snooze, scoped setting writes, and popup-disabled flow.

## 0.0.9

### 🧹 Release Maintenance
- Reconciled package metadata after the 0.0.9 package version shipped without a changelog entry.

## 0.0.8

### ✨ Major UX Update
- Added 🧠 **live hover panel** with posture stats, streak, and quick actions
- Added ⚡ **quick settings menu** (click status bar to instantly manage timers, snooze, hydration, and settings)
- Added direct action links inside hover panel (no need to open command palette)

### 🎯 Improvements
- Reduced friction for adjusting settings (no CLI/command usage required)
- Improved first-time user experience with clearer interaction flow
- Updated messaging to be more playful and engaging
- Enhanced tooltip formatting and readability

### 🛠 Fixes
- Fixed command registration issues for hydration and timer menus
- Resolved duplicate command/config registration errors during development
- Ensured consistent behavior between development host and installed extension

## 0.0.7

### 🚀 Feature Expansion
- Added hydration settings menu for easier configuration
- Improved command structure and menu accessibility
- Refined posture state transitions and messaging

## 0.0.6

### 🎨 Polish & Stability
- Improved tooltip messaging and status bar feedback
- Refined streak tracking behavior
- Minor UX improvements and internal cleanup

## 0.0.5

### ⚙️ Core Enhancements
- Improved posture reminder flow and timing behavior
- Added better warning → cooked transition handling
- Stability improvements

## 0.0.4
- Added 🍤 Cooked Shrimp Mode when posture warnings are ignored for too long
- Added 🏆 streak tracking for successful posture resets
- Added 💧 optional hydration reminders with a separate customizable timer
- Added interactive posture actions: “I’m up 😅” and “Give me 5 min”
- Improved warning flow with a clearer “Shrimp forming...” escalation state
- Improved status bar and tooltip messaging to reflect streak and posture state

## 0.0.3
- Added custom extension icon and improved marketplace presentation
- Cleaned up extension packaging metadata
- Improved README and marketplace listing quality
- Published marketplace-ready update

## 0.0.2
- Refined branding and polish for the extension
- Improved extension packaging setup and project structure
- Updated repository metadata and supporting files

## 0.0.1
- Initial release of Shrimp Check
- Added randomized posture reminders every 30–45 minutes
- Added status bar posture indicator
- Added warning state before full shrimp mode
- Added reset posture timer command
- Added snooze command
- Added enable/disable support from settings
