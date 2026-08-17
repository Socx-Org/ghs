import type { Pool, PoolClient } from "pg";

export type FairwayResult = "hit" | "missed_left" | "missed_right";
// 'draft': player is still entering scores, not yet submitted for
// review (ghs#58) -- distinct from 'pending' so creating a round never
// itself places it in the admin approval queue. 'amending': an approved
// round reopened for correction (ghs#23) -- distinct from 'pending' so
// "awaiting first approval" and "was approved, now under correction"
// stay distinguishable.
export type RoundStatus = "draft" | "pending" | "approved" | "rejected" | "amending";

export interface HoleScore {
  id: string;
  holeNumber: number;
  strokes: number;
  putts: number | null;
  gir: boolean;
  fairwayResult: FairwayResult | null;
  inSand: boolean;
  penalties: number;
  netDoubleBogeyAdjusted: number;
}

export interface Round {
  id: string;
  playerId: string;
  teeConfigurationId: string;
  playedAt: string;
  playingHandicap: number | null;
  grossScore: number | null;
  adjustedGrossScore: number | null;
  scoreDifferential: number | null;
  pcc: number | null;
  totalPutts: number | null;
  totalGir: number | null;
  totalFairwaysHit: number | null;
  totalPenalties: number | null;
  isTournament: boolean;
  is9Hole: boolean;
  status: RoundStatus;
  rejectionReason: string | null;
  holeScores: HoleScore[];
}

export interface RoundSummary {
  id: string;
  playerId: string;
  teeConfigurationId: string;
  playedAt: string;
  status: RoundStatus;
}

// ghs#61: a purpose-built, lightweight projection for the admin pending-
// review queue -- deliberately not the full Round aggregate (no hole
// scores, no score fields an admin doesn't need just to decide which
// round to open next). Exactly the fields a queue row needs to render,
// per the approved scope: round id, player identity, course, tee
// configuration, played date.
export interface PendingRoundQueueItem {
  id: string;
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  courseId: string;
  courseName: string;
  teeConfigurationId: string;
  teeConfigurationName: string;
  playedAt: string;
}

export interface CreateHoleScoreInput {
  holeNumber: number;
  strokes: number;
  putts?: number;
  gir?: boolean;
  fairwayResult?: FairwayResult;
  inSand?: boolean;
  penalties?: number;
  netDoubleBogeyAdjusted?: number;
}

export interface CreateRoundInput {
  playerId: string;
  teeConfigurationId: string;
  playedAt: string;
  playingHandicap?: number;
  isTournament?: boolean;
  is9Hole?: boolean;
  // Optional -- real gameplay enters holes incrementally (open question
  // resolved, ghs#9); a round may be created with zero hole scores and
  // have them added one at a time via addHoleScore.
  holeScores?: CreateHoleScoreInput[];
}

// The WHS-calculated/aggregate round fields (gross_score, adjusted_gross_
// score, score_differential, total_putts, total_gir, total_fairways_hit,
// total_penalties) are not set at creation time -- gross_score and the
// total_* aggregates are naturally derived from hole_scores once a round
// is complete, and adjusted_gross_score/score_differential require the
// tee configuration's course/slope rating and system_settings' PCC
// override to compute. All of that is Phase 2's calculation logic, not
// this issue's. This method exists so the repository layer can actually
// store and retrieve those values once Phase 2 computes them -- without
// it, the schema's own columns would be write-only-by-nobody, which is
// what "round-trip through the repository layer" in this issue's own
// Domain Behaviour Verification criterion requires, found and fixed
// before claiming that criterion met.
export interface RoundScoreUpdate {
  grossScore?: number;
  adjustedGrossScore?: number;
  scoreDifferential?: number;
  pcc?: number;
  totalPutts?: number;
  totalGir?: number;
  totalFairwaysHit?: number;
  totalPenalties?: number;
}

// Structurally identical to whs-calculation.ts's RoundDifferentialInput
// (application layer) -- the data layer doesn't import business-logic
// types (ADR-060), but the shape lines up so the orchestrator (ghs#24)
// can pass this straight into calculateHandicapIndex/
// buildEffectiveDifferentials with no transformation.
export interface RoundDifferentialRow {
  roundId: string;
  playedAt: string;
  scoreDifferential: number;
  is9Hole: boolean;
}

// The minimal shape a workflow transition (approve/reject/delete/reopen)
// actually needs to decide what to do and what to recalculate --
// deliberately narrower than Round (no hole_scores fetch, which a
// workflow decision never needs).
export interface RoundForUpdate {
  id: string;
  playerId: string;
  teeConfigurationId: string;
  playedAt: string;
  status: RoundStatus;
  scoreDifferential: number | null;
}

