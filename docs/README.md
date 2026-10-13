# Shrimp Check — planning docs

Planning phase, August 2026. **No code changes have been made.** These describe the
current state and a proposed direction; nothing here is implemented.

| Doc | What's in it |
|---|---|
| [STATE_OF_PROJECT.md](STATE_OF_PROJECT.md) | What ships at 0.0.9, full feature/config inventory, and 13 bugs & rough edges with suggested fixes |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How it works today (state machine, timers, storage) + the proposed 5-module split and migration order |
| [EXTENDING.md](EXTENDING.md) | Recipes: new wellness check, new state, new setting, new menu entry, idle detection, history. Plus tone guidelines and a pre-ship checklist |
| [ANIMATION.md](ANIMATION.md) | What VS Code actually permits (verified against current API docs), design principles, per-state animation proposals, order of work |
| [ROADMAP.md](ROADMAP.md) | Versioned plan 0.1.0 → 1.0.0, an explicit not-doing list, and a clearly-labelled moonshot section |
| [CHALLENGE_MODE.md](CHALLENGE_MODE.md) | Challenge Mode (shipped): architecture, schema, scoring, persistence, selection, limitations, Phase 2 ideas |
| [RELEASING.md](RELEASING.md) | Version bump → commit → `npm run release:publish`, and what each preflight check does |

## The short version

The concept and interaction design are ahead of the implementation. Three findings matter
most:

1. **`cookedDelayMinutes` doesn't do what it says** — the cooked timer is scheduled from
   cycle start, not from the warning, so the real grace period is ~22 min instead of the
   configured 10, and it grows with `maxMinutes`.
   ([detail](STATE_OF_PROJECT.md#3-cookeddelayminutes-does-not-do-what-its-description-says))
2. **There's no presence detection** — the timer runs while you're at lunch, so you get
   cooked and lose your streak for leaving the desk.
   ([detail](STATE_OF_PROJECT.md#7-no-presence-detection-the-big-one))
3. **Nothing records a timestamp** — which blocks countdowns, progress indicators, and
   every progress-driven animation idea.
   ([detail](STATE_OF_PROJECT.md#6-timers-are-settimeout-with-no-wall-clock-anchor))

All three collapse into one change: a wall-clock scheduler (`core/clock.ts`). That's the
first thing to build and most of the roadmap is blocked on it.

On animation specifically: the highest-value item isn't animation at all — it's shipping a
**custom icon font**, because 🦐 and 🍤 are nearly indistinguishable at status-bar size, which
means the two most important states currently look the same.
([detail](ANIMATION.md#1-what-vs-code-actually-allows))
