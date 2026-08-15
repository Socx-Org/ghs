import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOutboxState } from "../src/application/outbox-state.ts";

// Pure unit tests -- no DB, no fakes needed (ENG-030.3).
const BACKOFF = [1, 5, 15];
const NOW = new Date("2026-08-16T12:00:00.000Z");

test("a permanent failure goes straight to failed, regardless of remaining backoff entries (ADR-210 point 4)", () => {
  const next = nextOutboxState(0, false, BACKOFF, NOW);
  assert.deepEqual(next, { status: "failed", attempts: 1, retryAfter: null });
});

test("a retryable failure on the first attempt schedules a retry using the first backoff minute", () => {
  const next = nextOutboxState(0, true, BACKOFF, NOW);
  assert.equal(next.status, "pending");
  assert.equal(next.attempts, 1);
  assert.equal(next.retryAfter!.getTime(), NOW.getTime() + 1 * 60_000);
});

test("a retryable failure on the second attempt uses the second backoff minute", () => {
  const next = nextOutboxState(1, true, BACKOFF, NOW);
  assert.equal(next.status, "pending");
  assert.equal(next.attempts, 2);
  assert.equal(next.retryAfter!.getTime(), NOW.getTime() + 5 * 60_000);
});

test("a retryable failure on the third attempt uses the third (last) backoff minute -- every configured delay is reachable (PR #47 review fix)", () => {
  const next = nextOutboxState(2, true, BACKOFF, NOW);
  assert.equal(next.status, "pending");
  assert.equal(next.attempts, 3);
  assert.equal(next.retryAfter!.getTime(), NOW.getTime() + 15 * 60_000);
});

test("a retryable failure once the backoff schedule is exhausted (no delay configured for this attempt) becomes failed -- same terminal state as a permanent failure (ADR-210 point 11, in-place dead-letter)", () => {
  const next = nextOutboxState(3, true, BACKOFF, NOW);
  assert.deepEqual(next, { status: "failed", attempts: 4, retryAfter: null });
});

test("total attempts allowed is backoffMinutes.length + 1 -- the initial attempt plus one retry per configured delay, all three delays reachable", () => {
  let attempts = 0;
  for (const expectedDelay of BACKOFF) {
    const state = nextOutboxState(attempts, true, BACKOFF, NOW);
    assert.equal(state.status, "pending");
    assert.equal(state.retryAfter!.getTime(), NOW.getTime() + expectedDelay * 60_000);
    attempts = state.attempts;
  }
  // One more failure exhausts the schedule.
  const final = nextOutboxState(attempts, true, BACKOFF, NOW);
  assert.deepEqual(final, { status: "failed", attempts: 4, retryAfter: null });
});

test("a crash-recovery reclaim (always retryable, ADR-210 point 7) still exhausts the schedule and becomes failed once every backoff entry is used up", () => {
  // Simulates 4 consecutive crashes: each one is a real, counted attempt.
  let attempts = 0;
  let state = nextOutboxState(attempts, true, BACKOFF, NOW);
  assert.equal(state.status, "pending");
  attempts = state.attempts;

  state = nextOutboxState(attempts, true, BACKOFF, NOW);
  assert.equal(state.status, "pending");
  attempts = state.attempts;

  state = nextOutboxState(attempts, true, BACKOFF, NOW);
  assert.equal(state.status, "pending");
  attempts = state.attempts;

  state = nextOutboxState(attempts, true, BACKOFF, NOW);
  assert.deepEqual(state, { status: "failed", attempts: 4, retryAfter: null });
});
