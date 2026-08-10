import { test } from "node:test";
import assert from "node:assert/strict";
import { createClubsService } from "../src/application/clubs.service.ts";
import { createLogger } from "../src/logger.ts";
import type { Club, ClubsRepository } from "../src/data/clubs.repository.ts";

// Proves the application layer is testable without an HTTP server or a
// real database (ENG-030.3) -- a fake repository stands in for pg.
function fakeRepository(initial: Club[] = []): ClubsRepository {
  const clubs = [...initial];
  return {
    async list() {
      return clubs;
    },
    async create(input) {
      const club: Club = {
        id: String(clubs.length + 1),
        name: input.name,
        city: input.city ?? null,
        country: input.country ?? null,
        createdAt: new Date().toISOString(),
      };
      clubs.push(club);
      return club;
    },
    async get(id) {
      return clubs.find((c) => c.id === id) ?? null;
    },
  };
}

const silentLogger = createLogger("test");

test("listClubs returns what the repository has", async () => {
  const repository = fakeRepository([
    { id: "1", name: "La Manga Club", city: "Murcia", country: "ES", createdAt: "2026-01-01T00:00:00.000Z" },
  ]);
  const service = createClubsService(repository, silentLogger);

  const clubs = await service.listClubs();

  assert.equal(clubs.length, 1);
  assert.equal(clubs[0]!.name, "La Manga Club");
});

test("createClub persists via the repository and returns the created club", async () => {
  const repository = fakeRepository();
  const service = createClubsService(repository, silentLogger);

  const club = await service.createClub({ name: "Real Club de Golf El Prat", country: "ES" });

  assert.equal(club.name, "Real Club de Golf El Prat");
  assert.equal((await service.listClubs()).length, 1);
});

test("getClub returns null for an unknown id", async () => {
  const service = createClubsService(fakeRepository(), silentLogger);

  assert.equal(await service.getClub("does-not-exist"), null);
});
