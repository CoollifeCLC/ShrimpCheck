# Animation plan

Scope: **status bar and notification level only.** No webview, no sidebar mascot, no
sprite sheets. Subtle motion that makes state legible at a glance without becoming the
flashing banner ad of your editor.

Everything below is planning. Nothing is implemented.

---

## 1. What VS Code actually allows

Verified against current VS Code extension API docs (see [Sources](#sources)). Important,
because most of what you'd want is not available.

### ✅ Available

**Text mutation.** `statusBarItem.text` is a plain string you can reassign as often as you
like. Reassigning on an interval is the primary animation mechanism. Everything else is a
variation on this.

**Built-in spin modifier.** Append `~spin` to a codicon:

```ts
statusBarItem.text = '$(sync~spin) Working';
```

**Only three icons support it:** `sync`, `loading`, `gear`. That's the documented set —
none of them look like a shrimp, so this is useful for a "checking…" state and not much else.

**Theme colours.** `statusBarItem.color` and `.backgroundColor` accept `ThemeColor`.
Already used for warning/error. Only a small set of status-bar background colours are
honoured by the workbench (`statusBarItem.warningBackground`, `.errorBackground`) — you
cannot animate arbitrary colours, and the UX guidelines explicitly say don't add custom
colours. So colour is a *state* signal, not an animation channel.

**Custom icons via `contributes.icons`.** Ship a `.woff` font and register glyphs by ID:

```json
"contributes": {
  "icons": {
    "shrimp-straight": { "description": "Good posture shrimp",
      "default": { "fontPath": "./assets/shrimp.woff", "fontCharacter": "\\E001" } },
    "shrimp-curled":   { "description": "Bad posture shrimp",
      "default": { "fontPath": "./assets/shrimp.woff", "fontCharacter": "\\E002" } }
  }
}
```

Then `$(shrimp-curled)` in the status bar. **This is the single highest-value item in this
doc** and it isn't even animation — it fixes the fact that 🦐 and 🍤 are nearly
indistinguishable at status bar size on several Windows font stacks, which means the two
most important states currently look the same. It also inherits the status bar's
foreground colour, so it themes correctly, unlike emoji.

Font glyphs also enable **frame-by-frame animation done properly**: draw the shrimp at 4–6
curl angles, assign each a glyph, cycle the icon ID. That's real animation with no emoji
and no webview.

**Notification progress.** `window.withProgress({ location: ProgressLocation.Notification })`
gives an animated progress bar in a real notification, with `increment` updates and an
optional cancel button. Perfect for a guided break countdown.

**Status bar progress.** `ProgressLocation.Window` puts a spinner in the status bar. Less
control than owning your own item, but it's the sanctioned "background work" affordance.

### ❌ Not available

- **CSS/keyframe animation** on status bar items. No stylesheet access at all.
- **Arbitrary spin/pulse modifiers.** Only `sync`, `loading`, `gear` support `~spin`. Whether
  `~spin` works on a *custom contributed* icon is undocumented — **spike this before
  planning around it.** Assume no.
- **Images in the status bar.** Text and icon-font glyphs only.
- **Animated GIF anywhere** outside a webview.
- **Fade / opacity / transform.** Nothing sub-frame. Your only tool is discrete text swaps.
- **Sound.** Deliberately unavailable, and just as well.

### ⚠️ Constraints to respect

- **VS Code throttles status bar spinner animations to save CPU** — there's upstream work
  specifically on this. Anything you build that redraws frequently is fighting the
  platform's own power budget.
- **The status bar is shared.** UX guidelines: one item, short text, icons only when they
  carry a clear metaphor. Shrimp Check already uses roughly the maximum sanctioned space.
- **Width changes cause layout shift.** If a frame is wider than its neighbour, every item
  to its left jumps. Pad all frames to identical display width or it will look broken.
- **Emoji width is unpredictable** across platforms and fonts, which makes the padding rule
  hard to honour with emoji and easy with an icon font. Another point for `contributes.icons`.

---

## 2. Design principles

The failure mode here is obvious and fatal: a wellness extension that becomes the most
distracting thing on the screen. Rules:

1. **Motion means urgency.** `ok` is completely static. Motion is reserved for states that
   want action. If everything moves, nothing does.
2. **Frames are cheap, intervals are not.** 800ms is fast enough for a legible wiggle. Below
   ~500ms it reads as flicker and burns battery.
3. **Animate only in transient states.** The interval must not exist during `ok`, which is
   ~95% of the time. Start it on entering an animating state, clear it on exit. No permanent
   background interval.
4. **Stop when the window is blurred.** `window.state.focused === false` → no one is looking,
   kill the timer. Free battery win, one event subscription. Also stop when idle
   (`activity.ts` already tells you).
5. **Every animation is opt-out.** `shrimpCheck.animations: 'full' | 'subtle' | 'off'`.
   Ship `subtle` as default. `off` must be a true no-op with zero timers running.
6. **Respect the platform.** If `workbench.reduceMotion` is enabled, force `off`. Check
   `workspace.getConfiguration('workbench').get('reduceMotion')`. Non-negotiable —
   vestibular disorders are real and this is a health extension.
7. **Never animate the width.** See constraints above.

---

## 3. Proposed animations by state

Assumes the `STATES` table from [EXTENDING.md](EXTENDING.md) and `clock.progress()` from
[ARCHITECTURE.md](ARCHITECTURE.md). Every idea here is blocked on those two.

### `ok` — static

```
🙂 Posture OK
```

No motion. Ever. This is the state you're in almost all the time.

**Optional (behind `animations: 'full'`):** a *very* slow posture-degradation tell driven by
`clock.progress()` — the shrimp glyph curls one notch per quarter of the cycle. Four frames
over 40 minutes. Not really animation; more an ambient progress dial you notice
peripherally when you happen to glance down. Requires the custom icon font.

```
progress 0.00–0.25   $(shrimp-straight)
progress 0.25–0.50   $(shrimp-slight)
progress 0.50–0.75   $(shrimp-bent)
progress 0.75–1.00   $(shrimp-curled)
```

This is the most interesting idea in the doc and the least intrusive — it's information,
displayed continuously, at zero attention cost. Build it after the icon font lands.

### `warning` — gentle two-frame wiggle

```
frame A:  🟡 Shrimp forming...
frame B:  🟡 Shrimp forming…
```

Two frames, ~900ms, running for ~20 seconds and then stopping. A brief wave to catch your
peripheral vision, then it goes quiet and lets the colour carry the state. Motion that
never stops becomes wallpaper *and* stays annoying — the worst combination.

With the icon font, alternate two curl frames instead of punctuation. Much better.

### `cooked` — three-frame steam, then settle

```
frame A:  🍤 Cooked
frame B:  ♨️ Cooked
frame C:  🍤 Cooked
```

~700ms, ~15 seconds, then static red. Cooked already has the error background, which is the
loudest thing the status bar can do — animation adds a *little* on top and then gets out of
the way. Don't let this one run indefinitely; a permanently flashing red item in a shared
UI region is genuinely hostile.

### `recovery` — a one-shot celebration

The best animation in the plan, because it's a reward and it's short. Runs once, ~2s, then
returns to `ok`:

```
🦐 → 🦐 ✨ → 🎉 Un-shrimped! → 🔥 Streak: 5 → (back to ok)
```

Cheap, feels good, and the existing 2-second `recoveryTimeout` is *already exactly the
right length* — the hook is sitting there in `handleRecovery`.

Escalate on milestones: streak 5, 10, 25 get an extra beat. Small, and it's the loop that
makes people keep the extension installed.

### `snoozed` — a slow breathing dot

```
😌 Snoozed ·    →    😌 Snoozed ··   →    😌 Snoozed ···  →  (loop)
```

~1200ms. This one *should* loop for the whole snooze — it's the only case where continuous
motion is right, because it's telling you "the thing is paused, deliberately, and hasn't
been forgotten." Trailing dots also change width — pad to three characters and vary the
character instead (`·`, `••`, `•••` at fixed width, or just swap glyph).

Requires adding `'snoozed'` as a real state
([Issue 9](STATE_OF_PROJECT.md#9-snooze-reuses-cookedtimeout-for-its-own-re-arm)).

### Hydration — a one-shot drip

```
💧 → 💧💧 → 💦 → (clears)
```

~600ms, one pass, in a status bar fragment next to the posture state. Hydration is currently
invisible until it fires a popup; a brief visual makes it feel like part of the same product.

---

## 4. Notification-level animation

Richer than the status bar, but each one interrupts. Budget them carefully.

### Guided break countdown — the strong candidate

When you hit "I'm up 😅", instead of a toast that vanishes, run a real 30-second timer:

```ts
window.withProgress(
  { location: ProgressLocation.Notification,
    title: '🦐 Stand up and stretch',
    cancellable: true },
  async (progress, token) => {
    for (let s = 30; s > 0 && !token.isCancellationRequested; s--) {
      progress.report({ increment: 100 / 30, message: `${s}s — roll your shoulders` });
      await delay(1000);
    }
  }
);
```

Genuinely animated (real progress bar), genuinely useful, uses a first-class API, and turns
"dismiss the nag" into "actually did the thing." The message line can rotate through
prompts — shoulders, neck, look away, stand fully. This is the highest-value notification
work and it should probably come before any status bar animation.

Gate it behind `shrimpCheck.guidedBreaks` (default off until validated) — a 30-second modal
progress bar is a real interruption and some people will hate it.

### Status-bar progress during a break

`ProgressLocation.Window` for the same countdown, but discreet. Good `subtle`-mode
alternative to the notification version.

### Streak milestone toast

Fire only at 5/10/25/50. `showInformationMessage` with the shrimp glyph and the number.
Cheap, and the only notification the user is happy to receive.

---

## 5. The animation driver

One place, hooked into `setStatus` — which is already the sole writer to the status bar
item ([ARCHITECTURE.md](ARCHITECTURE.md)), so this is a small change.

```ts
interface StateAnimation {
  frames: string[];
  intervalMs: number;
  repeat: number | 'forever';   // frames-through count
  minLevel: 'subtle' | 'full';
}

class StatusAnimator {
  private timer?: NodeJS.Timeout;
  private frame = 0;

  play(anim: StateAnimation) {
    this.stop();
    if (!this.shouldAnimate(anim.minLevel)) return;   // reduceMotion, config, blur, idle
    this.timer = setInterval(() => { … }, anim.intervalMs);
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = undefined; } }
}
```

Invariants worth enforcing in review:

- **Exactly one interval at a time**, and only while a non-`ok` state is active.
- `stop()` on: state change, window blur, idle, disable, `deactivate()`.
- `shouldAnimate()` is the *only* place that reads `reduceMotion` and the animation setting.
  One gate, no scattered checks.
- Every frame array is validated to have equal display width at construction. Write the
  assertion; the layout-shift bug is invisible in dev and obvious to users.

Frames attach to the `STATES` table, so adding an animation to a new state is a table row.

---

## 6. Order of work

1. **Custom icon font** (`contributes.icons`, 4–6 shrimp curl frames + a water glyph).
   No animation, but it fixes the 🦐/🍤 legibility problem, themes correctly, and every
   later item depends on it. Needs a designer or a couple of hours in a font editor.
2. **`shrimpCheck.animations` setting + `reduceMotion` respect.** Ship the gate before
   anything it gates.
3. **`StatusAnimator`** + the `recovery` celebration. Smallest, most rewarding, one-shot,
   no long-running timer.
4. **Guided break countdown** via `withProgress`. Highest user value in the whole doc.
5. **`warning` and `cooked`** short bursts.
6. **`snoozed`** breathing loop — the only permanent loop, so ship it last with the most
   scrutiny.
7. **Progress-driven `ok` curl** — blocked on `clock.progress()`. The most novel idea here;
   worth prototyping even if it doesn't ship.

Items 3–7 are all blocked on the `STATES` table refactor
([EXTENDING.md](EXTENDING.md), Recipe 2) and item 7 additionally on `core/clock.ts`.

---

## 7. Open questions

- Does `~spin` work on a **custom contributed icon**? Undocumented. Ten-minute spike, and
  a "yes" would meaningfully change the plan.
- How aggressively does VS Code throttle a self-managed `setInterval` on the status bar,
  vs. the built-in spinner it explicitly throttles? Measure before committing to sub-second
  frames.
- Do custom icon-font glyphs render correctly in the tooltip `MarkdownString` as well as the
  status bar? Would let the hover panel show the same shrimp.
- Is the progress-driven curl actually noticeable, or does it read as a static icon that
  occasionally seems different? Needs a real day of use to judge — build the prototype
  before designing six glyphs around it.

---

## Sources

- [Product Icon Reference — Animation & `contributes.icons`](https://code.visualstudio.com/api/references/icons-in-labels)
- [UX Guidelines — Status Bar](https://code.visualstudio.com/api/ux-guidelines/status-bar)
- [StatusBarItem API reference](https://code.visualstudio.com/api/references/vscode-api#StatusBarItem)
- [Status bar extension sample](https://github.com/microsoft/vscode-extension-samples/tree/main/statusbar-sample)
- [microsoft/vscode#96096 — Throttle status bar spinner animations to save CPU](https://github.com/microsoft/vscode/pull/96096)
- [microsoft/vscode-codicons#100 — Request: spinning version of icons](https://github.com/microsoft/vscode-codicons/issues/100)
