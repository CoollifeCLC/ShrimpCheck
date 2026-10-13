import { AssistanceKind, StarThresholds } from './types';

export const DEFAULT_STAR_THRESHOLDS: StarThresholds = {
  five: 10,
  four: 15,
  three: 20,
  two: 30
};

/** Maximum star rating allowed after each kind of assistance. Lowest cap wins. */
export const ASSISTANCE_CAPS: Record<AssistanceKind, number> = {
  pattern: 4,
  hint: 3,
  approach: 2
};

export const MAX_STARS = 5;

/**
 * Normalises user-provided thresholds: every value must be a positive finite
 * number and the sequence must be non-decreasing. Invalid values fall back to
 * the default for that tier, then the whole set is made monotonic.
 */
export function normalizeThresholds(raw: Partial<StarThresholds> | undefined): StarThresholds {
  const pick = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

  const five = pick(raw?.five, DEFAULT_STAR_THRESHOLDS.five);
  const four = Math.max(five, pick(raw?.four, DEFAULT_STAR_THRESHOLDS.four));
  const three = Math.max(four, pick(raw?.three, DEFAULT_STAR_THRESHOLDS.three));
  const two = Math.max(three, pick(raw?.two, DEFAULT_STAR_THRESHOLDS.two));

  return { five, four, three, two };
}

/** Raw timing score in stars (1-5), ignoring correctness and assistance. */
export function timingStars(elapsedMs: number, thresholds: StarThresholds): number {
  const minutes = Math.max(0, elapsedMs) / 60_000;

  if (minutes <= thresholds.five) return 5;
  if (minutes <= thresholds.four) return 4;
  if (minutes <= thresholds.three) return 3;
  if (minutes <= thresholds.two) return 2;
  return 1;
}

/** The lowest cap among the assistance used. No assistance → 5. */
export function assistanceCap(assistance: Iterable<AssistanceKind>): number {
  let cap = MAX_STARS;
  for (const kind of assistance) {
    cap = Math.min(cap, ASSISTANCE_CAPS[kind] ?? MAX_STARS);
  }
  return cap;
}

export interface ScoreInput {
  correct: boolean;
  elapsedMs: number;
  assistance: Iterable<AssistanceKind>;
  thresholds: StarThresholds;
}

export interface ScoreBreakdown {
  correct: boolean;
  rawTimingStars: number;
  cap: number;
  /** 0 when incorrect — an incorrect solution never receives a completion rating. */
  stars: number;
}

/**
 * Final score. Correctness gates everything: an incorrect solution gets 0 no
 * matter how fast. Assistance caps the rating rather than subtracting from it.
 */
export function scoreAttempt(input: ScoreInput): ScoreBreakdown {
  const rawTimingStars = timingStars(input.elapsedMs, input.thresholds);
  const cap = assistanceCap(input.assistance);

  return {
    correct: input.correct,
    rawTimingStars,
    cap,
    stars: input.correct ? Math.min(rawTimingStars, cap) : 0
  };
}

/** The best rating still reachable right now, used for the live "max ★" display. */
export function currentMaxStars(
  elapsedMs: number,
  assistance: Iterable<AssistanceKind>,
  thresholds: StarThresholds
): number {
  return Math.min(timingStars(elapsedMs, thresholds), assistanceCap(assistance));
}

export function renderStars(stars: number): string {
  const filled = Math.max(0, Math.min(MAX_STARS, Math.round(stars)));
  return '★'.repeat(filled) + '☆'.repeat(MAX_STARS - filled);
}

export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
