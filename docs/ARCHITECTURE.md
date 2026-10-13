# Architecture

Two parts: **how it works now** (accurate to `src/extension.ts` @ 0.0.9) and
**where it should go** (the proposed module split). Nothing here is implemented yet.

---

## Part 1 — Current architecture

### Shape

```
src/extension.ts    704 lines, single file
├── module globals  statusBarItem, 4 timer handles, isEnabled,
│                   currentState, extensionContext
├── activate()      creates status bar, registers 7 commands + config listener
├── cycle control   startCycle / handleRecovery / handleCookedState
├── hydration       startHydrationCycle (fully independent loop)
├── menus           showQuickMenu / showTimerMenu / showCookedDelayMenu / showHydrationMenu
├── rendering       setStatus / createShrimpTooltip
└── helpers         clearPostureTimers / clearAllTimers / randomBetween /
                    getStreak / incrementStreak / resetStreak / getPreferredDrink
```

All state is module-level and mutable. There are no classes, no interfaces beyond
`type ShrimpState`, and no seam between "what state am I in", "when does the next thing
happen", and "what does the status bar say".

### The posture state machine

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
                    ▼                                          │
  activate ──▶  ┌────────┐                                     │
                │   ok   │  status: 🙂 Posture OK               │
                └───┬────┘                                     │
                    │  t = totalMs × warningFraction           │
                    ▼                                          │
                ┌─────────┐                                    │
                │ warning │  status: 🟡 Shrimp forming...       │
                └────┬────┘  popup: "I'm up" / "Give me 5 min"  │
                     │                                         │
        ┌────────────┼─────────────┐                           │
        │            │             │                           │
   "I'm up"     "5 min"      t = totalMs + cookedMs            │
        │            │             │                           │
        ▼            ▼             ▼                           │
  ┌──────────┐  (snooze)      ┌────────┐                       │
  │ recovery │   5 min        │ cooked │  status: 🍤 Cooked     │
  └────┬─────┘      │         └───┬────┘  streak := 0          │
       │            │             │                            │
  streak += 1       │        "I'm up" / "5 min"                 │
  2s delay          │             │                            │
       └────────────┴─────────────┴────────────────────────────┘
                       all paths return to `ok` via startCycle()
