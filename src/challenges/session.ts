import { RunSummary } from './runner';
import { ScoreBreakdown, currentMaxStars, scoreAttempt } from './scoring';
import { AssistanceKind, Challenge, ChallengeAttempt, StarThresholds } from './types';

export interface SessionSnapshot {
  challengeId: string;
  startedAt: number;
  assistance: AssistanceKind[];
  submissions: number;
}

export interface SubmitOutcome {
  run: RunSummary;
  score: ScoreBreakdown;
  elapsedMs: number;
  /** Present only when the submission was correct and the attempt is complete. */
  attempt?: ChallengeAttempt;
}

/**
 * One challenge attempt in progress. Pure state — no timers, no UI.
 *
 * Time only affects star eligibility. Nothing here ever fails or closes the
 * session because time ran out; an attempt ends only when the user submits a
 * correct solution or abandons it.
 */
export class ChallengeSession {
  readonly challenge: Challenge;
  readonly startedAt: number;
  private readonly used = new Set<AssistanceKind>();
  private submitCount = 0;
  private finished = false;

  constructor(challenge: Challenge, startedAt: number, snapshot?: Partial<SessionSnapshot>) {
    this.challenge = challenge;
    this.startedAt = snapshot?.startedAt ?? startedAt;
    for (const kind of snapshot?.assistance ?? []) this.used.add(kind);
    this.submitCount = snapshot?.submissions ?? 0;
  }

  get assistance(): AssistanceKind[] {
    // Stable order regardless of click order.
    return (['pattern', 'hint', 'approach'] as AssistanceKind[]).filter((kind) => this.used.has(kind));
  }

  get submissions(): number {
    return this.submitCount;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  elapsedMs(now: number): number {
    return Math.max(0, now - this.startedAt);
  }

  useAssistance(kind: AssistanceKind): string {
    this.used.add(kind);
    switch (kind) {
      case 'pattern':
        return this.challenge.pattern;
      case 'hint':
        return this.challenge.hint;
      case 'approach':
        return this.challenge.approach;
    }
  }

  maxStarsNow(now: number, thresholds: StarThresholds): number {
    return currentMaxStars(this.elapsedMs(now), this.used, thresholds);
  }

  /**
   * Records a submission. A correct run completes the attempt; an incorrect
   * run scores 0 and leaves the session open so the user can keep going.
   */
  submit(run: RunSummary, now: number, thresholds: StarThresholds): SubmitOutcome {
    this.submitCount += 1;
    const elapsedMs = this.elapsedMs(now);
    const score = scoreAttempt({
      correct: run.allPassed,
      elapsedMs,
      assistance: this.used,
      thresholds
    });

    if (!run.allPassed) {
      return { run, score, elapsedMs };
    }

    this.finished = true;
    return { run, score, elapsedMs, attempt: this.toAttempt(now, true, score.stars) };
  }

  /** Attempt record for a session closed without a correct solution. */
  abandon(now: number): ChallengeAttempt {
    this.finished = true;
    return this.toAttempt(now, false, 0);
  }

  snapshot(): SessionSnapshot {
    return {
      challengeId: this.challenge.id,
      startedAt: this.startedAt,
      assistance: this.assistance,
      submissions: this.submitCount
    };
  }

  private toAttempt(now: number, correct: boolean, stars: number): ChallengeAttempt {
    return {
      challengeId: this.challenge.id,
      category: this.challenge.category,
      difficulty: this.challenge.difficulty,
      startedAt: this.startedAt,
      completedAt: now,
      elapsedMs: this.elapsedMs(now),
      correct,
      stars,
      assistance: this.assistance,
      submissions: this.submitCount,
      outcome: correct ? 'solved' : 'abandoned'
    };
  }
}
