import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

// TOTP secrets are ENCRYPTED, not hashed (IAM-020) -- verifying a code
// requires the raw secret back, unlike every other credential this
// platform stores (passwords, activation/reset tokens), which are hashed
// one-way and never read back. Getting this distinction backwards would
// silently and permanently break MFA for every enrolled user.
//
// AES-256-GCM: a random 12-byte IV per encryption, the auth tag appended
// to the ciphertext so a single opaque string round-trips through
// storage. Key is 32 raw bytes, sourced via config.ts's
// LoadCredential=/env-fallback mechanism -- never hardcoded, never derived
// from anything else.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function encryptMfaSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptMfaSecret(ciphertext: string, key: Buffer): string {
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