```

**Note the two timers are both scheduled from cycle start**, independently — the cooked
timer is *not* chained off the warning timer. That's the source of
[Issue 3](STATE_OF_PROJECT.md#3-cookeddelayminutes-does-not-do-what-its-description-says).

### Timers

Four module-level handles, all `setTimeout`:

| Handle | Set in | Fires after | Cleared by |
|---|---|---|---|
| `warningTimeout` | `startCycle` | `totalMs × warningFraction` | `clearPostureTimers` |
| `cookedTimeout` | `startCycle` | `totalMs + cookedMs` | `clearPostureTimers` |
| `cookedTimeout` | `snooze` *(reused!)* | `5 min` | `clearPostureTimers` |
| `recoveryTimeout` | `handleRecovery` | `2 s` | `clearPostureTimers` |
| `hydrationTimeout` | `startHydrationCycle` | `hydrationMinutes` | `clearAllTimers` |

`totalMs = randomBetween(minMinutes, maxMinutes)` in ms, rolled fresh each cycle.

No timestamps are recorded anywhere. The extension cannot answer "how long until the next
event?" — which is why there's no countdown, no progress indicator, and no basis for
progress-driven animation.

### The hydration loop is fully independent

`startHydrationCycle` self-reschedules from inside its own callback and never consults
`currentState`. So a hydration popup can land on top of a cooked popup. In practice VS Code
queues them, but they're two unrelated nags competing for the same notification slot with
no coordination.

This is worth noticing because **hydration is the prototype for every future wellness
check** (eye strain, stretch, posture, break). Right now adding a fifth one means
copy-pasting this loop a fifth time. See [EXTENDING.md](EXTENDING.md).

### Storage

| Where | Key | Type | Notes |
|---|---|---|---|
| `context.globalState` | `shrimpCheck.streak` | number | The only persisted state |
| Settings (`Global` target) | `shrimpCheck.*` | 9 keys | All menus write with `ConfigurationTarget.Global` |

Everything else — current state, cycle progress, snooze status — is in-memory and lost on
reload. Settings are always written globally, never per-workspace, which is right for a
wellness tool.

### Rendering

Two functions, and this is the cleanest part of the codebase:

- `setStatus(text, tooltip, bg?, fg?)` — the single write point for the status bar item.
- `createShrimpTooltip(message)` — builds the `MarkdownString` fresh on every call,
  re-reading all 9 config keys each time.

Because `setStatus` is the only writer, **the animation work in
[ANIMATION.md](ANIMATION.md) has exactly one function to hook**. That's lucky and it
should be preserved through any refactor.

The tooltip is rebuilt eagerly on every state change rather than lazily on hover. Cheap
enough today (a dozen string appends), but if it grows, move it behind a lazy getter.

---

## Part 2 — Proposed architecture

The goal is a seam that makes "add a new kind of reminder" a ~40-line file instead of a
copy-paste of the hydration loop. Five modules, roughly 100–200 lines each.

```
src/
├── extension.ts        activate/deactivate wiring only. ~60 lines.
├── core/
│   ├── clock.ts        wall-clock scheduler. The keystone.
│   ├── activity.ts     idle/presence detection
│   └── state.ts        the posture state machine, pure
├── checks/
│   ├── types.ts        the WellnessCheck interface
│   ├── posture.ts      the shrimp
│   ├── hydration.ts    water
│   └── registry.ts     holds and drives all checks
├── ui/
│   ├── statusbar.ts    setStatus + the animation driver
│   ├── tooltip.ts      the hover panel
│   ├── menus.ts        quick picks
│   └── notify.ts       popups, quiet hours, DND suppression
└── storage/
    ├── streak.ts       event-log-backed streak
    └── settings.ts     typed config accessors + change diffing
```

### `core/clock.ts` — do this first

Everything else is blocked on it. Replaces the four bare `setTimeout` handles.

```ts
interface ScheduledEvent {
  id: string;
  dueAt: number;          // Date.now() epoch ms — NOT a duration
  onFire: () => void;
}

interface Clock {
  schedule(id: string, delayMs: number, onFire: () => void): void;
  cancel(id: string): void;
  remaining(id: string): number | undefined;   // unlocks countdown + animation
  progress(id: string): number | undefined;    // 0..1, unlocks progress bars
  pause(): void;                               // idle
  resume(): void;                              // back at keyboard
}
```

Implementation: one shared `setInterval` at ~15s that compares `Date.now()` against every
registered `dueAt`. One timer for the whole extension instead of four.

Why this specific design earns its keep:
- **Sleep-safe.** Wall-clock comparison means suspend/resume can't desync it.
- **`remaining()` unlocks the countdown**, the tooltip progress bar, and every
  progress-driven animation in [ANIMATION.md](ANIMATION.md).
- **`pause()`/`resume()` is the entire idle-detection integration.** One call site.
- **Chained scheduling becomes natural**, which is what fixes
  [Issue 3](STATE_OF_PROJECT.md#3-cookeddelayminutes-does-not-do-what-its-description-says):
  schedule `cooked` when `warning` *fires*, not at cycle start.

### `core/activity.ts`

Fixes [Issue 7](STATE_OF_PROJECT.md#7-no-presence-detection-the-big-one). No camera, no
native modules, four event subscriptions:

```ts
window.onDidChangeWindowState        // focused / blurred
workspace.onDidChangeTextDocument    // typing
window.onDidChangeTextEditorSelection// cursor movement
window.onDidChangeActiveTextEditor   // navigation
```

Maintains `lastInteractionAt`. Emits `onIdle` after a configurable threshold (default 3 min)
and `onActive` on the next interaction. Wire `onIdle → clock.pause()` and
`onActive → clock.resume()` and the "cooked while at lunch" problem is gone.

Design note worth arguing about later: idle should **pause**, not **reset**. If you got up
for 90 seconds you probably stretched — that arguably deserves partial credit. If you were
gone 40 minutes, resetting is right. A threshold split (pause under 10 min, reset over) is
probably correct but should be validated against real use before shipping.

### `checks/types.ts` — the extension point

The single most important interface in the proposed design. Everything user-facing becomes
an implementation of it.

```ts
interface WellnessCheck {
  readonly id: string;                    // 'posture' | 'hydration' | 'eyes' | …
  readonly label: string;                 // 'Posture'
  readonly icon: string;                  // codicon or emoji

