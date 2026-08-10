import type { Pool } from "pg";
import type { Logger } from "../logger.ts";
import type { UsersRepository, UserRole, UserStatus } from "../data/users.repository.ts";
import type { PlayersRepository } from "../data/players.repository.ts";
import type { ActivationTokenRepository } from "../data/activation-tokens.repository.ts";
import { hashPassword } from "../lib/password.ts";
import { generateToken, hashToken } from "../lib/tokens.ts";

const ACTIVATION_TOKEN_TTL_HOURS = 24;

export interface AdminCreateUserInput {
  email: string;
  password: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  clubId?: string;
  autoActivate: boolean;
}

export interface AdminUsersService {
  adminCreateUser(input: AdminCreateUserInput): Promise<{ userId: string }>;
  setUserStatus(userId: string, status: Extract<UserStatus, "active" | "disabled">): Promise<void>;
}

export function createAdminUsersService(
  pool: Pool,
  logger: Logger,
  users: UsersRepository,
  players: PlayersRepository,
  activationTokens: ActivationTokenRepository,
): AdminUsersService {
  return {
    async adminCreateUser(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const passwordHash = await hashPassword(input.password);
        const status: UserStatus = input.autoActivate ? "active" : "pending_verification";
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, role, status)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [input.email, passwordHash, input.role, status],
        );
        const userId = userResult.rows[0].id as string;

        // Symmetric player-profile creation (ghs#8's fix over legacy) --
        // applies here too, not only to self-registration.
        if (input.role === "player") {
          await players.create(
            { userId, clubId: input.clubId, firstName: input.firstName, lastName: input.lastName },
            client,
          );
        }

        if (input.autoActivate) {
          await client.query("UPDATE users SET email_verified_at = now() WHERE id = $1", [userId]);
        } else {
          const rawToken = generateToken();
          const expiresAt = new Date(Date.now() + ACTIVATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
          await activationTokens.create(userId, hashToken(rawToken), expiresAt, client);
          logger.info("TODO(Phase 4, ADR-210): real email delivery not yet implemented", {
            kind: "account_activation_admin_invite",
            email: input.email,
            token: rawToken,
          });
        }

        await client.query("COMMIT");
        return { userId };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async setUserStatus(userId, status) {
      await users.setStatus(userId, status);
    },
  };
}
