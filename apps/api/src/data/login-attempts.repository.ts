import type { Pool, PoolClient } from "pg";

// ghs#231: real failure modes, read directly off auth.service.ts's own
// login/completeMfaLogin -- not invented. 'mfa_required' is the one
// non-failure, non-complete-success outcome: the password step
// genuinely succeeded, a real, auditable fact distinct from either
// extreme.
export type LoginAttemptOutcome = "success" | "invalid_credentials" | "account_not_active" | "mfa_required" | "invalid_mfa_code";

// ghs#231: a session's current status, derived live from
// refresh_tokens (never stored) -- see list()'s own doc comment for
// exactly how.
export type LoginSessionStatus = "active" | "expired" | "logged_out";

export interface RecordLoginAttemptInput {
  email: string;
  userId: string | null;
  outcome: LoginAttemptOutcome;
  ipAddress: string;
  // Set only for a 'success' outcome -- every other outcome never
  // established a session at all.
  sessionId: string | null;
  // ghs#236: the raw User-Agent request header -- a forensic breadcrumb,
  // not a trust/security control (trivially spoofable, same as
  // ipAddress already is). Null when the request had no such header.
  userAgent: string | null;
}

export interface LoginAttemptRecord {
  id: string;
  email: string;
  userId: string | null;
  outcome: LoginAttemptOutcome;
  ipAddress: string;
  // ghs#232 (geo-IP enrichment): always null until that issue lands.
  country: string | null;
  region: string | null;
  city: string | null;
  sessionId: string | null;
  createdAt: string;
  // Only ever populated for a 'success' row -- null for every
  // failure/mfa_required row, which never had a session to begin with.
  sessionStatus: LoginSessionStatus | null;
  sessionEndedAt: string | null;
  userAgent: string | null;
}

export interface ListLoginAttemptsPage {
  items: LoginAttemptRecord[];
  total: number;
}

export interface LoginAttemptsRepository {
  // Optional client, defaulting to the pool -- unlike
  // notifications.repository.ts's own record() (always called from
  // within an already-open transaction, ADR-210), login()/
  // completeMfaLogin() have no transaction of their own to join; a
  // standalone write here is the simpler, correct default (worst case
  // on a rare failure: a session exists with no audit row, a minor
  // historical-record gap, not a security or data-integrity issue).
  record(input: RecordLoginAttemptInput, client?: Pool | PoolClient): Promise<void>;
  list(limit: number, offset: number): Promise<ListLoginAttemptsPage>;
}

interface LoginAttemptRow {
  id: string;
  email: string;
  user_id: string | null;
  outcome: LoginAttemptOutcome;
  ip_address: string;
  country: string | null;
  region: string | null;
  city: string | null;
  session_id: string | null;
  created_at: Date;
  user_agent: string | null;
  // From the LEFT JOIN against refresh_tokens -- both null when
  // session_id is null (every non-'success' row) or, defensively, when
  // the joined row genuinely doesn't exist any more (e.g. a hard-deleted
  // user cascades its refresh_tokens away).
  session_revoked_at: Date | null;
  session_expires_at: Date | null;
}

function toRecord(row: LoginAttemptRow): LoginAttemptRecord {
  let sessionStatus: LoginSessionStatus | null = null;
  let sessionEndedAt: string | null = null;
  if (row.outcome === "success" && row.session_expires_at) {
    if (row.session_revoked_at) {
      sessionStatus = "logged_out";
      sessionEndedAt = row.session_revoked_at.toISOString();
    } else if (row.session_expires_at.getTime() < Date.now()) {
      sessionStatus = "expired";
      sessionEndedAt = row.session_expires_at.toISOString();
    } else {
      sessionStatus = "active";
    }
  }

  return {
    id: row.id,
    email: row.email,
    userId: row.user_id,
    outcome: row.outcome,
    ipAddress: row.ip_address,
    country: row.country,
    region: row.region,
    city: row.city,
    sessionId: row.session_id,
    createdAt: row.created_at.toISOString(),
    sessionStatus,
    sessionEndedAt,
    userAgent: row.user_agent,
  };
}

export function createLoginAttemptsRepository(pool: Pool): LoginAttemptsRepository {
  return {
    async record(input, client) {
      await (client ?? pool).query(
        `INSERT INTO login_attempts (email, user_id, outcome, ip_address, session_id, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.email, input.userId, input.outcome, input.ipAddress, input.sessionId, input.userAgent],
      );
    },

    async list(limit, offset) {
      const countResult = await pool.query<{ count: string }>("SELECT COUNT(*) FROM login_attempts");
      const total = Number(countResult.rows[0]!.count);

      // rt.rotated_at IS NULL selects the CURRENT (not-yet-superseded)
      // row for that session_id -- exactly one such row exists for the
      // lifetime of any session that was ever created (every rotation
      // replaces the live row with a new live row, 1:1; see migration
      // 020's own doc comment), so this always finds the session's real,
      // up-to-date revoked_at/expires_at, regardless of how many times
      // it's rotated since the login this row records.
      //
      // la.id ASC is a real tiebreaker, not decoration (review finding) --
      // Postgres's now() is constant for the whole transaction, not
      // per-statement, so a burst of attempts in the same transaction
      // (or just within the same timestamp's real resolution, e.g.
      // credential-stuffing) can genuinely share created_at. Without a
      // tiebreaker, those rows sort in a non-deterministic order on
      // every call, and an admin paging with LIMIT/OFFSET can silently
      // skip or duplicate rows across pages -- same reasoning as
      // rounds.repository.ts's own ORDER BY ..., r.id ASC. id itself
      // carries no ordering meaning (UUIDs aren't sequential); this only
      // makes ties deterministic, not "more correct" among genuinely-
      // simultaneous attempts, which have no real distinguishable order.
      const result = await pool.query<LoginAttemptRow>(
        `SELECT la.id, la.email, la.user_id, la.outcome, la.ip_address, la.country, la.region, la.city, la.session_id, la.created_at, la.user_agent,
                rt.revoked_at AS session_revoked_at, rt.expires_at AS session_expires_at
         FROM login_attempts la
         LEFT JOIN refresh_tokens rt ON rt.session_id = la.session_id AND rt.rotated_at IS NULL
         ORDER BY la.created_at DESC, la.id ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      return { items: result.rows.map(toRecord), total };
    },
  };
}