  isEnabled(): boolean;
  nextIntervalMs(): number;               // may be randomised

  onDue(ctx: CheckContext): Promise<CheckOutcome>;

  // optional
  statusContribution?(): StatusFragment | undefined;
  tooltipSection?(): string | undefined;
  menuItems?(): QuickPickItem[];
}

type CheckOutcome = 'acknowledged' | 'snoozed' | 'ignored';
```

The registry owns the loop: ask each enabled check for its interval, schedule it on the
clock, invoke `onDue` when it fires, record the outcome, reschedule.

Posture is then *just another check* that happens to have a richer internal state machine.
Hydration is a 40-line file. Adding eye-strain is a 40-line file. See
[EXTENDING.md](EXTENDING.md) for the worked example.

### `storage/streak.ts`

Fixes the multi-window corruption in
[Issue 8](STATE_OF_PROJECT.md#8-multi-window-is-broken). Stop storing a counter; store an
append-only event log and derive:

```ts
type StreakEvent = { at: number; check: string; outcome: CheckOutcome };
// globalState: 'shrimpCheck.events' → StreakEvent[]  (capped, ~500 entries)
```

Concurrent windows appending to a list merge acceptably where concurrent increments of an
integer do not. And it hands you daily/weekly stats, best-streak, and time-of-day heatmaps
for free — several roadmap items collapse into "query the log".

Cap the array and prune on write. `globalState` is not a database.

### `ui/statusbar.ts`

Keep `setStatus` as the sole writer — that property is why animation is cheap. Add:

- an animation driver that owns its own interval and is **only running when a state that
  animates is active** (see [ANIMATION.md](ANIMATION.md) for the frame budget)
- `accessibilityInformation` on every write ([Issue 11](STATE_OF_PROJECT.md#11-accessibility))
- composition of `StatusFragment`s from multiple checks, so hydration can contribute a 💧
  next to the posture state instead of being invisible

### `storage/settings.ts`

Typed accessors plus the change-diffing that fixes
[Issue 5](STATE_OF_PROJECT.md#5-any-config-change-nukes-the-running-cycle):

```ts
const POSTURE_KEYS   = ['minMinutes', 'maxMinutes', 'warningFraction', 'cookedDelayMinutes'];
const HYDRATION_KEYS = ['hydrationEnabled', 'hydrationMinutes'];
const COSMETIC_KEYS  = ['drink', 'showPopup'];
```

Cosmetic changes repaint. Timing changes restart only the affected check. Changing your
drink stops costing you your streak.

---

## Migration order

Strictly sequential — each step depends on the one before.

1. **`core/clock.ts`** + move posture and hydration onto it.
   Fixes Issue 3 and Issue 6. Unblocks countdown and animation.
2. **`storage/settings.ts`** with change diffing. Fixes Issue 5. Small and independent.
3. **`storage/streak.ts`** event log. Fixes Issue 8's corruption half.
4. **`core/activity.ts`**. Fixes Issue 7. Needs `clock.pause()` from step 1.
5. **`checks/*`** — extract hydration to the interface first (it's simpler), then posture.
6. **`ui/*`** split, then animation on top.

Steps 1–4 are bug fixes with no user-visible new features. Resist the urge to skip to 6.

Add a smoke test at step 1 — a fake clock and assertions on the state transitions is maybe
80 lines with `@vscode/test-electron`, and step 1 is exactly the change most likely to
break the state machine silently.
