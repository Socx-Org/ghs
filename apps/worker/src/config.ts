import { loadDatabaseConfig, loadEmailConfig } from "@ghs/api/config";
import type { DatabaseConfig, EmailConfig } from "@ghs/api/config";

export interface WorkerConfig {
  env: string;
  serviceName: string;
  database: DatabaseConfig;
  email: EmailConfig;
  // Base URL of the web app the worker links to from activation/password-
  // reset emails (e.g. "https://ghs.socx.org.uk"). No sensible universal
  // default exists -- guessing a real domain would be presumptuous
  // (unlike database.host/email.smtp.host, which have genuine local-dev
  // defaults) -- but local development still needs something usable
  // without extra setup, so it falls back to Vite's own default dev
  // server origin rather than failing startup entirely.
  appBaseUrl: string;
}

// Deliberately narrower than apps/api's own loadConfig(): the worker has
// no auth-related code path at all (no login, no token issuance), so it
// never reads jwt_secret/mfa_encryption_key -- confirmed against
// reference/systemd/app-worker.service before writing this, whose own
// LoadCredential= line only ever grants db_password (least privilege,
// SEC-010/ADR-130). loadDatabaseConfig()/loadEmailConfig() are the same
// functions apps/api's own loadConfig() composes -- one implementation,
// not a worker-side duplicate.
export function loadWorkerConfig(): WorkerConfig {
  return {
    env: process.env.SOCX_ENV ?? "development",
    serviceName: process.env.SERVICE_NAME ?? "ghs-worker",
    database: loadDatabaseConfig(),
    email: loadEmailConfig(),
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:5173",
  };
}
