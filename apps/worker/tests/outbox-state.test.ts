import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOutboxState } from "../src/application/outbox-state.ts";

// Pure unit tests -- no DB, no fakes needed (ENG-030.3).
const BACKOFF = [1, 5, 15];
const MAX_ATTEMPTS = 3;
const NOW = new Date("2026-08-16T12:00:00.000Z");

test("a permanent failure goes straight to failed, regardless of remaining attempts (ADR-210 point 4)", () => {
  const next = nextOutboxState(0, false, BACKOFF, MAX_ATTEMPTS, NOW);
  assert.deepEqual(next, { status: "failed", attempts: 1, retryAfter: null });
});

test("a retryable failure on the first attempt schedules a retry using the first backoff minute", () => {
  const next = nextOutboxState(0, true, BACKOFF, MAX_ATTEMPTS, NOW);
  assert.equal(next.status, "pending");
  assert.equal(next.attempts, 1);
  assert.equal(next.retryAfter!.getTime(), NOW.getTime() + 1 * 60_000);
});

test("a retryable failure on the second attempt uses the second backoff minute", () => {
  const next = nextOutboxState(1, true, BACKOFF, MAX_ATTEMPTS, NOW);
  assert.equal(next.status, "pending");
  assert.equal(next.attempts, 2);
  assert.equal(next.retryAfter!.getTime(), NOW.getTime() + 5 * 60_000);
});

test("a retryable failure that reaches max attempts becomes failed -- same terminal state as a permanent failure (ADR-210 point 11, in-place dead-letter)", () => {
  const next = nextOutboxState(2, true, BACKOFF, MAX_ATTEMPTS, NOW);
  assert.deepEqual(next, { status: "failed", attempts: 3, retryAfter: null });
});

test("a crash-recovery reclaim (always retryable, ADR-210 point 7) still exhausts the schedule and becomes failed once attempts are used up", () => {
  // Simulates 3 consecutive crashes: each one is a real, counted attempt.
  let attempts = 0;
  let state = nextOutboxState(attempts, true, BACKOFF, MAX_ATTEMPTS, NOW);
  assert.equal(state.status, "pending");
  attempts = state.attempts;

  state = nextOutboxState(attempts, true, BACKOFF, MAX_ATTEMPTS, NOW);
  assert.equal(state.status, "pending");
  attempts = state.attempts;

  state = nextOutboxState(attempts, true, BACKOFF, MAX_ATTEMPTS, NOW);
  assert.deepEqual(state, { status: "failed", attempts: 3, retryAfter: null });
});
