import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createPool } from "./data/pool.ts";
import { createClubsRepository } from "./data/clubs.repository.ts";
import { createCoursesRepository } from "./data/courses.repository.ts";
import { createClubsService } from "./application/clubs.service.ts";
import { createCoursesService } from "./application/courses.service.ts";
import { createApp } from "./interface/http/app.ts";

// Composition root: config and secrets are read exactly once, here, and
// passed down -- no other module reads process.env or a credential file
// (APP-010, ADR-130).
const config = loadConfig();
const logger = createLogger(config.serviceName);

const pool = createPool(config.database);
const clubsRepository = createClubsRepository(pool);
const coursesRepository = createCoursesRepository(pool);
const clubsService = createClubsService(clubsRepository, logger);
const coursesService = createCoursesService(coursesRepository, logger);

const app = createApp({ logger, clubsService, coursesService });

const server = app.listen(config.port, () => {
  logger.info("server started", { port: config.port, env: config.env });
});

async function shutdown(signal: string): Promise<void> {
  logger.info("shutting down", { signal });
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
