import type { Pool, PoolClient } from "pg";

export type FairwayResult = "hit" | "missed_left" | "missed_right";
export type RoundStatus = "pending" | "approved" | "rejected";

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

export interface RoundsRepository {
  create(input: CreateRoundInput): Promise<Round>;
  addHoleScore(roundId: string, input: CreateHoleScoreInput): Promise<HoleScore>;
  get(id: string): Promise<Round | null>;
  listByPlayer(playerId: string): Promise<RoundSummary[]>;
  // Bare status transition only -- no recalculation, no notification.
  // Those are real behaviour, explicitly Phase 2's scope, not this
  // repository's.
  setStatus(id: string, status: RoundStatus, rejectionReason?: string): Promise<void>;
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
    isTournament: row.is_tournament,
    is9Hole: row.is_9_hole,
    rejectionReason: row.rejection_reason,
    holeScores,
  };
}

const ROUND_COLUMNS = `id, player_id, tee_configuration_id, played_at, playing_handicap, gross_score,
  adjusted_gross_score, score_differential, is_tournament, is_9_hole, status, rejection_reason`;

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

export function createRoundsRepository(pool: Pool): RoundsRepository {
  return {
    async create(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const roundResult = await client.query<RoundRow>(
          `INSERT INTO rounds (player_id, tee_configuration_id, played_at, playing_handicap, is_tournament, is_9_hole)
           VALUES ($1, $2, $3, $4, $5, $6)
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

        await client.query("COMMIT");
        return toRound(roundRow, holeScores);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async addHoleScore(roundId, input) {
      return insertHoleScore(pool, roundId, input);
    },

    async get(id) {
      const roundResult = await pool.query<RoundRow>(
        `SELECT ${ROUND_COLUMNS} FROM rounds WHERE id = $1`,
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
        `SELECT ${ROUND_COLUMNS} FROM rounds WHERE player_id = $1 ORDER BY played_at DESC`,
        [playerId],
      );
      return result.rows.map(toRoundSummary);
    },

    async setStatus(id, status, rejectionReason) {
      await pool.query(
        `UPDATE rounds SET status = $2, rejection_reason = $3, updated_at = now() WHERE id = $1`,
        [id, status, rejectionReason ?? null],
      );
    },
  };
}