export interface RoundsRepository {
  // client: when provided, every statement here (including the round and
  // its hole scores) runs on it and this method does NOT open, commit,
  // or roll back a transaction -- the caller owns that. This is what
  // lets ghs#25's "round_submitted" notification write land in the SAME
  // transaction as the round's own creation (ADR-210 point 1), the same
  // client-threading convention already established for setStatus/
  // softDelete (ghs#23) and recordChange (ghs#24). Omitted, this method
  // manages its own self-contained transaction exactly as before --
  // existing callers are unaffected.
  create(input: CreateRoundInput, client?: PoolClient): Promise<Round>;
  // client: same optional-participation convention as create() above --
  // threaded through so ghs#58's status guard (rounds.service.ts) can
  // take a real row lock (getForUpdate) and this insert on the SAME
  // client/transaction, closing the race between checking the round's
  // status and writing the hole score (review finding, PR #73).
  addHoleScore(roundId: string, input: CreateHoleScoreInput, client?: PoolClient): Promise<HoleScore>;
  updateScores(id: string, update: RoundScoreUpdate): Promise<Round>;
  get(id: string): Promise<Round | null>;
  listByPlayer(playerId: string): Promise<RoundSummary[]>;
  // ghs#61: every round awaiting review, across all players -- the admin
  // pending-queue's own real query, not a filtered view of listByPlayer
  // (which is player-scoped) or get (which is single-round). Deliberately
  // narrow: no pagination/filtering/sorting parameters, matching the
  // approved scope (a purpose-built queue endpoint, not a general admin
  // rounds browser).
  listPendingQueue(): Promise<PendingRoundQueueItem[]>;
  // Every approved round with a real differential -- the exact input the
  // WHS calculation engine (ghs#22) needs. Excludes anything without a
  // score_differential yet (unscored, or scoring not yet run) and
  // anything not currently 'approved' -- a round's contribution to a
  // player's handicap only counts while it's in that state.
  // client: when provided, the read runs on it instead of the pool --
  // lets a caller (ghs#24's orchestrator, given an external client) keep
  // this inside its own transaction, so the approved-round set can't
  // change between this read and the recalculation it feeds into.
  listApprovedDifferentialsForPlayer(playerId: string, client?: Pool | PoolClient): Promise<RoundDifferentialRow[]>;
  // SELECT ... FOR UPDATE -- requires a real transaction client (same
  // reasoning as HandicapHistoryRepository.getCurrentIndexForUpdate,
  // ghs#24: a lock taken outside an explicit transaction is meaningless).
  // Every workflow transition (ghs#23) locks the round row with this
  // before deciding anything, so two concurrent transitions on the same
  // round (e.g. an admin double-clicking "approve") can't race.
  getForUpdate(id: string, client: PoolClient): Promise<RoundForUpdate | null>;
  // Bare status transition only -- no recalculation, no notification.
  // Those are real behaviour, orchestrated one layer up (ghs#23/24), not
  // this repository's. client: threaded through so a workflow
  // transition's status change and its recalculation can commit or roll
  // back together (ghs#24's atomicity requirement).
  setStatus(id: string, status: RoundStatus, rejectionReason?: string, client?: PoolClient): Promise<void>;
  // Soft delete (rounds.deleted_at), matching the players/clubs
  // convention. No return value -- callers already have the round's
  // pre-deletion state from getForUpdate, called just before this.
  softDelete(id: string, client?: PoolClient): Promise<void>;
}

interface RoundRow {
  id: string;
  player_id: string;
  tee_configuration_id: string;
  played_at: Date;
  playing_handicap: string | null;
  gross_score: number | null;
  adjusted_gross_score: number | null;
  score_differential: string | null;
  pcc: number | null;
  total_putts: number | null;
  total_gir: number | null;
  total_fairways_hit: number | null;
  total_penalties: number | null;
  is_tournament: boolean;
  is_9_hole: boolean;
  status: RoundStatus;
  rejection_reason: string | null;
}

interface HoleScoreRow {
  id: string;
  round_id: string;
  hole_number: number;
  strokes: number;
  putts: number | null;
  gir: boolean;
  fairway_result: FairwayResult | null;
  in_sand: boolean;
  penalties: number;
  net_double_bogey_adjusted: number;
}

function toHoleScore(row: HoleScoreRow): HoleScore {
  return {
    id: row.id,
    holeNumber: row.hole_number,
    strokes: row.strokes,
    putts: row.putts,
    gir: row.gir,
    fairwayResult: row.fairway_result,
    inSand: row.in_sand,
    penalties: row.penalties,
    netDoubleBogeyAdjusted: row.net_double_bogey_adjusted,
  };
}

