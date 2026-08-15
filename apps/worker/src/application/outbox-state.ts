// Pure, DB-free state transition logic (ADR-060: layered, independently
// testable units) -- given a row's current attempts count and whether the
// failure that just happened is retryable, decides the row's next state.
// Used both by a real delivery failure and by the crash-recovery sweep
// (which always passes retryable=true, per ADR-210 point 7: a reclaim is
// conservatively classified as retryable, never permanent, since the
// worker can't know whether the crashed attempt actually succeeded).

export type OutboxNextState =
  | { status: "pending"; attempts: number; retryAfter: Date }
  | { status: "failed"; attempts: number; retryAfter: null };

// No separate maxAttempts parameter (PR #47 review fix): the backoff
// schedule's own length IS the retry budget -- total attempts allowed is
// backoffMinutes.length + 1 (the initial attempt, plus one retry per
// configured delay). A previous version took maxAttempts = backoffMinutes.
// length (3) as a separate constant, which meant the schedule's own last
// entry (15 minutes) could never actually be reached -- attempts=3 already
// failed before backoffMinutes[2] was ever read. Deriving the cutoff from
// the array itself makes that class of drift impossible: every configured
// delay is now genuinely used, and there is nothing left to keep in sync.
export function nextOutboxState(
  currentAttempts: number,
  retryable: boolean,
  backoffMinutes: readonly number[],
  now: Date = new Date(),
): OutboxNextState {
  const attempts = currentAttempts + 1;
  const delayMinutes = backoffMinutes[attempts - 1];

  // Permanent failures never consume the retry schedule (ADR-210 point
  // 4) -- straight to failed regardless of how many attempts remain.
  // Retryable failures that have now exhausted the backoff schedule
  // (no delay configured for this attempt number) land in the exact
  // same terminal state (point 11: dead-letter is just status='failed'
  // in place, not a separate mechanism for either case).
  if (!retryable || delayMinutes === undefined) {
    return { status: "failed", attempts, retryAfter: null };
  }

  return { status: "pending", attempts, retryAfter: new Date(now.getTime() + delayMinutes * 60_000) };
}
