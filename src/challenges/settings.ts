import { DEFAULT_STAR_THRESHOLDS, normalizeThresholds } from './scoring';
import {
  CORE_CATEGORIES,
  ChallengeCategory,
  ChallengeSelectionSettings,
  Difficulty,
  StarThresholds,
  isChallengeCategory,
  isDifficulty
} from './types';

/** Keys under the `shrimpCheck` configuration section. */
export const CHALLENGE_KEYS = {
  enabled: 'challenge.enabled',
  intervalMinutes: 'challenge.intervalMinutes',
  categories: 'challenge.categories',
  difficulties: 'challenge.difficulties',
  includePractical: 'challenge.includePractical',
  fiveStarMinutes: 'challenge.fiveStarMinutes',
  fourStarMinutes: 'challenge.fourStarMinutes',
  threeStarMinutes: 'challenge.threeStarMinutes',
  twoStarMinutes: 'challenge.twoStarMinutes'
} as const;

export const DEFAULT_INTERVAL_MINUTES = 60;
export const DEFAULT_DIFFICULTIES: Difficulty[] = ['easy', 'medium'];
export const DEFAULT_CATEGORIES: ChallengeCategory[] = [...CORE_CATEGORIES];

export interface ChallengeModeSettings extends ChallengeSelectionSettings {
  enabled: boolean;
  intervalMinutes: number;
  thresholds: StarThresholds;
}

/** Anything with a `get(key, fallback)` — vscode.WorkspaceConfiguration in practice. */
export interface ConfigReader {
  get<T>(key: string, defaultValue: T): T;
}

export function readChallengeSettings(config: ConfigReader): ChallengeModeSettings {
  const rawCategories = config.get<unknown>(CHALLENGE_KEYS.categories, DEFAULT_CATEGORIES);
  const rawDifficulties = config.get<unknown>(CHALLENGE_KEYS.difficulties, DEFAULT_DIFFICULTIES);
  const interval = config.get<number>(CHALLENGE_KEYS.intervalMinutes, DEFAULT_INTERVAL_MINUTES);

  return {
    enabled: config.get<boolean>(CHALLENGE_KEYS.enabled, false) === true,
    intervalMinutes: Number.isFinite(interval) ? Math.max(1, interval) : DEFAULT_INTERVAL_MINUTES,
    categories: Array.isArray(rawCategories) ? rawCategories.filter(isChallengeCategory) : DEFAULT_CATEGORIES,
    difficulties: Array.isArray(rawDifficulties) ? rawDifficulties.filter(isDifficulty) : DEFAULT_DIFFICULTIES,
    includePractical: config.get<boolean>(CHALLENGE_KEYS.includePractical, false) === true,
    thresholds: normalizeThresholds({
      five: config.get<number>(CHALLENGE_KEYS.fiveStarMinutes, DEFAULT_STAR_THRESHOLDS.five),
      four: config.get<number>(CHALLENGE_KEYS.fourStarMinutes, DEFAULT_STAR_THRESHOLDS.four),
      three: config.get<number>(CHALLENGE_KEYS.threeStarMinutes, DEFAULT_STAR_THRESHOLDS.three),
      two: config.get<number>(CHALLENGE_KEYS.twoStarMinutes, DEFAULT_STAR_THRESHOLDS.two)
    })
  };
}

/**
 * Interview Sprint preset. Applying it writes ordinary settings, so every value
 * stays editable afterwards.
 */
export const INTERVIEW_SPRINT_PRESET: Array<[string, unknown]> = [
  [CHALLENGE_KEYS.enabled, true],
  [
    CHALLENGE_KEYS.categories,
    ['strings', 'arrays', 'hashing', 'twoPointers', 'slidingWindow', 'stacksQueues', 'binarySearch']
  ],
  [CHALLENGE_KEYS.difficulties, ['easy', 'medium']],
  [CHALLENGE_KEYS.intervalMinutes, 30],
  [CHALLENGE_KEYS.fiveStarMinutes, 10],
  [CHALLENGE_KEYS.fourStarMinutes, 15],
  [CHALLENGE_KEYS.threeStarMinutes, 20],
  [CHALLENGE_KEYS.twoStarMinutes, 30]
];
