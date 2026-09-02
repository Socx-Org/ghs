import type { Pool } from "pg";

// ghs#195: aggregate-only historical presence data for the Admin
// Dashboard's Active Right Now sparkline. Deliberately never a per-user
// row -- users.repository.ts's own countActiveNow doc comment records
// that the design review already rejected exposing *who* is active as a
// materially different, more sensitive feature than a bare count. This
// table carries that same constraint forward: snapshot_at + active_count,
// nothing else.
//
// Written by apps/worker's poll loop (presence-snapshot.service.ts) every
// 15 minutes; read by apps/api's dashboard.service.ts to build the
// sparkline series. Shared here (like users.repository.ts and
// system-settings.repository.ts already are) rather than duplicated.

export interface PresenceSnapshotSeriesPoint {
  timestamp: string;
  count: number;
}

export interface PresenceSnapshotsRepository {
  insertSnapshot(activeCount: number): Promise<void>;
  // ghs#195's own cold-start problem: getSeries always returns a
  // zero-filled bucket whether a real snapshot recorded zero active users
  // or no snapshot exists there at all -- the two are indistinguishable
  // from series data alone. This is the one bit the dashboard needs to
  // tell "genuinely zero" apart from "no history collected yet" (there's
  // no way to backfill data that predates this feature shipping).
  hasAnySnapshot(): Promise<boolean>;
  // Zero-filled, fixed-width buckets covering [rangeStart, rangeEnd) --
  // a gap in real snapshot coverage (before this feature shipped, or a
  // worker outage) reads as a genuine zero, never silently omitted or
  // interpolated. Each bucket's value is the average active_count of
  // whatever real snapshots fall inside it, rounded to the nearest
  // integer -- there's no single "the" active count for a 1-hour or
  // 1-day bucket, only a representative one. bucketInterval is a literal
  // Postgres interval string ("15 minutes" / "1 hour" / "1 day").
  getSeries(rangeStart: Date, rangeEnd: Date, bucketInterval: string): Promise<PresenceSnapshotSeriesPoint[]>;
}

export function createPresenceSnapshotsRepository(pool: Pool): PresenceSnapshotsRepository {
  return {
    async insertSnapshot(activeCount) {
      // now() in SQL, not a JS Date passed down -- same convention as
      // users.repository.ts's own updateLastActiveAt, avoids any app/DB
      // clock-skew question entirely.
      await pool.query("INSERT INTO presence_snapshots (snapshot_at, active_count) VALUES (now(), $1)", [activeCount]);
    },

    async hasAnySnapshot() {
      const result = await pool.query("SELECT 1 FROM presence_snapshots LIMIT 1");
      return result.rowCount !== null && result.rowCount > 0;
    },

    async getSeries(rangeStart, rangeEnd, bucketInterval) {
      // Same generate_series-LEFT-JOIN-aggregated technique as
      // users.repository.ts's getRegistrationTrend. Unlike that method's
      // own DATE-typed bucket column (which needs an explicit ::text
      // cast to sidestep node-postgres's local-timezone DATE parsing --
      // see that method's own comment), bucket_start here is TIMESTAMPTZ
      // throughout: node-postgres parses that type into a JS Date
      // representing the correct absolute instant regardless of session
      // timezone, so .toISOString() below is already correct with no
      // equivalent cast needed.
      const result = await pool.query<{ bucket_start: Date; active_count: number }>(
        `WITH aggregated AS (
           SELECT date_bin($3::interval, snapshot_at, $1::timestamptz) AS bucket_start,
                  round(avg(active_count))::int AS active_count
           FROM presence_snapshots
           WHERE snapshot_at >= $1::timestamptz AND snapshot_at < $2::timestamptz
           GROUP BY 1
         )
         SELECT gs.bucket_start, coalesce(a.active_count, 0)::int AS active_count
         FROM generate_series($1::timestamptz, $2::timestamptz - $3::interval, $3::interval) AS gs(bucket_start)
         LEFT JOIN aggregated a ON a.bucket_start = gs.bucket_start
         ORDER BY gs.bucket_start ASC`,
        [rangeStart, rangeEnd, bucketInterval],
      );
      return result.rows.map((row) => ({ timestamp: row.bucket_start.toISOString(), count: row.active_count }));
    },
  };
}
