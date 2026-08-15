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

export function nextOutboxState(
  currentAttempts: number,
  retryable: boolean,
  backoffMinutes: readonly number[],
  maxAttempts: number,
  now: Date = new Date(),
): OutboxNextState {
  const attempts = currentAttempts + 1;

  // Permanent failures never consume the retry schedule (ADR-210 point
  // 4) -- straight to failed regardless of how many attempts remain.
  // Retryable failures that have now exhausted the backoff schedule land
  // in the exact same terminal state (point 11: dead-letter is just
  // status='failed' in place, not a separate mechanism for either case).
  if (!retryable || attempts >= maxAttempts) {
    return { status: "failed", attempts, retryAfter: null };
  }

  // attempts is 1-indexed after the increment above; backoffMinutes[0] is
  // the delay before the 2nd attempt (i.e. after the 1st failure).
  const delayMinutes = backoffMinutes[attempts - 1]!;
  return { status: "pending", attempts, retryAfter: new Date(now.getTime() + delayMinutes * 60_000) };
}
