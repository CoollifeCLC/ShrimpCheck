# Challenge Mode

Challenge Mode turns Shrimp Check into a lightweight coding-practice system. On a configurable
interval it offers a coding challenge, times the attempt, and scores it. Correctness comes
first. Solve time and assistance only change the star rating.

---

## Architecture

The feature extends the existing extension and adds no parallel infrastructure:

| Concern | Existing pattern reused | Where |
|---|---|---|
| Scheduling | Same fixed-interval `setTimeout` loop shape as hydration. `challengeTimeout` sits beside the other handles and is cleared by `clearAllTimers()` | `src/extension.ts` → `startChallengeCycle` |
| Settings | `contributes.configuration` keys under `shrimpCheck.challenge.*`, read through `getConfiguration('shrimpCheck')`, written with `updateShrimpConfig` (effective-scope writes) | `package.json`, `src/challenges/settings.ts` |
| Menus | Quick pick submenu, same shape as the hydration and timer menus | `showChallengeMenu` in `src/extension.ts` |
| Hover panel | Extra section and two trusted command links in `createShrimpTooltip` | `src/extension.ts` |
| Persistence | `context.globalState`, the same store as the posture streak | `src/challenges/history.ts` |
| Tests | Same `node:test` + fake-timer + vscode-mock harness | `test/extension.test.js`, `test/challenges.test.js` |

The only new UI surface is a **webview panel**. The extension had no panel pattern before, and a
challenge needs a problem statement and buttons that notifications can't hold. The panel uses
VS Code theme variables, so it looks native in any theme.

```
src/challenges/
├── types.ts        schema + category/difficulty enums           (no vscode import)
├── catalog.ts      seed challenges — content only                (no vscode import)
├── scoring.ts      timing stars, assistance caps, final score    (no vscode import)
├── runner.ts       runs user JS against tests in node:vm         (no vscode import)
├── session.ts      one attempt in progress: assistance, submits  (no vscode import)
├── history.ts      attempt persistence + stats                   (no vscode import)
├── selection.ts    eligibility filter + weighted pick            (no vscode import)
├── settings.ts     typed config reader + Interview Sprint preset (no vscode import)
├── view.ts         HTML for the challenge and stats webviews     (no vscode import)
└── controller.ts   panel, solution file, session lifecycle       (vscode)
```

Everything except `controller.ts` is plain TypeScript with no `vscode` dependency, so it is
unit-tested directly.

### Flow

```
challenge timer fires (every N min, only if shrimpCheck.enabled && challenge.enabled)
  │  next slot is scheduled immediately, so an ignored toast never stalls the loop
  │  skipped if an attempt is already in progress
  ▼
notification: "Shrimp Challenge ready: <title> (<difficulty> · <category>)"
  ├─ Start      → solution file opens in an editor tab, panel opens beside it, clock starts
  ├─ In 10 min  → re-offer in 10 minutes
  └─ Skip / ignore → wait for the next regular slot
```

In the panel:

- **Run Tests** runs the visible tests against whatever is in the editor. Saving isn't required.
- **Submit** runs visible and hidden tests. If all pass, the attempt is scored, recorded, and the
  result view is shown. If any fail, the result is shown and the attempt **stays open**.
- **Skip challenge** records an abandoned attempt (0 stars).
- Closing the panel does **not** end the attempt. Resume it from the quick menu, the hover panel,
  or `Shrimp Check: Resume Challenge`. The clock is wall-clock based and keeps running, but it can
  never fail the attempt.

The in-flight attempt (challenge id, start time, assistance used, submit count) is saved in
`globalState`, so it also survives a window reload.

---

## Challenge schema

```ts
interface Challenge {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category: ChallengeCategory;          // see types.ts
  description: string;                  // supports **bold** and `code`
  examples: { input: string; output: string; explanation?: string }[];
  constraints: string[];
  functionName: string;                 // the function tests call
  starterCode: string;
  tests: {
    args: unknown[];                    // JSON-serialisable, cloned per run
    expected: unknown;
    hidden?: boolean;                   // Submit only; details never shown
    compare?: 'deep' | 'sorted';        // 'sorted' for order-independent answers
    inPlaceArg?: number;                // check this arg's final state instead of the return value
  }[];
  setup?: string;                       // helper functions injected before the solution
  pattern: string;
  hint: string;
  approach: string;
  expectedTimeComplexity: string;
  expectedSpaceComplexity: string;
  tags: string[];
  enabled: boolean;
}
```

