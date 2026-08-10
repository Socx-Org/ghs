import { generateSecret, generate, verify, generateURI } from "otplib";
import type { MfaRepository } from "../data/mfa.repository.ts";
import { encryptMfaSecret, decryptMfaSecret } from "../lib/mfa-secret-crypto.ts";
import { generateBackupCode, hashToken } from "../lib/tokens.ts";
import type { MfaCodeVerifier } from "./auth.service.ts";

const BACKUP_CODE_COUNT = 10;

export interface EnrollTotpResult {
  otpauthUri: string;
}

export interface MfaService extends MfaCodeVerifier {
  enrollTotp(userId: string, email: string): Promise<EnrollTotpResult>;
  confirmTotpEnrollment(userId: string, code: string): Promise<{ backupCodes: string[] }>;
  disableMfa(userId: string): Promise<void>;
}

export function createMfaService(mfa: MfaRepository, mfaEncryptionKey: Buffer): MfaService {
  return {
    async enrollTotp(userId, email) {
      // Not yet enabled -- enabled_at stays NULL until confirmTotpEnrollment
      // proves the user actually has a working authenticator (IAM-020).
      const secret = await generateSecret();
      const encryptedSecret = encryptMfaSecret(secret, mfaEncryptionKey);
      await mfa.createTotpMethod(userId, encryptedSecret);

      const otpauthUri = await generateURI({ issuer: "GHS", label: email, secret });
      return { otpauthUri };
    },

    async confirmTotpEnrollment(userId, code) {
      const method = await mfa.getTotpMethod(userId);
      if (!method) throw new Error("no MFA enrollment in progress");

      const secret = decryptMfaSecret(method.encryptedSecret, mfaEncryptionKey);
      // Same otplib quirk as verifyLoginCode below: malformed input throws
      // rather than returning invalid -- treated the same way, not a
      // server error.
      let valid = false;
      try {
        valid = (await verify({ token: code, secret })).valid;
      } catch {
        valid = false;
      }
      if (!valid) throw new Error("invalid code");

      await mfa.enableMethod(method.id);

      // Shown once, at confirmation time -- never retrievable again after
      // this response (IAM-020).
      const backupCodes: string[] = [];
      const hashes: string[] = [];
      for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
        const code = generateBackupCode();
        backupCodes.push(code);
        hashes.push(hashToken(code));
      }
      await mfa.createBackupCodes(userId, hashes);

      return { backupCodes };
    },

    async verifyLoginCode(userId, code) {
      const method = await mfa.getTotpMethod(userId);
      if (!method || !method.enabledAt) return false;

      const secret = decryptMfaSecret(method.encryptedSecret, mfaEncryptionKey);
      // otplib's verify() throws on malformed input (e.g. a 10-character
      // backup code, not a 6-digit TOTP token) rather than returning
      // { valid: false } -- found for real running this code against a
      // backup code. A malformed TOTP attempt is just "not a valid TOTP
      // code," not an error condition; fall through to the backup-code
      // check either way.
      let totpValid = false;
      try {
        totpValid = (await verify({ token: code, secret })).valid;
      } catch {
        totpValid = false;
      }
      if (totpValid) return true;

      // Fall back to a backup code -- single-use, hashed like a password.
      return mfa.consumeBackupCode(userId, hashToken(code));
    },

    async disableMfa(userId) {
      // Admin-initiated recovery path (IAM-020) -- same authority tier as
      // account enable/disable. Removes enrollment and all backup codes.
      await mfa.deleteAllMethods(userId);
    },
  };
}
