import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createPool } from "./data/pool.ts";
import { checkMigrationDrift } from "./data/migrations/apply.ts";
import { createClubsRepository } from "./data/clubs.repository.ts";
import { createCoursesRepository } from "./data/courses.repository.ts";
import { createUsersRepository } from "./data/users.repository.ts";
import { createPlayersRepository } from "./data/players.repository.ts";
import { createActivationTokenRepository } from "./data/activation-tokens.repository.ts";
import { createPasswordResetTokenRepository } from "./data/password-reset-tokens.repository.ts";
import { createRefreshTokensRepository } from "./data/refresh-tokens.repository.ts";
import { createMfaRepository } from "./data/mfa.repository.ts";
import { createSystemSettingsRepository } from "./data/system-settings.repository.ts";
import { createClubsService } from "./application/clubs.service.ts";
import { createCoursesService } from "./application/courses.service.ts";
import { createLocalAuthProvider } from "./application/auth-provider.ts";
import { createAuthService } from "./application/auth.service.ts";
import { createMfaService } from "./application/mfa.service.ts";
import { createAdminUsersService } from "./application/admin-users.service.ts";
import { createSystemSettingsService } from "./application/system-settings.service.ts";
import { createRoundsRepository } from "./data/rounds.repository.ts";
import { createRoundsService } from "./application/rounds.service.ts";
import { createHandicapOverridesRepository } from "./data/handicap-overrides.repository.ts";
import { createHandicapOverridesService } from "./application/handicap-overrides.service.ts";
import { createHandicapHistoryRepository } from "./data/handicap-history.repository.ts";
import { createHandicapHistoryService } from "./application/handicap-history.service.ts";
import { createPccRepository } from "./data/pcc.repository.ts";
import { createPccService } from "./application/pcc.service.ts";
import { createScoringService } from "./application/scoring.service.ts";
import { createRecalculationOrchestrator } from "./application/recalculation.service.ts";
import { createNotificationsRepository } from "./data/notifications.repository.ts";
import { createApp } from "./interface/http/app.ts";

// Composition root: config and secrets are read exactly once, here, and
// passed down -- no other module reads process.env or a credential file
// (APP-010, ADR-130).
const config = loadConfig();
const logger = createLogger(config.serviceName);

const pool = createPool(config.database);

const clubsRepository = createClubsRepository(pool);
const coursesRepository = createCoursesRepository(pool);
const usersRepository = createUsersRepository(pool);
const playersRepository = createPlayersRepository(pool);
const activationTokenRepository = createActivationTokenRepository(pool);
const passwordResetTokenRepository = createPasswordResetTokenRepository(pool);
const refreshTokensRepository = createRefreshTokensRepository(pool);
const mfaRepository = createMfaRepository(pool);
const systemSettingsRepository = createSystemSettingsRepository(pool);
const roundsRepository = createRoundsRepository(pool);
const handicapOverridesRepository = createHandicapOverridesRepository(pool);
const handicapHistoryRepository = createHandicapHistoryRepository(pool);
const pccRepository = createPccRepository(pool);
const notificationsRepository = createNotificationsRepository(pool);

const clubsService = createClubsService(clubsRepository, logger);
const pccService = createPccService(pccRepository);
const scoringService = createScoringService(roundsRepository, coursesRepository, pccService);
const handicapHistoryService = createHandicapHistoryService(handicapHistoryRepository);
const handicapOverridesService = createHandicapOverridesService(pool, handicapOverridesRepository, handicapHistoryService, notificationsRepository, playersRepository, logger);
const recalculationOrchestrator = createRecalculationOrchestrator(pool, roundsRepository, handicapHistoryService, pccService, notificationsRepository, playersRepository, logger);
const systemSettingsService = createSystemSettingsService(systemSettingsRepository);
const roundsService = createRoundsService(pool, roundsRepository, coursesRepository, scoringService, recalculationOrchestrator, notificationsRepository, playersRepository, systemSettingsService, logger);
const coursesService = createCoursesService(coursesRepository, logger);
const authProvider = createLocalAuthProvider(config.auth, refreshTokensRepository);
const mfaService = createMfaService(mfaRepository, config.auth.mfaEncryptionKey);
const authService = createAuthService({
  pool,
  logger,
  authProvider,
  users: usersRepository,
  players: playersRepository,
  activationTokens: activationTokenRepository,
  passwordResetTokens: passwordResetTokenRepository,
  mfa: mfaRepository,
  mfaVerifier: mfaService,
  notifications: notificationsRepository,
});
const adminUsersService = createAdminUsersService(pool, logger, usersRepository, playersRepository, activationTokenRepository, notificationsRepository);

const app = createApp({
  logger,
  clubsService,
  coursesService,
  authService,
  mfaService,
  adminUsersService,
  systemSettingsService,
  roundsService,
  handicapOverridesService,
  pccService,
  recalculationOrchestrator,
  playersRepository,
  authProvider,
});

const server = app.listen(config.port, () => {
  logger.info("server started", { port: config.port, env: config.env });
});

// ghs#154: never awaited before listen -- a diagnostic, not a startup
// dependency (see checkMigrationDrift's own doc comment for why this
// must never gate startup or the deploy health check). checkError is
// handled distinctly from pendingFiles.length === 0 -- "couldn't check"
// and "checked, genuinely up to date" must never be logged identically,
// or a real check failure would masquerade as a clean bill of health.
// The outer catch is a second safety net on top of the function's own
// internal ones (it doesn't throw/reject itself, but nothing here
// depends on that never changing) -- this must never be able to crash
// the process.
void checkMigrationDrift(pool)
  .then((report) => {
    if (report.checkError) {
      logger.warn("could not check migration drift", { error: report.checkError });
    } else if (report.pendingFiles.length > 0) {
      logger.warn("pending database migrations detected -- schema may not match running code", {
        pendingFiles: report.pendingFiles,
      });
    } else {
      logger.info("database schema up to date with migrations on disk");
    }
  })
  .catch((err) => {
    logger.warn("could not check migration drift", { error: err instanceof Error ? err.message : String(err) });
  });

async function shutdown(signal: string): Promise<void> {
  logger.info("shutting down", { signal });
  server.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