To add a challenge, append it to `CHALLENGES` in `catalog.ts`, then add a reference solution to
`REFERENCE_SOLUTIONS` in `test/challenges.test.js`. The test suite fails if any seeded challenge
lacks a working reference solution, or if its starter code passes.

---

## Scoring

```
timingStars = 5 if ≤ five  | 4 if ≤ four | 3 if ≤ three | 2 if ≤ two | else 1   (minutes)
cap         = min(5, 4 if pattern, 3 if hint, 2 if approach)
stars       = correct ? min(timingStars, cap) : 0
```

- Correctness is a hard gate. An incorrect submission scores 0 and does not complete the attempt.
- Caps limit the rating; they don't subtract. An 8-minute solve with a hint is ★★★, not ★★.
  A 25-minute solve with a hint is ★★, because time already put it below the cap.
- Thresholds are normalised: non-positive values fall back to defaults, and each tier is at
  least as long as the one before it.
- Complexity in the result view comes from challenge metadata. It is not analysed from the code.

---

## Persistence

| Key (`globalState`) | Shape | Notes |
|---|---|---|
| `shrimpCheck.challenge.attempts` | `ChallengeAttempt[]` | Append-only, newest 500 kept. Malformed entries are ignored on load. |
| `shrimpCheck.challenge.activeSession` | `{ challengeId, startedAt, assistance, submissions }` | Cleared when an attempt is solved or skipped. |

```ts
interface ChallengeAttempt {
  challengeId; category; difficulty;
  startedAt; completedAt; elapsedMs;
  correct: boolean; stars: number;            // 0 when not solved
  assistance: ('pattern' | 'hint' | 'approach')[];
  submissions: number;
  outcome: 'solved' | 'abandoned';
}
```

Solution files live in the extension's global storage (`challenges/<id>.js`), outside any
workspace, so they never touch the user's repositories.

### Stats

- **Total solved**: count of correct attempts.
- **Average solve time**: mean `elapsedMs` of correct attempts.
- **Five-star count**: correct attempts with 5 stars.
- **Current streak**: consecutive local days with at least one solve. The streak stays alive if
  the last solve was yesterday.
- **Category score**: average stars ÷ 5 across attempts. Skipped attempts count as 0.

---

## Selection

1. Filter: `enabled`, category in `challenge.categories`, difficulty in `challenge.difficulties`.
   Practical categories also require `challenge.includePractical`.
2. Weight each candidate:
   - seen in the last 5 attempts → ×0.05 (most recent) up to ×0.25
   - never attempted → ×2
   - × (1 + weakness), where weakness = 1 − category score (0.5 if unknown)
3. Weighted random pick.

---

## Settings

| Setting | Default |
|---|---|
| `shrimpCheck.challenge.enabled` | `false` |
| `shrimpCheck.challenge.intervalMinutes` | `60` |
| `shrimpCheck.challenge.categories` | all 9 core categories |
| `shrimpCheck.challenge.difficulties` | `["easy", "medium"]` |
| `shrimpCheck.challenge.includePractical` | `false` |
| `shrimpCheck.challenge.fiveStarMinutes` / `four…` / `three…` / `two…` | `10` / `15` / `20` / `30` |

**Interview Sprint** writes: enabled, 7 core categories (Strings, Arrays, Hash Maps / Sets, Two
Pointers, Sliding Window, Stacks / Queues, Binary Search), Easy + Medium, thresholds
10/15/20/30, and a challenge every 30 minutes. These are ordinary settings, so they stay
editable afterwards.

---

## Known limitations (v1)

- Solutions are JavaScript only.
- The runner uses `node:vm` with a timeout. That guards against accidental infinite loops; it is
  not a security sandbox. It only runs the user's own code.
- Some category names already name the pattern (e.g. Two Pointers), and the category is visible
  from the start. **Reveal Pattern** gives the more specific technique
  (e.g. "Two Pointers (read / write)").
- Practical categories JavaScript Fundamentals and Debugging have no seed challenges yet. They can
  be selected, but they contribute nothing to the pool.
- Like hydration, any Shrimp Check settings change restarts the challenge interval. An attempt
  already in progress is not affected.
- The clock keeps running while the panel is closed. It can't fail the attempt, but it does
  lower the possible rating.

---

## Phase 2 ideas (documented only, not started)

- Randomised "ambush" mode: random intervals instead of fixed ones
- SQL challenges
- System design prompts (rubric-scored rather than test-scored)
- Graphs
- Dynamic programming
- Automatic complexity analysis of the submitted code
- External challenge packs (JSON files or a URL)
- AI-generated challenges
- Interview simulation mode: a timed set of 2–3 challenges with no assistance
- TypeScript / Python solutions
