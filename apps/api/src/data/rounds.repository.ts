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

// ghs#147: the "My Rounds" list's own row shape -- same course/tee-name
// enrichment AdminRoundListItem already has (#100/#113), applied to the
// player's-own-rounds query instead. A separate type from RoundSummary
// above (not an extension of it) -- RoundSummary is also the building
// block toRound() spreads into the full Round aggregate (get/
// getForUpdate's own queries, neither of which joins courses/
// tee_configurations), so widening it would break those call sites.
export interface PlayerRoundListItem {
  id: string;
  playerId: string;
  courseId: string;
  courseName: string;
  teeConfigurationId: string;
  teeConfigurationName: string;
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

// ghs#100/#113: the general admin all-rounds browser -- same shape as
// PendingRoundQueueItem plus status, since (unlike the pending-only
// queue) this list spans every status.
// ghs#168: the score fields (grossScore/adjustedGrossScore/
// scoreDifferential/pcc) were added for the Daily PCC screen, which needs
// to show a tee-configuration/day's real submitted scores before any
// approval -- possible now that scoring happens at submission time, not
// approval. All four are null until a round has been scored at least once
// (draft, or amending since its last edit); that's a real absence, not a
// bug -- callers must not assume non-null.
export interface AdminRoundListItem {
  id: string;
  playerId: string;
  playerFirstName: string;
  playerLastName: string;
  courseId: string;
  courseName: string;
  teeConfigurationId: string;
  teeConfigurationName: string;
  playedAt: string;
  status: RoundStatus;
  grossScore: number | null;
  adjustedGrossScore: number | null;
  scoreDifferential: number | null;
  pcc: number | null;
}

export interface ListAdminRoundsFilter {
  status?: RoundStatus;
  playerId?: string;
  // ghs#168: scopes the list to one tee-configuration/day pair -- the
  // Daily PCC screen's own query shape, matching pcc.repository.ts's
  // getRoundInputsForDay (played_at::date comparison, so a plain
  // YYYY-MM-DD or a full ISO date-time both work).
  teeConfigurationId?: string;
  playedOn?: string;
  limit: number;
  offset: number;
}

export interface ListAdminRoundsResult {
  items: AdminRoundListItem[];
  total: number;
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
  // ghs#100: captured at creation time -- see migration 014's own doc
  // comment for why this isn't looked up live from users.role instead.
  // Optional/undefined stores NULL, same as every pre-existing round.
  createdByRole?: "player" | "admin" | "super_admin";
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

// ghs#101: the Dashboard module's Performance Statistics widgets --
// pure aggregation over an approved round's hole_scores, no WHS-engine
// business logic. Every percentage/average is null when roundsCount is
// 0 (nothing to divide by) or, for fairwayHit/MissedLeft/MissedRight
// specifically, when every recorded hole has a null fairway_result
// (e.g. a player who has only ever played holes where it doesn't apply)
// -- never NaN or a misleading 0.
//
// sandInteractionPercentage is deliberately NOT "average sand shots per
// round" (the Dashboard requirements doc's own original wording): in_sand
// is a per-hole boolean ("was the ball in sand on this hole"), not a shot
// count, so the only honest metric this data supports is "% of holes
// with a sand interaction." Named accordingly so a consuming frontend
// can't mislabel it as a shot count.
export interface PlayerStats {
  roundsCount: number;
  // ghs#176: the Dashboard's Activity widget pairs this with roundsCount
  // (rounds played / distinct courses played) -- added to this existing
  // query rather than a second round-trip, same join rounds.repository.ts's
  // own listByPlayer already has to make for course/tee names.
  coursesCount: number;
  holesCount: number;
  girPercentage: number | null;
  fairwayHitPercentage: number | null;
  fairwayMissedLeftPercentage: number | null;
  fairwayMissedRightPercentage: number | null;
  puttsPerRound: number | null;
  onePuttHoles: number;
  threePlusPuttHoles: number;
  penaltiesPerRound: number | null;
  sandInteractionPercentage: number | null;
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
  // ghs#92: submitForReview's completeness check needs this to know
  // whether "complete" means every hole in the tee configuration, or
  // (for a 9-hole round played on an 18-hole tee, which is_9_hole and
  // tee_configurations.hole_count can't distinguish from each other --
  // see the completeness rule at its call site) at least 9 scores.
  is9Hole: boolean;
  // ghs#100: submitForReview's auto-approval fast-path check.
  createdByRole: "player" | "admin" | "super_admin" | null;
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
  listByPlayer(playerId: string): Promise<PlayerRoundListItem[]>;
  // ghs#61: every round awaiting review, across all players -- the admin
  // pending-queue's own real query, not a filtered view of listByPlayer
  // (which is player-scoped) or get (which is single-round). Deliberately
  // narrow: no pagination/filtering/sorting parameters, matching the
  // approved scope (a purpose-built queue endpoint, not a general admin
  // rounds browser).
  listPendingQueue(): Promise<PendingRoundQueueItem[]>;
  // ghs#100/#113: the general admin all-rounds browser -- filterable by
  // status/player, paginated. A separate query from listPendingQueue
  // above, not a generalisation of it: that one stays purpose-built and
  // deliberately narrow for the pending-review workflow specifically.
  listAdminRounds(filter: ListAdminRoundsFilter): Promise<ListAdminRoundsResult>;
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
  // ghs#101: the Dashboard module's Performance Statistics widgets --
  // pure SQL aggregation over a player's approved rounds' hole_scores,
  // no WHS-engine business logic (see PlayerStats's own doc comment for
  // the sand-metric naming decision this issue explicitly requires).
  getPlayerStats(playerId: string): Promise<PlayerStats>;
  // SELECT ... FOR UPDATE -- requires a real transaction client (same
  // reasoning as HandicapHistoryRepository.getCurrentIndexForUpdate,
  // ghs#24: a lock taken outside an explicit transaction is meaningless).
  // Every workflow transition (ghs#23) locks the round row with this
  // before deciding anything, so two concurrent transitions on the same
  // round (e.g. an admin double-clicking "approve") can't race.
  getForUpdate(id: string, client: PoolClient): Promise<RoundForUpdate | null>;
  // ghs#100: a lightweight, lock-free read -- submitForReview's own
  // routing decision (admin-created fast path vs. the ordinary pending
  // transition) needs this before any transaction opens, so it can't
  // use getForUpdate (which requires one already). Returns null both
  // when the round doesn't exist and when no role was ever recorded --
  // neither case should route to the fast path, and a nonexistent round
  // is still caught correctly by whichever path's own real read runs
  // next.
  getCreatedByRole(id: string): Promise<"player" | "admin" | "super_admin" | null>;
  // ghs#92: the real count of distinct hole scores recorded so far --
  // submitForReview's completeness check needs a number to compare
  // against the tee configuration's hole count (or, for is9Hole, 9),
  // not the full hole_scores rows themselves.
  countHoleScores(roundId: string, client?: PoolClient): Promise<number>;
  // Bare status transition only -- no recalculation, no notification.
  // Those are real behaviour, orchestrated one layer up (ghs#23/24), not
  // this repository's. client: threaded through so a workflow
  // transition's status change and its recalculation can commit or roll
  // back together (ghs#24's atomicity requirement).
  setStatus(id: string, status: RoundStatus, rejectionReason?: string, client?: PoolClient): Promise<void>;
  // ghs#169: bare column update only -- no recalculation (none of the
  // statuses this is ever called from carry a differential that counts
  // toward handicap calculation; see rounds.service.ts's own
  // isDateEditableStatus). client: same row-locked-transaction threading
  // convention as setStatus above.
  updatePlayedAt(id: string, playedAt: string, client?: PoolClient): Promise<void>;
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

// ghs#92: upsert, not a plain INSERT -- hole_scores has UNIQUE(round_id,
// hole_number), and a mobile hole-by-hole entry UI needs to let a
// player correct a hole they already scored (e.g. a fat-fingered
// stroke count) while the round is still editable. Previously a
// re-POST of the same hole number threw a raw Postgres unique-violation
// that fell through to a generic 500 -- this makes the same call
// idempotent instead. The caller (rounds.service.ts's addHoleScore)
// still takes its row lock and isEditableStatus check first, on the
// same transaction, so this only ever fires while the round is
// genuinely still writable -- unchanged by this fix.
//
// Partial-update semantics on correction, not a full replace (review
// finding, PR #93): an omitted optional field (undefined -- the route
// already distinguishes this from an explicit false/0) keeps whatever
// was already recorded; only fields the caller actually provides
// overwrite it. Passing the raw $n parameter into the UPDATE branch's
// own COALESCE (against the row's *current* persisted value), not
// EXCLUDED.*, is what makes this work -- EXCLUDED already has the
// INSERT-branch's COALESCE-to-default applied, which would have thrown
// away the "was this actually provided" signal before the UPDATE
// branch ever saw it. strokes and net_double_bogey_adjusted are always
// required/server-computed (never omitted in practice), so they always
// overwrite -- no preserve-on-omission case exists for either.
async function insertHoleScore(
  client: Pool | PoolClient,
  roundId: string,
  input: CreateHoleScoreInput,
): Promise<HoleScore> {
  const result = await client.query<HoleScoreRow>(
    `INSERT INTO hole_scores (round_id, hole_number, strokes, putts, gir, fairway_result, in_sand, penalties, net_double_bogey_adjusted)
     VALUES ($1, $2, $3, $4, COALESCE($5, FALSE), $6, COALESCE($7, FALSE), COALESCE($8, 0), COALESCE($9, 0))
     ON CONFLICT (round_id, hole_number) DO UPDATE SET
       strokes = EXCLUDED.strokes,
       putts = COALESCE($4, hole_scores.putts),
       gir = COALESCE($5, hole_scores.gir),
       fairway_result = COALESCE($6, hole_scores.fairway_result),
       in_sand = COALESCE($7, hole_scores.in_sand),
       penalties = COALESCE($8, hole_scores.penalties),
       net_double_bogey_adjusted = EXCLUDED.net_double_bogey_adjusted
     RETURNING ${HOLE_SCORE_COLUMNS}`,
    [
      roundId,
      input.holeNumber,
      input.strokes,
      input.putts ?? null,
      input.gir ?? null,
      input.fairwayResult ?? null,
      input.inSand ?? null,
      input.penalties ?? null,
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
    `INSERT INTO rounds (player_id, tee_configuration_id, played_at, playing_handicap, is_tournament, is_9_hole, created_by_role, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
     RETURNING ${ROUND_COLUMNS}`,
    [
      input.playerId,
      input.teeConfigurationId,
      input.playedAt,
      input.playingHandicap ?? null,
      input.isTournament ?? false,
      input.is9Hole ?? false,
      input.createdByRole ?? null,
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
      // ghs#147: course/tee names joined in, same enrichment
      // listAdminRounds already does for the admin equivalent (#100/
      // #113) -- the "My Rounds" list needs this to render meaningfully
      // without an extra per-row fetch, and RoundSummary/toRoundSummary
      // deliberately stay untouched (see PlayerRoundListItem's own doc
      // comment for why).
      const result = await pool.query<{
        id: string;
        player_id: string;
        course_id: string;
        course_name: string;
        tee_configuration_id: string;
        tee_configuration_name: string;
        played_at: Date;
        status: RoundStatus;
      }>(
        `SELECT
           r.id, r.player_id,
           c.id AS course_id, c.name AS course_name,
           tc.id AS tee_configuration_id, tc.name AS tee_configuration_name,
           r.played_at, r.status
         FROM rounds r
         JOIN tee_configurations tc ON tc.id = r.tee_configuration_id
         JOIN courses c ON c.id = tc.course_id
         WHERE r.player_id = $1 AND r.deleted_at IS NULL
         ORDER BY r.played_at DESC, r.id ASC`,
        [playerId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        playerId: row.player_id,
        courseId: row.course_id,
        courseName: row.course_name,
        teeConfigurationId: row.tee_configuration_id,
        teeConfigurationName: row.tee_configuration_name,
        playedAt: row.played_at.toISOString(),
        status: row.status,
      }));
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
         -- is unrelated to how long it's been waiting for review). r.id
         -- as a stable tie-breaker: Postgres's now() is constant for the
         -- whole transaction (not per-statement), and even across
         -- separate transactions two submissions can land within the
         -- same timestamp resolution -- without a tie-breaker, rows with
         -- an identical updated_at would sort in a non-deterministic,
         -- potentially different order on every call (review finding,
         -- PR #76). id itself carries no ordering meaning (UUIDs aren't
         -- sequential) -- this only makes ties deterministic, not
         -- "more correct" among genuinely-simultaneous submissions,
         -- which have no real distinguishable order anyway.
         ORDER BY r.updated_at ASC, r.id ASC`,
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

    async listAdminRounds(filter) {
      const conditions: string[] = ["r.deleted_at IS NULL"];
      const values: unknown[] = [];

      if (filter.status) {
        values.push(filter.status);
        conditions.push(`r.status = $${values.length}`);
      }
      if (filter.playerId) {
        values.push(filter.playerId);
        conditions.push(`r.player_id = $${values.length}`);
      }
      if (filter.teeConfigurationId) {
        values.push(filter.teeConfigurationId);
        conditions.push(`r.tee_configuration_id = $${values.length}`);
      }
      if (filter.playedOn) {
        values.push(filter.playedOn);
        conditions.push(`r.played_at::date = $${values.length}::date`);
      }
      const whereClause = conditions.join(" AND ");

      const countResult = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM rounds r
         WHERE ${whereClause}`,
        values,
      );
      const total = Number(countResult.rows[0]!.count);

      values.push(filter.limit, filter.offset);
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
        status: RoundStatus;
        gross_score: number | null;
        adjusted_gross_score: number | null;
        score_differential: string | null;
        pcc: number | null;
      }>(
        `SELECT
           r.id, r.player_id, p.first_name AS player_first_name, p.last_name AS player_last_name,
           c.id AS course_id, c.name AS course_name,
           tc.id AS tee_configuration_id, tc.name AS tee_configuration_name,
           r.played_at, r.status,
           r.gross_score, r.adjusted_gross_score, r.score_differential, r.pcc
         FROM rounds r
         JOIN players p ON p.id = r.player_id
         JOIN tee_configurations tc ON tc.id = r.tee_configuration_id
         JOIN courses c ON c.id = tc.course_id
         WHERE ${whereClause}
         ORDER BY r.played_at DESC, r.id ASC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values,
      );

      return {
        items: result.rows.map((row) => ({
          id: row.id,
          playerId: row.player_id,
          playerFirstName: row.player_first_name,
          playerLastName: row.player_last_name,
          courseId: row.course_id,
          courseName: row.course_name,
          teeConfigurationId: row.tee_configuration_id,
          teeConfigurationName: row.tee_configuration_name,
          playedAt: row.played_at.toISOString(),
          status: row.status,
          grossScore: row.gross_score,
          adjustedGrossScore: row.adjusted_gross_score,
          scoreDifferential: row.score_differential === null ? null : Number(row.score_differential),
          pcc: row.pcc,
        })),
        total,
      };
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

    async getPlayerStats(playerId) {
      // Scoped to approved rounds only, matching listApprovedDifferentials
      // ForPlayer's own reasoning -- a round only genuinely represents the
      // player's play once it's been approved, not while still draft/
      // pending/rejected/amending. Postgres itself always returns exactly
      // one row for an aggregate query with no GROUP BY, even when the
      // JOIN matches nothing (count(*) = 0, sum(...) = NULL, which the
      // coalesce()s below turn into 0) -- the `?? { ...defaults }` below
      // exists only to satisfy TypeScript's own (necessarily more
      // conservative) `T | undefined` typing of result.rows[0], not
      // because Postgres could genuinely return zero rows here (review
      // finding: an earlier version of this comment claimed the latter).
      const result = await pool.query<{
        rounds_count: number;
        courses_count: number;
        holes_count: number;
        gir_holes: number;
        fairway_relevant_holes: number;
        fairway_hit_holes: number;
        fairway_missed_left_holes: number;
        fairway_missed_right_holes: number;
        sand_holes: number;
        one_putt_holes: number;
        three_plus_putt_holes: number;
        total_putts: number;
        total_penalties: number;
      }>(
        `SELECT
           count(DISTINCT r.id)::int AS rounds_count,
           count(DISTINCT tc.course_id)::int AS courses_count,
           count(*)::int AS holes_count,
           count(*) FILTER (WHERE hs.gir)::int AS gir_holes,
           count(*) FILTER (WHERE hs.fairway_result IS NOT NULL)::int AS fairway_relevant_holes,
           count(*) FILTER (WHERE hs.fairway_result = 'hit')::int AS fairway_hit_holes,
           count(*) FILTER (WHERE hs.fairway_result = 'missed_left')::int AS fairway_missed_left_holes,
           count(*) FILTER (WHERE hs.fairway_result = 'missed_right')::int AS fairway_missed_right_holes,
           count(*) FILTER (WHERE hs.in_sand)::int AS sand_holes,
           count(*) FILTER (WHERE hs.putts = 1)::int AS one_putt_holes,
           count(*) FILTER (WHERE hs.putts >= 3)::int AS three_plus_putt_holes,
           coalesce(sum(hs.putts) FILTER (WHERE hs.putts IS NOT NULL), 0)::int AS total_putts,
           coalesce(sum(hs.penalties), 0)::int AS total_penalties
         FROM hole_scores hs
         JOIN rounds r ON r.id = hs.round_id
         JOIN tee_configurations tc ON tc.id = r.tee_configuration_id
         WHERE r.player_id = $1 AND r.status = 'approved' AND r.deleted_at IS NULL`,
        [playerId],
      );

      const row = result.rows[0] ?? {
        rounds_count: 0, courses_count: 0, holes_count: 0, gir_holes: 0, fairway_relevant_holes: 0,
        fairway_hit_holes: 0, fairway_missed_left_holes: 0, fairway_missed_right_holes: 0,
        sand_holes: 0, one_putt_holes: 0, three_plus_putt_holes: 0, total_putts: 0, total_penalties: 0,
      };

      // Null rather than NaN/a misleading 0 whenever there's nothing to
      // divide by -- same defensive convention as computeScoreDifferential
      // (scoring.service.ts), though that one stores 3 decimal places for
      // its own real WHS-precision reasons, unrelated to this. One
      // decimal here instead, matching the frontend's own established
      // *display* rounding for this kind of stat (Stat components
      // elsewhere already format handicap index/score differential to
      // one decimal for on-screen presentation) -- these are Dashboard
      // display values, not a stored calculation input, so display
      // precision is the right thing to match (review finding: an
      // earlier version of this comment wrongly cited score-differential
      // storage precision instead).
      const percentage = (count: number, denominator: number): number | null =>
        denominator === 0 ? null : Number(((count / denominator) * 100).toFixed(1));
      const averagePerRound = (total: number): number | null =>
        row.rounds_count === 0 ? null : Number((total / row.rounds_count).toFixed(1));

      return {
        roundsCount: row.rounds_count,
        coursesCount: row.courses_count,
        holesCount: row.holes_count,
        girPercentage: percentage(row.gir_holes, row.holes_count),
        fairwayHitPercentage: percentage(row.fairway_hit_holes, row.fairway_relevant_holes),
        fairwayMissedLeftPercentage: percentage(row.fairway_missed_left_holes, row.fairway_relevant_holes),
        fairwayMissedRightPercentage: percentage(row.fairway_missed_right_holes, row.fairway_relevant_holes),
        puttsPerRound: averagePerRound(row.total_putts),
        onePuttHoles: row.one_putt_holes,
        threePlusPuttHoles: row.three_plus_putt_holes,
        penaltiesPerRound: averagePerRound(row.total_penalties),
        sandInteractionPercentage: percentage(row.sand_holes, row.holes_count),
      };
    },

    async getForUpdate(id, client) {
      const result = await client.query<{
        id: string;
        player_id: string;
        tee_configuration_id: string;
        played_at: Date;
        status: RoundStatus;
        score_differential: string | null;
        is_9_hole: boolean;
        created_by_role: "player" | "admin" | "super_admin" | null;
      }>(
        `SELECT id, player_id, tee_configuration_id, played_at, status, score_differential, is_9_hole, created_by_role
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
        is9Hole: row.is_9_hole,
        createdByRole: row.created_by_role,
      };
    },

    async getCreatedByRole(id) {
      const result = await pool.query<{ created_by_role: "player" | "admin" | "super_admin" | null }>(
        "SELECT created_by_role FROM rounds WHERE id = $1 AND deleted_at IS NULL",
        [id],
      );
      return result.rows[0]?.created_by_role ?? null;
    },

    async countHoleScores(roundId, client) {
      const result = await (client ?? pool).query<{ count: string }>(
        "SELECT count(*)::text AS count FROM hole_scores WHERE round_id = $1",
        [roundId],
      );
      return Number(result.rows[0]!.count);
    },

    async setStatus(id, status, rejectionReason, client) {
      await (client ?? pool).query(
        `UPDATE rounds SET status = $2, rejection_reason = $3, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [id, status, rejectionReason ?? null],
      );
    },

    async updatePlayedAt(id, playedAt, client) {
      await (client ?? pool).query(
        `UPDATE rounds SET played_at = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [id, playedAt],
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
