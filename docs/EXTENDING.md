# Extending Shrimp Check

Recipes for the things you'll actually want to add. Each one is written twice: **today**
(what it costs against the current single-file code) and **after** (what it costs once
[ARCHITECTURE.md](ARCHITECTURE.md) steps 1–5 are done).

The gap between those two columns is the whole argument for the refactor.

---

## Recipe 1 — Add a new wellness check

*Example: eye strain (20-20-20 rule — every 20 min, look 20 ft away for 20 s).*

### Today

Copy `startHydrationCycle` and everything around it:

1. Add 2–3 config keys to `package.json`
2. Add a module-level `eyeStrainTimeout` handle
3. Copy the ~30-line self-rescheduling loop
4. Add it to `clearAllTimers()` — easy to forget, leaks a timer if you do
5. Add a `startEyeStrainCycle()` call to `refreshFromConfig()`
6. Copy `showHydrationMenu` into `showEyeStrainMenu` (~55 lines of switch statement)
7. Register the menu command in `activate()` **and** in `contributes.commands`
8. Add a quick-pick entry pointing at it
9. Add a tooltip line in `createShrimpTooltip`

~150 lines touched across 2 files, 9 places to forget something. The fourth check will
cost the same as the third.

### After

One file, `src/checks/eyestrain.ts`:

```ts
import { WellnessCheck, CheckContext, CheckOutcome } from './types';
import { settings } from '../storage/settings';

export const eyeStrainCheck: WellnessCheck = {
  id: 'eyeStrain',
  label: 'Eye strain',
  icon: '$(eye)',

  isEnabled: () => settings.get('eyeStrainEnabled'),
  nextIntervalMs: () => settings.get('eyeStrainMinutes') * 60_000,

  async onDue(ctx): Promise<CheckOutcome> {
    const choice = await ctx.notify.info(
      '👁 Look 20 feet away for 20 seconds. Your eyeballs are not a monitor.',
      ['Done ✅', 'Later']
    );
    return choice === 'Done ✅' ? 'acknowledged' : 'snoozed';
  },

  tooltipSection: () =>
    settings.get('eyeStrainEnabled')
      ? `- 👁 **Eyes:** every ${settings.get('eyeStrainMinutes')} min`
      : undefined,
};
```

Then one line in `checks/registry.ts` and 2 config keys in `package.json`.

The registry handles scheduling, cancellation, cleanup, outcome recording, the quiet-hours
check, and the generic "enable / interval / test now" menu. You write the interval and the
joke.

### Checklist for any new check

- [ ] Config keys in `package.json` (`enabled` + `minutes` at minimum). **Set `minimum: 1`** —
      don't repeat [Issue 4](STATE_OF_PROJECT.md#4-schema-minimums-contradict-the-preset-menus)
- [ ] Default to **off**. Only posture is on by default. A wellness tool that nags about
      five things on install gets uninstalled.
