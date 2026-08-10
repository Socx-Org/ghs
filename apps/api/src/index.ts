import { loadConfig } from "./config.ts";
import { createLogger } from "./logger.ts";
import { createPool } from "./data/pool.ts";
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

const clubsService = createClubsService(clubsRepository, logger);
const coursesService = createCoursesService(coursesRepository, logger);
const authProvider = createLocalAuthProvider(config.auth, refreshTokensRepository);
const mfaService = createMfaService(mfaRepository, config.auth.mfaEncryptionKey);
const systemSettingsService = createSystemSettingsService(systemSettingsRepository);
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
});
const adminUsersService = createAdminUsersService(pool, logger, usersRepository, playersRepository, activationTokenRepository);

const app = createApp({
  logger,
  clubsService,
  coursesService,
  authService,
  mfaService,
  adminUsersService,
  systemSettingsService,
  authProvider,
});

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
