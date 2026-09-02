// Phase 4 configuration decisions (ghs#5), approved by the platform owner
// before implementation began, per ADR-210's own list of values it
// deliberately defers to the implementing application (points 5/7/8/12).
// Everything here is a fixed constant, not system_settings-configurable --
// the poll interval is the one exception (system-settings.service.ts's
// getNotificationPollIntervalSeconds), since ADR-210 point 6 specifically
// calls out poll interval as the kind of value worth making runtime-
// tunable, the way RMS already does.

// ADR-210 point 5: "a configurable backoff schedule expressed as a list
// of minute-offsets ... defaulting to RMS's proven [1, 5, 15] minutes".
// Total attempts allowed is this array's own length + 1 (the initial
// attempt, plus one retry per configured delay) -- see outbox-state.ts's
// own comment (PR #47 review fix: an earlier separate MAX_ATTEMPTS
// constant equal to this array's length left the last entry, 15 minutes,
// unreachable).
export const RETRY_BACKOFF_MINUTES: readonly number[] = [1, 5, 15];

// ADR-210 point 7: "a small multiple of expected provider-call latency".
// A real send completes in seconds; 5 minutes is generous headroom.
export const CRASH_RECOVERY_TIMEOUT_MINUTES = 5;

// ADR-210 point 8: sent/failed retention periods are not required to
// match -- failed (dead-letter) rows plausibly warrant a longer
// investigation window.
export const SENT_RETENTION_DAYS = 7;
export const FAILED_RETENTION_DAYS = 30;
// notification_history's own retention -- business-record audit value
// (ADR-210's own framing) outlives the technical outbox regardless.
export const HISTORY_RETENTION_DAYS = 365;

// ADR-210 point 6: "batch size ... [is an] App implementation choice" --
// left hardcoded (not system_settings-configurable) per the approved
// decision, matching RMS's own fixed value.
export const BATCH_SIZE = 20;

// Retention cleanup runs on a slower cadence than the poll loop itself --
// "bounded, low-frequency" per this issue's own scope. Tracked as an
// interval between passes, not a fixed clock schedule, so a worker that's
// been down doesn't burst-run consecutive missed passes on restart.
export const RETENTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
// Each retention DELETE is capped per pass -- a large accumulated backlog
// (e.g. after a long-idle worker) is worked off over several passes
// rather than one long lock-holding statement.
export const RETENTION_DELETE_BATCH_SIZE = 1000;

// ghs#195, confirmed with the platform owner: a fixed worker constant,
// not system_settings-configurable, matching the convention above (only
// the poll interval itself is runtime-tunable). 15 minutes gives the
// Admin Dashboard's 24h sparkline 96 real data points -- smooth enough to
// read as a line, small enough that a month of history is a few thousand
// rows, a trivial footprint.
export const PRESENCE_SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;
