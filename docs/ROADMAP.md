# Roadmap

Two sections: **grounded** (versioned, ordered, feasible) and **moonshots** (explicitly
speculative, do not plan around these).

Positioning that everything below is measured against:

> A productivity/wellness extension that is funny first and useful second — because the
> funny is what keeps it installed, and an uninstalled wellness tool has zero health benefit.

---

# Part 1 — Grounded

## 0.1.0 — Fix the foundations

No new features. This is the release that makes every later release cheap. Resist the urge
to sneak something shiny in.

| Item | Ref |
|---|---|
| `core/clock.ts` — wall-clock scheduler, single interval | [ARCH](ARCHITECTURE.md) |
| Fix `cookedDelayMinutes` to chain off the warning | [Issue 3](STATE_OF_PROJECT.md#3-cookeddelayminutes-does-not-do-what-its-description-says) |
| Fix schema `minimum` values that contradict the presets | [Issue 4](STATE_OF_PROJECT.md#4-schema-minimums-contradict-the-preset-menus) |
| Config change diffing — stop nuking the cycle on a drink rename | [Issue 5](STATE_OF_PROJECT.md#5-any-config-change-nukes-the-running-cycle) |
| Snooze duration → single source of truth + real `'snoozed'` state | [Issue 2](STATE_OF_PROJECT.md#2-snooze-says-10-in-one-place-and-5-everywhere-else), [9](STATE_OF_PROJECT.md#9-snooze-reuses-cookedtimeout-for-its-own-re-arm) |
| `STATES` table — kill the 4-deep ternaries | [EXT Recipe 2](EXTENDING.md#recipe-2--add-a-new-posture-state) |
| `accessibilityInformation` on every status write | [Issue 11](STATE_OF_PROJECT.md#11-accessibility) |
| `out/` in `.gitignore`; real `.vscodeignore` | [Issue 10](STATE_OF_PROJECT.md#10-out-is-committed-to-git) |
| Version/CHANGELOG reconciled + release checklist | [Issue 1](STATE_OF_PROJECT.md#1-version-mismatch) |
| First tests: fake clock, assert the state ladder | |

**Ship criterion:** identical user-visible behaviour, minus the bugs.

---

## 0.2.0 — Know when you're actually there

The release that makes Shrimp Check *correct* rather than merely *timed*.

- **`core/activity.ts`** — idle/presence detection from window focus + edit/cursor events
  ([Issue 7](STATE_OF_PROJECT.md#7-no-presence-detection-the-big-one))
- **`shrimpCheck.idleBehavior`** — `pause` (default) / `reset` / `off`, with the
  ~10-minute pause→reset threshold from [EXT Recipe 5](EXTENDING.md#recipe-5--add-idle--presence-detection)
- **Countdown in the tooltip** — "next check in 18 min", free once `clock.remaining()` exists
- **Quiet hours + DND** — suppress popups during an active debug session and inside a
  configured time range; status bar still updates
  ([Issue 12](STATE_OF_PROJECT.md#12-no-quiet-hours-no-do-not-disturb))

**Why this is the highest-value release:** the #1 reason people uninstall reminder
extensions is being nagged when they weren't there. This fixes that.

---

## 0.3.0 — Make it look like something

First release with visible polish. See [ANIMATION.md](ANIMATION.md).

- **Custom icon font** via `contributes.icons` — 4–6 shrimp curl frames + a water glyph.
  Fixes the fact that 🦐 and 🍤 are near-identical at status-bar size on Windows.
- **`shrimpCheck.animations`** — `full` / `subtle` (default) / `off`, with `workbench.reduceMotion`
  forcing `off`
- **`StatusAnimator`** + the recovery celebration (one-shot, 2s, already has a hook)
- **Guided break countdown** — `withProgress` notification, 30s, cancellable, rotating
  stretch prompts. Behind `shrimpCheck.guidedBreaks`, default off.
- Warning / cooked short animation bursts

---

## 0.4.0 — Wellness checks as a system

Turn the hardcoded hydration loop into a real extension point, then use it twice.

- **`WellnessCheck` interface + registry** ([ARCH](ARCHITECTURE.md), [EXT Recipe 1](EXTENDING.md#recipe-1--add-a-new-wellness-check))
- Migrate posture and hydration onto it
- **Eye strain check** (20-20-20) — off by default
- **Stretch check** — a specific named stretch each time, from a small rotating pool
- Generic per-check menu (enable / interval / test now) built once by the registry
- Status bar composes fragments from all active checks

By the end of this release, adding a check should be one ~40-line file plus two config keys.

---

## 0.5.0 — History and streaks that survive

- **Event-log-backed streak** ([Issue 8](STATE_OF_PROJECT.md#8-multi-window-is-broken)) —
  fixes multi-window corruption and unlocks everything below for free
- **Best streak** tracked and shown in the hover panel
- **Daily/weekly summary** in the tooltip: checks answered, best time of day
- **Milestone celebrations** at 5 / 10 / 25 / 50
- **Multi-window leader election** — one window owns the timers and the popups; the rest
  render read-only status. Hardest item in the grounded section; may slip.

All local. No telemetry, ever — see [EXT Recipe 6](EXTENDING.md#recipe-6--persist-and-query-history).

---

## 1.0.0 — Earn the version number

- All of the above, stable, with tests
- README rewritten around what it actually does (and drop the hardcoded user-count badge)
- Marketplace listing with a real animated GIF of the status bar states
- A short walkthrough (`contributes.walkthroughs`) for first install — VS Code's own
  onboarding surface, better first-run than a popup
- Settings documented and pruned. If a setting exists that nobody changes, delete it.

---

## Explicitly not doing

Worth writing down so it doesn't get re-litigated:

- **Telemetry / analytics.** Health-adjacent data about someone's body. Never leaves the
  machine.
- **Accounts, sync, leaderboards.** A posture joke does not need a backend.
- **Sound.** VS Code doesn't offer it and that's a mercy.
- **A settings webview.** The hover panel is better and costs nothing. This is the product's
  best idea — don't replace it with a worse, heavier one.
- **Medical claims.** "Fix your posture" is fine. "Prevents back pain" is a regulated
  assertion.
- **Anything that makes `ok` state animate continuously.** See
  [ANIMATION.md](ANIMATION.md) principle 1.

---

# Part 2 — Moonshots

**Speculative. Not planned, not scheduled, several are bad ideas that are useful to think
against.** Nothing here should influence the grounded architecture.

### Camera-based posture detection

The obvious "real" version. TensorFlow.js pose estimation in a hidden webview, actually
measure neck angle, only fire when you're genuinely shrimping.

**Why it's a moonshot, not a feature:** shipping a VS Code extension that turns on the
webcam is a trust catastrophe regardless of how local the processing is. Bundle size goes
from ~20KB to tens of megabytes. Battery cost is real. Accuracy in bad lighting is poor.
And the honest version of the pitch — "this extension watches you through your camera" —
is not a sentence you want in a marketplace listing.

If ever attempted: separate opt-in companion extension, never bundled, never on by default,
model runs locally with a visible camera indicator, and a written privacy policy. Probably
still not worth it.

### Wearable / phone integration

Read step count or standing hours from a phone or watch to know if you actually got up.
Solves the "did they really stand" problem that presence detection can't. Requires OAuth,
a backend, per-vendor SDKs, and violates the "no accounts" rule above. Interesting;
disproportionate.

### Team mode

Shared team streaks, a channel bot that announces when someone gets cooked, office-wide
stretch breaks. Genuinely funny and would spread well.

Also: gamified health surveillance by your employer. The joke curdles the moment
participation stops being optional. If ever built, it must be strictly opt-in per person,
aggregate-only, and impossible for a manager to see individual data — which is a lot of
engineering to protect a bit.

### Editor-integrated ergonomics nudges

Detect a long uninterrupted typing burst (no cursor jumps, no pauses > 2s for 15 minutes)
and infer flow-state hunching, rather than firing on a timer at all. Would make the whole
reminder adaptive instead of scheduled.

This one is actually *closest to shippable* of the moonshots — the data is already in the
events `activity.ts` subscribes to. Could be prototyped in a day as a "smart interval"
mode. Promote it to grounded if the prototype feels good.

### Shrimp Check for other editors

JetBrains, Neovim, a menu bar app. The concept is editor-agnostic; the audience is bigger
than VS Code. The core state machine is ~200 lines of platform-free logic, so a port is
mostly UI. Realistically a "if this gets popular" item.

### The shrimp as a companion

A persistent character with a name, moods, and a relationship with you — it gets sadder as
you slouch, celebrates streaks, comments on your commit messages. Tamagotchi for your
spine.

Requires a webview (explicitly out of scope) and risks turning a lightweight joke into
something that demands emotional labour. But it's the version people would *love*, and the
one that gets screenshotted. Worth prototyping purely to find out whether it's charming or
exhausting.

### LLM-generated messages

Rotate the copy infinitely via the VS Code Language Model API — messages that reference
your current file, your language, the time of day. "You've been in `webpack.config.js` for
40 minutes. Nobody deserves that. Stand up."

Genuinely funny, genuinely feasible (the LM API is right there, no key needed), and
genuinely risky: it sends context about your work to a model, adds latency to a reminder
that must be instant, and one bad generation in a tone-sensitive wellness context does more
damage than a hundred good ones do good. A curated pool of hand-written lines gets 80% of
the charm at 0% of the risk.

The safe middle: use an LLM at *authoring* time to generate a few hundred lines, hand-pick
the good ones, ship them as a static pool.

---

## How to decide what's next

When something new comes up, in order:

1. **Does it make the extension funnier?** If no, it needs a strong utility case.
2. **Does it add a setting?** Settings are a cost. Nine is already a lot.
3. **Does it interrupt more often?** Every new interruption is a new uninstall reason.
4. **Does it need a webview, a backend, or a permission prompt?** Then it's a moonshot.
5. **Is it blocked on `core/clock.ts`?** Most things are. Do 0.1.0 first.
