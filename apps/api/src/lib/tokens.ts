import { randomBytes, createHash } from "node:crypto";

// Adopted from legacy GHS's own real, sound pattern: a random token is
// handed to the user (email link, backup code); only its SHA-256 digest
// is ever stored, so a database read alone can never yield a usable
// token. IAM-020's activation/reset/backup-code tables all use this shape.

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Human-enterable backup codes (MFA recovery) -- shorter, but still
// hashed at rest like any other single-use credential.
export function generateBackupCode(): string {
  return randomBytes(5).toString("hex"); // 10 hex chars, e.g. "a3f9c1e02b"
}
