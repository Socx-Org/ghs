import argon2 from "argon2";

// argon2 -- ADR-120's platform password-hashing standard. Zero migration
// cost here: GHS is a new build, unlike RMS (bcrypt) and legacy GHS
// (bcryptjs), which migrate on next login per ADR-120's own text.

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // A malformed/foreign hash (e.g. from a different algorithm) throws
    // rather than returning false -- treat as "does not match", not an
    // error the caller needs to handle specially.
    return false;
  }
}
