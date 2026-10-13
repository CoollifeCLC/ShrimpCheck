import { categoryScores } from './history';
import {
  Challenge,
  ChallengeAttempt,
  ChallengeSelectionSettings,
  isPracticalCategory
} from './types';

/** How many of the most recent attempts count as "recently seen". */
export const RECENT_WINDOW = 5;

/**
 * Challenges that match the enabled categories and difficulties.
 * Practical categories only count when `includePractical` is on.
 */
export function eligibleChallenges(
  challenges: Challenge[],
  settings: ChallengeSelectionSettings
): Challenge[] {
  const categories = new Set(settings.categories);
  const difficulties = new Set(settings.difficulties);

  return challenges.filter((challenge) => {
    if (!challenge.enabled) return false;
    if (!difficulties.has(challenge.difficulty)) return false;
    if (!categories.has(challenge.category)) return false;
    if (isPracticalCategory(challenge.category) && !settings.includePractical) return false;
    return true;
  });
}

/**
 * Simple weighted selection (no ML):
 *  - challenges seen in the last few attempts are strongly de-prioritised
 *  - challenges never attempted get a bonus
 *  - weaker categories (lower average star score) get more weight
 */
export function challengeWeight(challenge: Challenge, attempts: ChallengeAttempt[]): number {
  const recent = attempts.slice(-RECENT_WINDOW);
  const recentIndex = recent.map((attempt) => attempt.challengeId).lastIndexOf(challenge.id);
  const everAttempted = attempts.some((attempt) => attempt.challengeId === challenge.id);
  const categoryScore = categoryScores(attempts).get(challenge.category);

  let weight = 1;

  if (recentIndex !== -1) {
    // Most recent attempt → 0.05, older-but-still-recent → up to 0.25.
    const age = recent.length - recentIndex; // 1 = most recent
    weight *= 0.05 * age;
  } else if (!everAttempted) {
    weight *= 2;
  }

  // Unknown categories sit in the middle; a category averaging 1★ weighs ~1.8×,
  // one averaging 5★ weighs 1×.
  const weakness = categoryScore === undefined ? 0.5 : 1 - categoryScore;
  weight *= 1 + weakness;

  return weight;
}

export function selectChallenge(
  challenges: Challenge[],
  settings: ChallengeSelectionSettings,
  attempts: ChallengeAttempt[],
  random: () => number = Math.random
): Challenge | undefined {
  const pool = eligibleChallenges(challenges, settings);
  if (pool.length === 0) return undefined;

  const weights = pool.map((challenge) => challengeWeight(challenge, attempts));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;

  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return pool[i];
  }
  return pool[pool.length - 1];
}
