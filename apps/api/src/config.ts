import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtAccessExpiresInSeconds: number;
  jwtRefreshExpiresInSeconds: number;
  mfaPendingExpiresInSeconds: number;
  // AES-256-GCM key for MFA TOTP secrets -- encrypted, not hashed, since
  // verifying a code requires the raw secret back (IAM-020). 32 raw bytes,
  // hex-encoded (64 hex characters).
  mfaEncryptionKey: Buffer;
}

export interface AppConfig {
  env: string;
  port: number;
  serviceName: string;
  database: DatabaseConfig;
  auth: AuthConfig;
}

// Reads a systemd LoadCredential= file at $CREDENTIALS_DIRECTORY/<name>
// (reference/systemd, ADR-130). Falls back to an env var so the same code
// path works in local development against reference/security's .env
// pattern, where CREDENTIALS_DIRECTORY is unset.
function readSecret(credentialName: string, envVarFallback: string): string {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  if (dir) {
    try {
      return readFileSync(join(dir, credentialName), "utf8").trim();
    } catch (err) {
      throw new Error(
        `Failed to read credential '${credentialName}' from ${dir}: ${(err as Error).message}`,
      );
    }
  }
  const fallback = process.env[envVarFallback];
  if (!fallback) {
    throw new Error(
      `Missing secret: no CREDENTIALS_DIRECTORY/${credentialName} and no ${envVarFallback} env var set`,
    );
  }
  return fallback;
}

// Read once, at startup, and passed down -- never re-read deep in the call
// stack (APP-010, ADR-130).
export function loadConfig(): AppConfig {
  return {
    env: process.env.SOCX_ENV ?? "development",
    port: Number(process.env.PORT ?? 3000),
    serviceName: process.env.SERVICE_NAME ?? "ghs-api",
    database: {
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME ?? "ghs",
      user: process.env.DB_USER ?? "ghs",
      password: readSecret("db_password", "DB_PASSWORD"),
    },
    auth: {
      jwtSecret: readSecret("jwt_secret", "JWT_SECRET"),
      // Platform owner decision, 2026-08-10 (ghs#8): matches legacy GHS's
      // own real, already-sound values, explicitly confirmed rather than
      // silently inherited.
      jwtAccessExpiresInSeconds: 15 * 60,
      jwtRefreshExpiresInSeconds: 30 * 24 * 60 * 60,
      mfaPendingExpiresInSeconds: 5 * 60,
      mfaEncryptionKey: Buffer.from(readSecret("mfa_encryption_key", "MFA_ENCRYPTION_KEY"), "hex"),
    },
  };
}
