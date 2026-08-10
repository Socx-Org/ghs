import { Router } from "express";
import type { RoundsService } from "../../../application/rounds.service.ts";
import type { PlayersRepository } from "../../../data/players.repository.ts";
import type { CreateHoleScoreInput, FairwayResult } from "../../../data/rounds.repository.ts";
import type { AuthProvider } from "../../../application/auth-provider.ts";
import { requireAuth, requireRole } from "../middleware/require-auth.ts";

const ADMIN_ROLES = ["admin", "super_admin"];
const FAIRWAY_RESULTS: FairwayResult[] = ["hit", "missed_left", "missed_right"];

// Request/response shape and input validation live here, not in the
// application layer (ADR-060).
//
// Authorization: unlike clubs/courses (admin-only reference data) or
// handicap overrides (admin-only capability), round submission is a
// real, primary player-facing action -- a `player`-role caller may only
// act on their own linked player record; `admin`/`super_admin` may act
// on any player's rounds (e.g. entering a paper scorecard on a member's
// behalf). This is real authorization on an existing repository
// operation, not new business/workflow logic -- approval behaviour
// (recalculation, notification) remains Phase 2's scope.
export function roundsRouter(service: RoundsService, players: PlayersRepository, authProvider: AuthProvider): Router {
  const router = Router();
  const auth = requireAuth(authProvider);
  const requireAdmin = [auth, requireRole(...ADMIN_ROLES)];

  async function authorizeForPlayer(identitySub: string, ghsRole: string, targetPlayerId: string): Promise<boolean> {
    if (ADMIN_ROLES.includes(ghsRole)) return true;
    const ownPlayer = await players.findByUserId(identitySub);
    return ownPlayer !== null && ownPlayer.id === targetPlayerId;
  }

  function parseFairwayResult(value: unknown): FairwayResult | undefined | null {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === "string" && FAIRWAY_RESULTS.includes(value as FairwayResult)) return value as FairwayResult;
    throw new Error("invalid fairway result");
  }

  router.post("/rounds", auth, async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const { playerId, teeConfigurationId, playedAt, playingHandicap, isTournament, is9Hole } = body;

      if (typeof playerId !== "string" || typeof teeConfigurationId !== "string" || typeof playedAt !== "string") {
        res.status(400).json({ error: "playerId, teeConfigurationId, playedAt are required" });
        return;
      }

      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "cannot submit a round for another player" });
        return;
      }

      const round = await service.createRound({
        playerId,
        teeConfigurationId,
        playedAt,
        playingHandicap: typeof playingHandicap === "number" ? playingHandicap : undefined,
        isTournament: isTournament === true,
        is9Hole: is9Hole === true,
      });
      res.status(201).json(round);
    } catch (err) {
      next(err);
    }
  });

  router.get("/rounds/:id", auth, async (req, res, next) => {
    try {
      const round = await service.getRound(String(req.params.id));
      if (!round) {
        res.status(404).json({ error: "round not found" });
        return;
      }
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, round.playerId))) {
        res.status(403).json({ error: "cannot view another player's round" });
        return;
      }
      res.status(200).json(round);
    } catch (err) {
      next(err);
    }
  });

  router.get("/players/:playerId/rounds", auth, async (req, res, next) => {
    try {
      const playerId = String(req.params.playerId);
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, playerId))) {
        res.status(403).json({ error: "cannot list another player's rounds" });
        return;
      }
      res.status(200).json(await service.listRoundsForPlayer(playerId));
    } catch (err) {
      next(err);
    }
  });

  router.post("/rounds/:id/holes", auth, async (req, res, next) => {
    try {
      const roundId = String(req.params.id);
      const round = await service.getRound(roundId);
      if (!round) {
        res.status(404).json({ error: "round not found" });
        return;
      }
      const identity = req.identity!;
      if (!(await authorizeForPlayer(identity.sub, identity.ghsRole, round.playerId))) {
        res.status(403).json({ error: "cannot add a hole score to another player's round" });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const { holeNumber, strokes, putts, gir, inSand, penalties, netDoubleBogeyAdjusted } = body;
      if (typeof holeNumber !== "number" || holeNumber < 1 || holeNumber > 18) {
        res.status(400).json({ error: "holeNumber must be between 1 and 18" });
        return;
      }
      if (typeof strokes !== "number" || strokes < 1) {
        res.status(400).json({ error: "strokes must be a positive number" });
        return;
      }

      let fairwayResult: FairwayResult | undefined | null;
      try {
        fairwayResult = parseFairwayResult(body.fairwayResult);
      } catch {
        res.status(400).json({ error: "fairwayResult must be one of hit, missed_left, missed_right, or omitted" });
        return;
      }

      const input: CreateHoleScoreInput = {
        holeNumber,
        strokes,
        putts: typeof putts === "number" ? putts : undefined,
        gir: gir === true,
        fairwayResult: fairwayResult ?? undefined,
        inSand: inSand === true,
        penalties: typeof penalties === "number" ? penalties : undefined,
        netDoubleBogeyAdjusted: typeof netDoubleBogeyAdjusted === "number" ? netDoubleBogeyAdjusted : undefined,
      };
      const holeScore = await service.addHoleScore(roundId, input);
      res.status(201).json(holeScore);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/rounds/:id/status", ...requireAdmin, async (req, res, next) => {
    try {
      const { status, rejectionReason } = req.body as Record<string, unknown>;
      if (status !== "approved" && status !== "rejected" && status !== "pending") {
        res.status(400).json({ error: "status must be pending, approved, or rejected" });
        return;
      }
      await service.setRoundStatus(
        String(req.params.id),
        status,
        typeof rejectionReason === "string" ? rejectionReason : undefined,
      );
      res.status(200).json({ message: `Round status set to ${status}.` });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
