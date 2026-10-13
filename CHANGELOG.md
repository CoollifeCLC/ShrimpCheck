# Changelog

All notable changes to the Shrimp Check extension will be documented in this file.

## Unreleased

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
