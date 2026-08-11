import type { Pool } from "pg";

export type PccSource = "calculated" | "override";

export interface DailyPcc {
  id: string;
  teeConfigurationId: string;
  playedOn: string; // YYYY-MM-DD
  pcc: number;
  source: PccSource;
  updatedBy: string | null;
  updatedAt: string;
}

export interface RoundDifferentialInput {
  roundId: string;
  adjustedGrossScore: number;
  courseRating: number;
  slopeRating: number;
}

export interface PccRepository {
  // Cheap, idempotent, defaults to pcc=0/source='calculated' if no row
  // exists yet for this tee-configuration/day -- never touches rounds.
  // Intended for round-submission time (a later issue's concern): "what's
  // today's PCC to stamp on this new round," not a recalculation trigger.
  getOrCreateDailyPcc(teeConfigurationId: string, playedOn: string): Promise<DailyPcc>;

  // Every round played at this tee-configuration on this day that has a
  // computed adjusted_gross_score -- the same real-data filter legacy's
  // own calculation used, confirmed by direct reading of legacy's
  // services/pcc.ts.
  getRoundInputsForDay(teeConfigurationId: string, playedOn: string): Promise<RoundDifferentialInput[]>;

  // Upserts the daily PCC row and bulk-rewrites every affected round's
  // pcc/score_differential in one transaction. A round's differential
  // must never disagree with its tee-configuration/day's finalised PCC --
  // that invariant is what makes this one atomic operation rather than
  // two independent writes.
  upsertAndApply(
    teeConfigurationId: string,
    playedOn: string,
    pcc: number,
    source: PccSource,
    updatedBy: string | null,
  ): Promise<{ dailyPcc: DailyPcc; updatedRounds: number }>;
}

interface DailyPccRow {
  id: string;
  tee_configuration_id: string;
  played_on: string;
  pcc: number;
  source: PccSource;
  updated_by: string | null;
  updated_at: Date;
}

// DATE columns are cast to ::text in every query below -- node-pg's
// default DATE parsing returns a JS Date object at local-timezone
// midnight, a well-known source of off-by-one-day bugs. Casting to text
// keeps played_on a plain, unambiguous 'YYYY-MM-DD' string end to end.
const DAILY_PCC_COLUMNS = `id, tee_configuration_id, played_on::text AS played_on, pcc, source, updated_by, updated_at`;

function toDailyPcc(row: DailyPccRow): DailyPcc {
  return {
    id: row.id,
    teeConfigurationId: row.tee_configuration_id,
    playedOn: row.played_on,
    pcc: row.pcc,
    source: row.source,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function createPccRepository(pool: Pool): PccRepository {
  return {
    async getOrCreateDailyPcc(teeConfigurationId, playedOn) {
      // A single atomic statement -- ON CONFLICT DO UPDATE with a
      // no-op-in-effect SET avoids a separate SELECT-then-INSERT race
      // between two concurrent callers for the same tee-configuration/day.
      const result = await pool.query<DailyPccRow>(
        `INSERT INTO tee_configuration_daily_pcc (tee_configuration_id, played_on, pcc, source)
         VALUES ($1, $2::date, 0, 'calculated')
         ON CONFLICT (tee_configuration_id, played_on) DO UPDATE
           SET tee_configuration_id = tee_configuration_daily_pcc.tee_configuration_id
         RETURNING ${DAILY_PCC_COLUMNS}`,
        [teeConfigurationId, playedOn],
      );
      return toDailyPcc(result.rows[0]!);
    },

    async getRoundInputsForDay(teeConfigurationId, playedOn) {
      const result = await pool.query<{
        round_id: string;
        adjusted_gross_score: number;
        course_rating: string;
        slope_rating: number;
      }>(
        `SELECT r.id AS round_id, r.adjusted_gross_score, tc.course_rating, tc.slope_rating
         FROM rounds r
         INNER JOIN tee_configurations tc ON tc.id = r.tee_configuration_id
         WHERE r.tee_configuration_id = $1
           AND r.played_at::date = $2::date
           AND r.adjusted_gross_score IS NOT NULL`,
        [teeConfigurationId, playedOn],
      );
      return result.rows.map((row) => ({
        roundId: row.round_id,
        adjustedGrossScore: row.adjusted_gross_score,
        courseRating: Number(row.course_rating),
        slopeRating: row.slope_rating,
      }));
    },

    async upsertAndApply(teeConfigurationId, playedOn, pcc, source, updatedBy) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const dailyPccResult = await client.query<DailyPccRow>(
          `INSERT INTO tee_configuration_daily_pcc (tee_configuration_id, played_on, pcc, source, updated_by, updated_at)
           VALUES ($1, $2::date, $3, $4, $5, now())
           ON CONFLICT (tee_configuration_id, played_on) DO UPDATE
             SET pcc = EXCLUDED.pcc, source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now()
           RETURNING ${DAILY_PCC_COLUMNS}`,
          [teeConfigurationId, playedOn, pcc, source, updatedBy],
        );

        const applyResult = await client.query(
          `UPDATE rounds r
           SET pcc = $3::smallint,
               score_differential = ROUND(
                 ((113::numeric / tc.slope_rating::numeric) * (r.adjusted_gross_score - tc.course_rating - $3::numeric)),
                 3
               ),
               updated_at = now()
           FROM tee_configurations tc
           WHERE tc.id = r.tee_configuration_id
             AND r.tee_configuration_id = $1
             AND r.played_at::date = $2::date
             AND r.adjusted_gross_score IS NOT NULL`,
          [teeConfigurationId, playedOn, pcc],
        );

        await client.query("COMMIT");
        return {
          dailyPcc: toDailyPcc(dailyPccResult.rows[0]!),
          updatedRounds: applyResult.rowCount ?? 0,
        };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