function toRoundSummary(row: RoundRow): RoundSummary {
  return {
    id: row.id,
    playerId: row.player_id,
    teeConfigurationId: row.tee_configuration_id,
    playedAt: row.played_at.toISOString(),
    status: row.status,
  };
}

function toRound(row: RoundRow, holeScores: HoleScore[]): Round {
  return {
    ...toRoundSummary(row),
    playingHandicap: row.playing_handicap === null ? null : Number(row.playing_handicap),
    grossScore: row.gross_score,
    adjustedGrossScore: row.adjusted_gross_score,
    scoreDifferential: row.score_differential === null ? null : Number(row.score_differential),
    pcc: row.pcc,
    totalPutts: row.total_putts,
    totalGir: row.total_gir,
    totalFairwaysHit: row.total_fairways_hit,
    totalPenalties: row.total_penalties,
    isTournament: row.is_tournament,
    is9Hole: row.is_9_hole,
    rejectionReason: row.rejection_reason,
    holeScores,
  };
}

const ROUND_COLUMNS = `id, player_id, tee_configuration_id, played_at, playing_handicap, gross_score,
  adjusted_gross_score, score_differential, pcc, total_putts, total_gir, total_fairways_hit, total_penalties,
  is_tournament, is_9_hole, status, rejection_reason`;

const HOLE_SCORE_COLUMNS = `id, round_id, hole_number, strokes, putts, gir, fairway_result, in_sand,
  penalties, net_double_bogey_adjusted`;

async function insertHoleScore(
  client: Pool | PoolClient,
  roundId: string,
  input: CreateHoleScoreInput,
): Promise<HoleScore> {
  const result = await client.query<HoleScoreRow>(
    `INSERT INTO hole_scores (round_id, hole_number, strokes, putts, gir, fairway_result, in_sand, penalties, net_double_bogey_adjusted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${HOLE_SCORE_COLUMNS}`,
    [
      roundId,
      input.holeNumber,
      input.strokes,
      input.putts ?? null,
      input.gir ?? false,
      input.fairwayResult ?? null,
      input.inSand ?? false,
      input.penalties ?? 0,
      input.netDoubleBogeyAdjusted ?? 0,
    ],
  );
  return toHoleScore(result.rows[0]!);
}

// Runs the round + hole-scores insert sequence on whichever client it's
// given -- no transaction boundaries of its own (same convention as
// handicap-history.repository.ts's runRecordChange/recalculation.
// service.ts's runRecalculation).
async function runCreate(client: PoolClient, input: CreateRoundInput): Promise<Round> {
  const roundResult = await client.query<RoundRow>(
    `INSERT INTO rounds (player_id, tee_configuration_id, played_at, playing_handicap, is_tournament, is_9_hole, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft')
     RETURNING ${ROUND_COLUMNS}`,
    [
      input.playerId,
      input.teeConfigurationId,
      input.playedAt,
      input.playingHandicap ?? null,
      input.isTournament ?? false,
      input.is9Hole ?? false,
    ],
  );
  const roundRow = roundResult.rows[0]!;

  const holeScores: HoleScore[] = [];
  for (const holeInput of input.holeScores ?? []) {
    holeScores.push(await insertHoleScore(client, roundRow.id, holeInput));
  }

  return toRound(roundRow, holeScores);
}

