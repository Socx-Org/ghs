import type { PoolClient } from "pg";
import type {
  CurrentHandicapIndex,
  HandicapHistoryRecord,
  HandicapHistoryRepository,
  RecordHandicapChangeResult,
} from "../data/handicap-history.repository.ts";

// The one shared write path (ADR-060) -- both the calculated-recalculation
// path (ghs#22) and the manual-override path (ghs#10's handicap-overrides.
// service.ts) call recordCalculatedResult/recordManualOverride below,
// which both delegate to the same repository.recordChange(). No
// duplicated history-writing logic between them.

export class InvalidHandicapChangeError extends Error {}

export interface HandicapHistoryService {
  getCurrentIndex(playerId: string, client?: PoolClient): Promise<CurrentHandicapIndex | null>;
  listHistoryForPlayer(playerId: string): Promise<HandicapHistoryRecord[]>;

  // client: when provided, threaded straight through to
  // HandicapHistoryRepository.recordChange -- no transaction is opened
  // or committed here, the caller owns that (ghs#24's orchestrator,
  // given a caller-supplied client from ghs#23's approval/rejection/
  // amendment handlers).
  recordCalculatedResult(
    playerId: string,
    newIndex: number,
    calculationDate: string,
    snapshot: Record<string, unknown>,
    client?: PoolClient,
  ): Promise<RecordHandicapChangeResult>;

  recordManualOverride(
    playerId: string,
    newIndex: number,
    previousIndex: number | null,
    reason: string,
    createdBy: string,
    calculationDate?: string,
    client?: PoolClient,
  ): Promise<RecordHandicapChangeResult>;
}

export function createHandicapHistoryService(repo: HandicapHistoryRepository): HandicapHistoryService {
  return {
    async getCurrentIndex(playerId, client) {
      return repo.getCurrentIndex(playerId, client);
    },

    async listHistoryForPlayer(playerId) {
      return repo.listForPlayer(playerId);
    },

    async recordCalculatedResult(playerId, newIndex, calculationDate, snapshot, client) {
      return repo.recordChange(
        {
          playerId,
          method: "calculated",
          newIndex,
          previousIndex: null,
          reason: null,
          createdBy: null,
          calculationSnapshot: snapshot,
          calculationDate,
        },
        client,
      );
    },

    async recordManualOverride(playerId, newIndex, previousIndex, reason, createdBy, calculationDate, client) {
      if (!reason.trim()) {
        throw new InvalidHandicapChangeError("reason is required for a manual override");
      }
      return repo.recordChange(
        {
          playerId,
          method: "manual_override",
          newIndex,
          previousIndex,
          reason,
          createdBy,
          calculationSnapshot: null,
          calculationDate: calculationDate ?? new Date().toISOString(),
        },
        client,
      );
    },
  };
}