- [ ] Write the message in the house voice — see [Writing the copy](#writing-the-copy)
- [ ] Give it a `tooltipSection` so it's visible in the hover panel
- [ ] Register in `checks/registry.ts`
- [ ] CHANGELOG entry

---

## Recipe 2 — Add a new posture state

*Example: a `'stretching'` state — a 30-second guided stretch after you acknowledge a warning.*

The state machine is a `type ShrimpState` union plus four `if`-chains scattered across the
file. To add a state you must find all of them:

| Location | What to add |
|---|---|
| `type ShrimpState` (line 3) | the new union member |
| `createShrimpTooltip` (~592) | a `stateLabel` ternary branch |
| `createShrimpTooltip` (~601) | a `stateIcon` ternary branch |
| `resetPosture` handler (~27) | how reset behaves in the new state |
| `snooze` handler (~59) | how snooze behaves in the new state |
| a new `handleX()` function | the transition itself |

Those two nested ternaries in the tooltip are already 4-deep and unreadable at 4 states.
They will not survive a 5th.

**Do this first, it's 15 minutes and it makes every future state trivial:**

```ts
const STATES = {
  ok:        { icon: '🙂', label: 'Posture OK',     text: '🙂 Posture OK' },
  warning:   { icon: '🟡', label: 'Shrimp forming', text: '🟡 Shrimp forming...' },
  recovery:  { icon: '🦐', label: 'Recovering',     text: '🦐 Un-Shrimp' },
  cooked:    { icon: '🍤', label: 'Cooked',         text: '🍤 Cooked' },
  snoozed:   { icon: '😌', label: 'Snoozed',        text: '😌 Snoozed' },
} as const satisfies Record<string, StateDescriptor>;

type ShrimpState = keyof typeof STATES;
```

Both ternaries collapse to `STATES[currentState].icon`. Adding a state becomes one table
row, and TypeScript will now tell you about any exhaustive `switch` you missed.

Note this table is also where per-state **animation frames** hang — see
[ANIMATION.md](ANIMATION.md). Doing this refactor is the prerequisite for animation, so
it's worth doing even if you never add a state.

While you're in there: `'snoozed'` should be a real state
([Issue 9](STATE_OF_PROJECT.md#9-snooze-reuses-cookedtimeout-for-its-own-re-arm)).

---

## Recipe 3 — Add a config setting

Currently four steps, three of which are easy to get wrong:

1. **`package.json` → `contributes.configuration.properties`.** Set a sane `minimum`;
   `1` unless you have a real reason. Write the description as a sentence a user
   understands, and make sure it's *true* — the current `cookedDelayMinutes` description
   describes behaviour the code doesn't implement
   ([Issue 3](STATE_OF_PROJECT.md#3-cookeddelayminutes-does-not-do-what-its-description-says)).
2. **Read it** with `config.get<T>('key', default)`. The default is repeated at every call
   site today, so it can drift from `package.json`. `getStreak`-style helpers or
   `storage/settings.ts` fix this.
3. **Classify it** in `storage/settings.ts` as posture / hydration / cosmetic, so a change
   doesn't restart the wrong thing ([Issue 5](STATE_OF_PROJECT.md#5-any-config-change-nukes-the-running-cycle)).
4. **Surface it** — tooltip line, and a quick-pick entry if it's something people change
   more than once.

**Don't add a setting if a good default would do.** Nine is already a lot for a joke
extension about posture. Every setting is a decision you're pushing onto the user.

---

## Recipe 4 — Add a quick-pick menu entry

The quick pick matches on `selection.label` in a `switch` with the label strings duplicated
between the item array and the switch cases (lines 248–315). Change one and forget the
other and the entry silently does nothing — no compile error, no runtime error.

**Fix while you're there:** attach the action to the item.

```ts
type MenuItem = vscode.QuickPickItem & { run: () => Promise<void> };

const items: MenuItem[] = [
  { label: 'Reset posture timer',
    description: 'Start a fresh Shrimp Check cycle',
    run: () => commands.executeCommand('shrimpCheck.resetPosture') },
  // …
];

const picked = await window.showQuickPick(items, { placeHolder: 'Shrimp Check 🦐' });
await picked?.run();
```

The `switch` disappears and the string can't drift. Same pattern applies to the three
sub-menus, which have the identical bug.

---

## Recipe 5 — Add idle / presence detection

The highest-value change in the whole doc
([Issue 7](STATE_OF_PROJECT.md#7-no-presence-detection-the-big-one)). Sketch:

```ts
export class ActivityMonitor implements vscode.Disposable {
  private lastInteraction = Date.now();
  private idle = false;
  private readonly emitter = new vscode.EventEmitter<'idle' | 'active'>();
  readonly onChange = this.emitter.event;

  constructor(private readonly idleThresholdMs = 3 * 60_000) {
    const bump = () => this.bump();
    this.subs = [
      vscode.window.onDidChangeWindowState(s => s.focused ? bump() : this.check()),
      vscode.workspace.onDidChangeTextDocument(bump),
      vscode.window.onDidChangeTextEditorSelection(bump),
      vscode.window.onDidChangeActiveTextEditor(bump),
    ];
  }

  private bump() {
    this.lastInteraction = Date.now();
    if (this.idle) { this.idle = false; this.emitter.fire('active'); }
  }
  // a 30s tick calls check() → fires 'idle' once past threshold
}
```

Wire it: `onChange('idle') → clock.pause()`, `onChange('active') → clock.resume()`.

**Decide the semantics deliberately.** Three defensible options:

| Away for | Option A: pause | Option B: reset | Recommended |
|---|---|---|---|
| 90 s | resume where you were | full new cycle | pause — that wasn't a break |
| 8 min | resume | new cycle | pause, maybe credit half |
| 45 min | resume mid-cycle *(wrong)* | new cycle | **reset** — you took a real break |

So: pause under ~10 minutes, reset over. Ship it behind
`shrimpCheck.idleBehavior: 'pause' | 'reset' | 'off'` and watch what people set it to.

**Careful:** `onDidChangeTextDocument` fires for programmatic edits too — formatters,
extensions writing files, git operations. Filter to
`e.document === window.activeTextEditor?.document` and require the window to be focused,
or a background formatter will convince Shrimp Check you're hard at work while you're at
lunch.

---

## Recipe 6 — Persist and query history

Once `storage/streak.ts` is an event log ([ARCHITECTURE.md](ARCHITECTURE.md)), these all
become one-liners over the same array:

- Best streak ever → `max` over consecutive `acknowledged` runs
- Reminders answered today → filter by date
- Best/worst time of day → bucket by hour
- Weekly summary → group by ISO week
- "You're 40% better than last week" → compare two ranges

None of it needs new storage. Build the log once, then the stats features are UI work
rather than data work.

Rules: cap the array (~500 events, prune oldest on write); `globalState` is a JSON blob,
not a database. Never send it anywhere — no telemetry, ever. It's health-adjacent data
about a person's body and it should never leave their machine. If a stats view is ever
built, it reads local state and nothing else.

---

## Writing the copy

The tone is the product. Guidelines derived from what's already in there:

**Do**
- Escalate the *joke*, not the *guilt*: "you may or may not be a shrimp" → "the shrimp may
  have gotten the best of you this time"
- Keep the dismiss option warm: "Give me 5 min", not "Ignore"
- Personify the shrimp as a mild adversary, not the user as a failure
- Vary the phrasing — pull from a small pool per state so it doesn't become wallpaper
  (this is the same reason the interval is randomised)

**Don't**
- Moralise. No "you've been sitting for 45 minutes, this is bad for you."
- Guilt on failure. "Cooked" is funny because it's absurd, not because it's a scolding.
- Reference weight, appearance, discipline, or willpower. It's a posture joke.
- Make health claims. "Fix your posture" is fine; "prevents back pain" is a medical claim
  and shouldn't be in the extension or the marketplace listing.

**Test:** read the message out loud on the worst day of a bad sprint. If it would land as
smug, rewrite it.

---

## Before you ship

- [ ] `npm run compile` clean — `strict: true`, no `any` sneaking in
- [ ] Manually test the full ladder with short timers (1–2 min) — set them via Settings JSON
      to bypass the preset minimums
- [ ] Test with `showPopup: false` — status bar must still tell the whole story
- [ ] Test disable → enable — no orphaned timers
- [ ] Test the reload path (`Developer: Reload Window`)
- [ ] Test in **two windows at once** — the case most likely to be broken
      ([Issue 8](STATE_OF_PROJECT.md#8-multi-window-is-broken))
- [ ] Screen reader / `accessibilityInformation` set on new status states
- [ ] CHANGELOG entry, version bumped **in the same commit** (see
      [Issue 1](STATE_OF_PROJECT.md#1-version-mismatch))
- [ ] `vsce package` and install the `.vsix` locally — dev-host behaviour and installed
      behaviour have diverged before (CHANGELOG 0.0.8 notes exactly this)
