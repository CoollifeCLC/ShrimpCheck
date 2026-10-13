# State of Shrimp Check

**As of:** 2 August 2026
**Version in `package.json`:** 0.0.9
**Latest CHANGELOG entry:** 0.0.8 ← *these disagree; see [Issue 1](#1-version-mismatch)*

Internal planning notes. Blunt on purpose. Assumes you know the codebase.

---

## 1. What actually ships today

One TypeScript file, 704 lines, `src/extension.ts`. No modules, no tests, no lint, no CI.
Everything lives in module-level mutable globals and `setTimeout`.

### The product in one paragraph

A status bar item counts down a randomised 30–45 minute window. Two-thirds of the way
through it turns yellow and says you might be a shrimp. If you ignore it long enough it
turns red, says you're cooked, and resets your streak. Clicking the item opens a quick
pick with reset / snooze / timer / hydration / enable toggles. Hovering shows a markdown
panel with state, streak, timer config, and command links. Optionally, a separate
independent timer nags you to drink water.

### Feature inventory

| Feature | Status | Notes |
|---|---|---|
| Randomised posture cycle | Working | `randomBetween(min, max)` minutes |
| 4-state machine (`ok`/`warning`/`recovery`/`cooked`) | Working | See [ARCHITECTURE.md](ARCHITECTURE.md) |
| Status bar item + theme colours | Working | Warning fg, error bg/fg |
| Rich hover tooltip w/ command links | Working | `MarkdownString`, `isTrusted = true` |
| Quick pick menu | Working | 7 entries |
| Timer preset submenu | Working | 3 presets + custom |
| Cooked-delay submenu | Working | 3 presets + custom |
| Hydration reminders | Working | Off by default |
| Custom drink string | Working | Falls back to `"caffeine"` |
| Streak counter | Working | `globalState`, single integer |
| Snooze | Working-ish | See [Issue 2](#2-snooze-says-10-in-one-place-and-5-everywhere-else) |
| Enable/disable toggle | Working | |
| 7 registered commands | Working | All in `contributes.commands` |
| Animation | **None** | Static emoji only |
| Idle / presence detection | **None** | See [Issue 7](#7-no-presence-detection-the-big-one) |
| Persistence across restart | **None** | Streak only |
| Telemetry / analytics | **None** | Deliberate, keep it that way |
| Tests | **None** | |

### Config surface (9 keys, all `shrimpCheck.*`)

| Key | Type | Default | Declared min |
|---|---|---|---|
| `enabled` | boolean | `true` | — |
| `minMinutes` | number | `30` | **30** |
| `maxMinutes` | number | `45` | **45** |
| `warningFraction` | number | `0.66` | 0.1 / max 0.95 |
| `showPopup` | boolean | `true` | — |
| `cookedDelayMinutes` | number | `10` | **10** |
| `hydrationEnabled` | boolean | `false` | — |
| `hydrationMinutes` | number | `45` | **45** |
| `drink` | string | `""` | — |

The bolded minimums are wrong — see [Issue 4](#4-schema-minimums-contradict-the-preset-menus).

### Toolchain

- `tsc` straight to `out/`, `strict: true`, target ES2020, CommonJS
- Packaged with `@vscode/vsce`
- Engine floor `^1.85.0`
- No bundler (fine at this size; revisit if the file count grows)

---

## 2. Bugs and rough edges

Ordered roughly by how much they'd hurt a user. Each has a suggested fix; none are
being applied yet — this is the planning pass.

### 1. Version mismatch

`package.json` is at `0.0.9`. `CHANGELOG.md` stops at `0.0.8`. Either 0.0.9 shipped
undocumented or the version was bumped early.

**Fix:** write the 0.0.9 entry or roll the version back. Then add a release checklist
so this can't drift again.

---

### 2. Snooze says "10" in one place and "5" everywhere else

`package.json` registers the command title as **"Shrimp Check: Snooze 10 Minutes"**.
The implementation (`extension.ts:47–72`) uses `5 * 60 * 1000`, the status text says
"Snoozed for 5 minutes", the toast says 5 minutes, and the quick pick says
"Snooze for 5 minutes".

**Fix:** one source of truth. Make snooze duration a config key
(`shrimpCheck.snoozeMinutes`, default 5) and drop the number from the command title
entirely — command titles can't interpolate config.

---

### 3. `cookedDelayMinutes` does not do what its description says

The setting description reads *"Minutes after the warning state before you become cooked."*

What the code actually does (`startCycle`, lines 154–184):

```
warningTimeout  fires at  totalMs * warningFraction
cookedTimeout   fires at  totalMs + cookedMs
```

Both are scheduled from cycle start. So with the defaults — a 30–45 min cycle,
`warningFraction 0.66`, `cookedDelayMinutes 10` — a 36-minute cycle puts the warning at
**~24 min** and cooked at **~46 min**. That's a 22-minute gap, not the 10 the user asked
for. The gap also silently grows as `maxMinutes` grows, which is exactly backwards:
longer deep-work cycles get *more* grace, not less.

**Fix:** schedule the cooked timer *relative to the warning firing*, not to cycle start.
That falls out naturally from the scheduler refactor in [ARCHITECTURE.md](ARCHITECTURE.md).

---

### 4. Schema minimums contradict the preset menus

Three instances of the same bug — `package.json` declares a `minimum` that the extension's
own quick-pick presets violate:

| Setting | Declared `minimum` | Preset that violates it |
|---|---|---|
| `minMinutes` | 30 | "Quick check: 15-25 minutes" writes **15** |
| `maxMinutes` | 45 | "Quick check: 15-25 minutes" writes **25** |
| `cookedDelayMinutes` | 10 | "5 minutes" writes **5** |
| `hydrationMinutes` | 45 | "Set hydration to 15 / 30 minutes" |

The values are written via `config.update()` (which doesn't validate), so they *work* —
but the Settings UI renders them with a validation error, and a user who opens Settings
sees red squiggles on a config the extension itself created.

**Fix:** drop the minimums to `1`, or to whatever the real floor is (1 minute). The
`Math.max(1, …)` clamps in the code are already the de-facto floor.

---

### 5. Any config change nukes the running cycle

`onDidChangeConfiguration` → `refreshFromConfig()` → `clearAllTimers()` → `startCycle()`.

Change your **drink name** and your posture timer restarts from zero. So does toggling
popups, or nudging `warningFraction`. Twenty-nine minutes into a thirty-minute cycle,
one settings tweak and you're back to zero.

Worse, the menu handlers call `refreshFromConfig()` *explicitly* after `config.update()`,
and the listener fires too — so a single menu action can restart the cycle twice.

**Fix:** diff the change. Only restart the posture cycle when a posture-timing key
changed; only restart hydration when a hydration key changed; repaint the status bar for
everything else. `event.affectsConfiguration('shrimpCheck.drink')` already gives you the
granularity. And remove the redundant explicit calls.

---

### 6. Timers are `setTimeout` with no wall-clock anchor

Nothing records *when* the cycle started. Consequences:

- **Sleep/hibernate.** `setTimeout` behaviour across suspend is not guaranteed. Close the
  lid for two hours and the timer state is anyone's guess.
- **No countdown is possible.** You can't show "18 min until warning" in the tooltip
  because nothing knows. This blocks the single most-requested-feeling feature.
- **No progress bar, no animation keyed to progress.** Same root cause.
- **Nothing survives a reload.** `deactivate()` clears timers and persists nothing.

**Fix:** store `cycleStartedAt: number` and compute deadlines from `Date.now()`. Keep a
low-frequency tick (30s) that compares wall clock to deadline instead of trusting the
timeout. This is the prerequisite for basically everything in
[ANIMATION.md](ANIMATION.md) and half of [ROADMAP.md](ROADMAP.md).

---

### 7. No presence detection (the big one)

Shrimp Check has no idea whether you are sitting at the computer. The timer runs while
you're at lunch, in a meeting, or asleep. You come back to "🍤 Cooked" and a reset streak
for the crime of having a life.

For a posture tool this isn't a rough edge, it's a correctness problem: the entire premise
is *"you have been sitting badly for N minutes"* and the extension cannot observe the
"sitting" part.

Cheap proxies already available in the API, no camera or native code required:

- `vscode.window.state.focused` + `onDidChangeWindowState` — is the VS Code window frontmost
- `workspace.onDidChangeTextDocument` — are you typing
- `window.onDidChangeTextEditorSelection` — are you moving the cursor
- `window.onDidChangeActiveTextEditor` — are you navigating

**Fix:** an `ActivityMonitor` that maintains a `lastInteractionAt` timestamp and exposes
`isUserActive()`. Pause the posture clock when idle > ~3 min; resume without penalty.
Detailed in [EXTENDING.md](EXTENDING.md).

---

### 8. Multi-window is broken

Each VS Code window runs its own extension host, so opening three projects gives you
three independent shrimp timers, three status bar items, three popups at three random
times, and three racing writers on the `shrimpCheck.streak` `globalState` key.

`globalState` writes are last-write-wins with no coordination. Streaks will silently
corrupt for anyone who works in more than one window — which is most people.

**Fix:** hard problem, no clean API. Options, worst to best:
1. Accept it and document it. (Current state, undocumented.)
2. Leader election via a lock file in `context.globalStorageUri` with a heartbeat; only
   the leader runs timers and shows notifications.
3. Make the streak *derived* rather than incremented — store an append-only list of
   `{timestamp, outcome}` events and compute the streak on read. Concurrent writes then
   merge instead of clobbering.

Option 3 is cheap, fixes the corruption independently of the duplicate-popup problem, and
also unlocks history/stats. Do that first.

---

### 9. Snooze reuses `cookedTimeout` for its own re-arm

`extension.ts:69` — the 5-minute snooze re-arm is assigned to `cookedTimeout`. It happens
to work (both go through `clearPostureTimers`) but the variable now means two things.
Next person to touch this file will get bitten.

Also: snooze sets the status text but never updates `currentState`, so snoozing while
cooked leaves `currentState === 'cooked'` with a "😌 Snoozed" label. Nothing breaks today,
but the state variable and the UI are lying to each other.

**Fix:** add a real `'snoozed'` state and its own timer handle. Falls out of the scheduler
refactor.

---

### 10. `out/` is committed to git

`.gitignore` lists `dist/`. `tsconfig.json` outputs to `out/`. So `out/extension.js` and
`out/extension.js.map` are tracked. Every build produces a diff.

Separately, `.vscodeignore` is a byte-for-byte copy of `.gitignore` — which means the
published VSIX ships `src/`, `tsconfig.json`, the sourcemap, and the `.gitignore` itself.

**Fix:** add `out/` to `.gitignore`; write a real `.vscodeignore` that excludes `src/`,
`tsconfig.json`, `**/*.map`, `docs/`, and dotfiles.

---

### 11. Accessibility

State is communicated by emoji and colour only. `statusBarItem.accessibilityInformation`
is never set, so a screen reader gets the raw emoji soup. Colour-only state fails for
colour-blind users; the emoji happen to carry the signal, but that's luck.

**Fix:** set `accessibilityInformation = { label: 'Shrimp Check: posture warning, streak 4' }`
on every `setStatus` call. One line in an already-centralised function.

---

### 12. No quiet hours, no do-not-disturb

Modal-ish notification popups fire regardless of whether you're pair programming,
screen-sharing, mid-debug-session, or on a call. There is no way to say "not now, for the
next two hours" short of disabling the extension entirely.

**Fix:** `shrimpCheck.quietHours` (a time range) plus auto-suppression during an active
debug session (`vscode.debug.activeDebugSession`). Warning-state status bar colour still
updates; only the popup is withheld.

---

### 13. Minor

- `tooltip.supportHtml = true` is set but no HTML is used. `isTrusted` is the one that
  matters (for `command:` links). Drop `supportHtml`.
- `getStreak()` reads `extensionContext` — a module global assigned in `activate`. Throws
  if ever called earlier. Fine today, fragile forever.
- Emoji rendering in the status bar varies a lot by platform and font. 🦐 and 🍤 are visually
  near-identical at status-bar size on several Windows font stacks — the two most important
  states are the hardest to tell apart. See [ANIMATION.md](ANIMATION.md) for the custom-icon fix.
- README claims "100+ developers" in a badge. Fine for marketing, but it's hardcoded and
  will age.

---

## 3. What's actually good

Worth writing down so a refactor doesn't destroy it.

- **The hover panel is the product.** Stats + toggles + links in a tooltip, zero clicks,
  no webview, no panel to open. It's genuinely a nicer pattern than most reminder
  extensions and it costs nothing at runtime. Protect this.
- **Randomised intervals.** Non-obvious and correct — a fixed 30-minute chime becomes
  wallpaper within a day. Randomness keeps it noticeable.
- **The escalation ladder** (ok → warning → cooked) with a recovery reward is a sound
  behavioural loop. Two chances before punishment.
- **Tone.** The shrimp bit is the reason anyone installs this. It's a wellness tool that
  doesn't moralise at you. Every future feature should pass the "would this be funny?"
  test before the "would this be useful?" test.
- **Tiny surface.** 9 settings, 7 commands, one status bar item, zero dependencies at
  runtime. Activation cost is near zero. Very easy to keep it that way.

---

## 4. The one-line summary

The concept and the interaction design are ahead of the implementation. The code is a
working prototype in one file with a real timing bug ([Issue 3](#3-cookeddelayminutes-does-not-do-what-its-description-says)),
a real correctness gap ([Issue 7](#7-no-presence-detection-the-big-one)), and no seam to
extend along. Fix the timer core first; everything else in the roadmap is blocked on it.

**Read next:** [ARCHITECTURE.md](ARCHITECTURE.md) → [EXTENDING.md](EXTENDING.md) →
[ANIMATION.md](ANIMATION.md) → [ROADMAP.md](ROADMAP.md)