export function createRoundsRepository(pool: Pool): RoundsRepository {
  return {
    async create(input, externalClient) {
      if (externalClient) {
        // Caller-managed: no transaction opened or committed here, and
        // errors propagate so the caller's own transaction rolls back
        // (ghs#25's round_submitted notification write joins this same
        // transaction).
        return runCreate(externalClient, input);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const round = await runCreate(client, input);
        await client.query("COMMIT");
        return round;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async addHoleScore(roundId, input, client) {
      return insertHoleScore(client ?? pool, roundId, input);
    },

    async updateScores(id, update) {
      const columns: Record<keyof RoundScoreUpdate, string> = {
        grossScore: "gross_score",
        adjustedGrossScore: "adjusted_gross_score",
        scoreDifferential: "score_differential",
        pcc: "pcc",
        totalPutts: "total_putts",
        totalGir: "total_gir",
        totalFairwaysHit: "total_fairways_hit",
        totalPenalties: "total_penalties",
      };

      const setClauses: string[] = [];
      const values: unknown[] = [id];
      for (const [key, column] of Object.entries(columns) as [keyof RoundScoreUpdate, string][]) {
        if (update[key] !== undefined) {
          values.push(update[key]);
          setClauses.push(`${column} = $${values.length}`);
        }
      }

      const roundResult = setClauses.length === 0
        ? await pool.query<RoundRow>(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE id = $1 AND deleted_at IS NULL`, [id])
        : await pool.query<RoundRow>(
            `UPDATE rounds SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING ${ROUND_COLUMNS}`,
            values,
          );
      if (roundResult.rows.length === 0) throw new Error("round not found");

      const holeScoresResult = await pool.query<HoleScoreRow>(
        `SELECT ${HOLE_SCORE_COLUMNS} FROM hole_scores WHERE round_id = $1 ORDER BY hole_number`,
        [id],
      );
      return toRound(roundResult.rows[0]!, holeScoresResult.rows.map(toHoleScore));
    },

    async get(id) {
      const roundResult = await pool.query<RoundRow>(
        `SELECT ${ROUND_COLUMNS} FROM rounds WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      const roundRow = roundResult.rows[0];
      if (!roundRow) return null;

      const holeScoresResult = await pool.query<HoleScoreRow>(
        `SELECT ${HOLE_SCORE_COLUMNS} FROM hole_scores WHERE round_id = $1 ORDER BY hole_number`,
        [id],
      );

      return toRound(roundRow, holeScoresResult.rows.map(toHoleScore));
    },

    async listByPlayer(playerId) {
      const result = await pool.query<RoundRow>(
        `SELECT ${ROUND_COLUMNS} FROM rounds WHERE player_id = $1 AND deleted_at IS NULL ORDER BY played_at DESC`,
        [playerId],
      );
      return result.rows.map(toRoundSummary);
    },

    async listPendingQueue() {
      const result = await pool.query<{
        id: string;
        player_id: string;
        player_first_name: string;
        player_last_name: string;
        course_id: string;
        course_name: string;
        tee_configuration_id: string;
        tee_configuration_name: string;
        played_at: Date;
      }>(
        `SELECT
           r.id, r.player_id, p.first_name AS player_first_name, p.last_name AS player_last_name,
           c.id AS course_id, c.name AS course_name,
           tc.id AS tee_configuration_id, tc.name AS tee_configuration_name,
           r.played_at
         FROM rounds r
         JOIN players p ON p.id = r.player_id
         JOIN tee_configurations tc ON tc.id = r.tee_configuration_id
         JOIN courses c ON c.id = tc.course_id
         WHERE r.status = 'pending' AND r.deleted_at IS NULL
         -- Oldest submission first (updated_at is set the moment a round
         -- transitions to 'pending', ghs#58's setStatus) -- a real FIFO
         -- queue order, not played_at (when the round was played, which
         -- is unrelated to how long it's been waiting for review).
         ORDER BY r.updated_at ASC`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        playerId: row.player_id,
        playerFirstName: row.player_first_name,
        playerLastName: row.player_last_name,
        courseId: row.course_id,
        courseName: row.course_name,
        teeConfigurationId: row.tee_configuration_id,
        teeConfigurationName: row.tee_configuration_name,
        playedAt: row.played_at.toISOString(),
      }));
    },

    async listApprovedDifferentialsForPlayer(playerId, client) {
      const result = await (client ?? pool).query<{ id: string; played_at: Date; score_differential: string; is_9_hole: boolean }>(
        `SELECT id, played_at, score_differential, is_9_hole
         FROM rounds
         WHERE player_id = $1
           AND status = 'approved'
           AND score_differential IS NOT NULL
           AND deleted_at IS NULL
         ORDER BY played_at DESC`,
        [playerId],
      );
      return result.rows.map((row) => ({
        roundId: row.id,
        playedAt: row.played_at.toISOString(),
        scoreDifferential: Number(row.score_differential),
        is9Hole: row.is_9_hole,
      }));
    },

    async getForUpdate(id, client) {
      const result = await client.query<{
        id: string;
        player_id: string;
        tee_configuration_id: string;
        played_at: Date;
        status: RoundStatus;
        score_differential: string | null;
      }>(
        `SELECT id, player_id, tee_configuration_id, played_at, status, score_differential
         FROM rounds
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [id],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        playerId: row.player_id,
        teeConfigurationId: row.tee_configuration_id,
        playedAt: row.played_at.toISOString(),
        status: row.status,
        scoreDifferential: row.score_differential === null ? null : Number(row.score_differential),
      };
    },

    async setStatus(id, status, rejectionReason, client) {
      await (client ?? pool).query(
        `UPDATE rounds SET status = $2, rejection_reason = $3, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [id, status, rejectionReason ?? null],
      );
    },

    async softDelete(id, client) {
      await (client ?? pool).query(
        `UPDATE rounds SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
    },
  };
}
