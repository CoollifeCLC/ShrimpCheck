// Challenge Mode data model. This module is intentionally free of any `vscode`
// import so the scoring, selection, runner, and history logic can be unit
// tested in plain Node.

export const CORE_CATEGORIES = [
  'strings',
  'arrays',
  'hashing',
  'twoPointers',
  'slidingWindow',
  'stacksQueues',
  'binarySearch',
  'recursion',
  'trees'
] as const;

export const PRACTICAL_CATEGORIES = ['api', 'jsFundamentals', 'async', 'regex', 'debugging'] as const;

export type CoreCategory = (typeof CORE_CATEGORIES)[number];
export type PracticalCategory = (typeof PRACTICAL_CATEGORIES)[number];
export type ChallengeCategory = CoreCategory | PracticalCategory;

export const CATEGORY_LABELS: Record<ChallengeCategory, string> = {
  strings: 'Strings',
  arrays: 'Arrays',
  hashing: 'Hash Maps / Sets',
  twoPointers: 'Two Pointers',
  slidingWindow: 'Sliding Window',
  stacksQueues: 'Stacks / Queues',
  binarySearch: 'Binary Search',
  recursion: 'Recursion',
  trees: 'Trees',
  api: 'API',
  jsFundamentals: 'JavaScript Fundamentals',
  async: 'Async / Promises',
  regex: 'Regex',
  debugging: 'Debugging'
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard'
};

export type AssistanceKind = 'pattern' | 'hint' | 'approach';
export const ASSISTANCE_KINDS: readonly AssistanceKind[] = ['pattern', 'hint', 'approach'];

export interface ChallengeExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface ChallengeTest {
  /** Arguments passed to the solution function. Cloned fresh for every run. */
  args: unknown[];
  /** Expected value (the return value, or the mutated argument for in-place problems). */
  expected: unknown;
  /** Hidden tests only run on Submit, never on Run Tests. */
  hidden?: boolean;
  /**
   * How to compare.
   * - `deep` (default): structural equality of the return value
   * - `sorted`: sort both arrays before comparing (order-independent answers)
   */
  compare?: 'deep' | 'sorted';
  /** For in-place problems: index of the argument whose final state is checked. */
  inPlaceArg?: number;
}

export interface Challenge {
  id: string;
  title: string;
  difficulty: Difficulty;
  category: ChallengeCategory;
  description: string;
  examples: ChallengeExample[];
  constraints: string[];
  /** Name of the function the starter code defines and the tests call. */
  functionName: string;
  starterCode: string;
  tests: ChallengeTest[];
  /**
   * Optional helper code evaluated before the user's solution (e.g. a fake
   * `fetchProfile` for async challenges). Must only declare functions.
   */
  setup?: string;
  pattern: string;
  hint: string;
  approach: string;
  expectedTimeComplexity: string;
  expectedSpaceComplexity: string;
  tags: string[];
  enabled: boolean;
}

export interface StarThresholds {
  /** Minutes at or under which a correct solution earns 5 stars. */
  five: number;
  four: number;
  three: number;
  two: number;
}

export interface ChallengeAttempt {
  challengeId: string;
  category: ChallengeCategory;
  difficulty: Difficulty;
  startedAt: number;
  completedAt: number;
  elapsedMs: number;
  correct: boolean;
  /** Final star score, 0 when not solved correctly. */
  stars: number;
  assistance: AssistanceKind[];
  /** Number of Submit presses in this attempt (incorrect ones included). */
  submissions: number;
  outcome: 'solved' | 'abandoned';
}

export interface ChallengeSelectionSettings {
  categories: ChallengeCategory[];
  difficulties: Difficulty[];
  includePractical: boolean;
}

export function isPracticalCategory(category: ChallengeCategory): category is PracticalCategory {
  return (PRACTICAL_CATEGORIES as readonly string[]).includes(category);
}

export function isChallengeCategory(value: unknown): value is ChallengeCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, value);
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}
