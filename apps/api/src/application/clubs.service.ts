import type { Logger } from "../logger.ts";
import type { Club, ClubsRepository } from "../data/clubs.repository.ts";

// No transport- or framework-specific code, no input validation (ADR-060 --
// that belongs to the interface layer). Depends only on the repository's
// narrow interface and the logger.

export interface ClubsService {
  listClubs(): Promise<Club[]>;
  createClub(input: { name: string; city?: string; country?: string }): Promise<Club>;
  getClub(id: string): Promise<Club | null>;
}

export function createClubsService(repository: ClubsRepository, logger: Logger): ClubsService {
  return {
    async listClubs() {
      return repository.list();
    },

    async createClub(input) {
      const club = await repository.create(input);
      logger.info("club created", { clubId: club.id });
      return club;
    },

    async getClub(id) {
      return repository.get(id);
    },
  };
}
