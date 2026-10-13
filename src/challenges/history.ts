import {
  AssistanceKind,
  ChallengeAttempt,
  ChallengeCategory,
  isChallengeCategory,
  isDifficulty
} from './types';

export const ATTEMPTS_KEY = 'shrimpCheck.challenge.attempts';
export const ACTIVE_SESSION_KEY = 'shrimpCheck.challenge.activeSession';
export const MAX_STORED_ATTEMPTS = 500;

/** The subset of vscode.Memento used here, so tests can pass a plain fake. */
export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

export function loadAttempts(state: MementoLike): ChallengeAttempt[] {
  const raw = state.get<unknown>(ATTEMPTS_KEY, []);
  return Array.isArray(raw) ? raw.filter(isAttempt) : [];
}

/**
 * Appends an attempt and prunes to the newest MAX_STORED_ATTEMPTS.
 * globalState is a small key/value store, not a database.
 */
export async function recordAttempt(state: MementoLike, attempt: ChallengeAttempt): Promise<ChallengeAttempt[]> {
  const attempts = [...loadAttempts(state), attempt];
  const pruned = attempts.slice(-MAX_STORED_ATTEMPTS);
  await state.update(ATTEMPTS_KEY, pruned);
  return pruned;
}

function isAttempt(value: unknown): value is ChallengeAttempt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ChallengeAttempt>;
  return (
    typeof v.challengeId === 'string' &&
    isChallengeCategory(v.category) &&
    isDifficulty(v.difficulty) &&
    typeof v.startedAt === 'number' &&
    typeof v.elapsedMs === 'number' &&
    typeof v.correct === 'boolean' &&
    typeof v.stars === 'number'
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────

export interface CategoryStat {
  category: ChallengeCategory;
  attempts: number;
  solved: number;
  /** Average stars / 5 across attempts (unsolved attempts count as 0), 0..1. */
  score: number;
}

export interface ChallengeStats {
  totalAttempts: number;
  totalSolved: number;
  averageSolveMs: number | undefined;
  fiveStarCount: number;
  /** Consecutive local days, ending today or yesterday, with at least one solve. */
  currentStreakDays: number;
  byCategory: CategoryStat[];
  assistanceUsage: Record<AssistanceKind, number>;
}

export function computeStats(attempts: ChallengeAttempt[], now: number = Date.now()): ChallengeStats {
  const solved = attempts.filter((attempt) => attempt.correct);
  const categoryMap = new Map<ChallengeCategory, CategoryStat>();

  for (const attempt of attempts) {
    const stat =
      categoryMap.get(attempt.category) ??
      ({ category: attempt.category, attempts: 0, solved: 0, score: 0 } as CategoryStat);
    stat.attempts += 1;
    if (attempt.correct) stat.solved += 1;
    stat.score += (attempt.correct ? attempt.stars : 0) / 5;
    categoryMap.set(attempt.category, stat);
  }

  const byCategory = [...categoryMap.values()]
    .map((stat) => ({ ...stat, score: stat.attempts > 0 ? stat.score / stat.attempts : 0 }))
    .sort((a, b) => b.attempts - a.attempts || a.category.localeCompare(b.category));

  const assistanceUsage: Record<AssistanceKind, number> = { pattern: 0, hint: 0, approach: 0 };
  for (const attempt of attempts) {
    for (const kind of attempt.assistance ?? []) {
      if (kind in assistanceUsage) assistanceUsage[kind] += 1;
    }
  }

  return {
    totalAttempts: attempts.length,
    totalSolved: solved.length,
    averageSolveMs:
      solved.length > 0 ? solved.reduce((sum, attempt) => sum + attempt.elapsedMs, 0) / solved.length : undefined,
    fiveStarCount: solved.filter((attempt) => attempt.stars === 5).length,
    currentStreakDays: computeDayStreak(solved.map((attempt) => attempt.completedAt), now),
    byCategory,
    assistanceUsage
  };
}

/** Category score lookup for adaptive selection: undefined when never attempted. */
export function categoryScores(attempts: ChallengeAttempt[]): Map<ChallengeCategory, number> {
  return new Map(computeStats(attempts).byCategory.map((stat) => [stat.category, stat.score]));
}

function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function computeDayStreak(solveTimes: number[], now: number): number {
  if (solveTimes.length === 0) return 0;

  const days = new Set(solveTimes.map(localDayKey));
  const cursor = new Date(now);
  cursor.setHours(12, 0, 0, 0);

  // A streak is still alive if the last solve was yesterday.
  if (!days.has(localDayKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(localDayKey(cursor.getTime()))) return 0;
  }

  let streak = 0;
  while (days.has(localDayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
