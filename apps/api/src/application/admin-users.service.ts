import type { Pool } from "pg";
import type { Logger } from "../logger.ts";
import type { UsersRepository, UserRole, UserStatus } from "../data/users.repository.ts";
import type { PlayersRepository } from "../data/players.repository.ts";
import type { ActivationTokenRepository } from "../data/activation-tokens.repository.ts";
import type { NotificationsRepository } from "../data/notifications.repository.ts";
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

export interface AdminUserListItem {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  // ghs#98: null for admin/super_admin accounts -- users/players are
  // strictly separated (IAM-020), and adminCreateUser only ever links a
  // players row for role === "player". Not a data gap to paper over: an
  // admin/super_admin account genuinely has no name captured anywhere
  // today (AccountMenu itself only ever displays email for the same
  // reason). The list screen consuming this shows "--" for these rows,
  // not a fabricated name.
  firstName: string | null;
  lastName: string | null;
}

export interface ListUsersInput {
  role?: UserRole;
  status?: UserStatus;
  limit: number;
  offset: number;
}

export interface ListUsersResult {
  items: AdminUserListItem[];
  total: number;
}

export interface AdminUsersService {
  adminCreateUser(input: AdminCreateUserInput): Promise<{ userId: string }>;
  setUserStatus(userId: string, status: Extract<UserStatus, "active" | "disabled">): Promise<void>;
  listUsers(input: ListUsersInput): Promise<ListUsersResult>;
  // ghs#98: soft-delete only (status='deleted', already a reserved value
  // in the schema's own CHECK constraint) -- the players row, if any,
  // deliberately survives untouched, since rounds/handicap history must
  // remain queryable regardless of account deletion.
  deleteUser(userId: string): Promise<void>;
}

export function createAdminUsersService(
  pool: Pool,
  logger: Logger,
  users: UsersRepository,
  players: PlayersRepository,
  activationTokens: ActivationTokenRepository,
  notifications: NotificationsRepository,
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
          // ghs#39: replaces the previous plaintext-token-logging
          // placeholder. The raw token is deliberately part of the
          // durable payload (the worker needs it to build the real
          // activation email), not a log line -- SEC-010's "never log a
          // token" rule targets stdout/journald, not this table.
          await notifications.record(
            { userId, eventType: "account_activation_admin_invite", payload: { email: input.email, token: rawToken, expiresAt: expiresAt.toISOString() } },
            client,
          );
        }

        await client.query("COMMIT");
        logger.info("user created by admin", { userId, role: input.role, autoActivate: input.autoActivate });
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

    async listUsers(input) {
      const { users: userRows, total } = await users.list({
        role: input.role,
        status: input.status,
        limit: input.limit,
        offset: input.offset,
      });

      const playerRows = await players.findByUserIds(userRows.map((u) => u.id));
      const playersByUserId = new Map(playerRows.filter((p) => p.userId !== null).map((p) => [p.userId as string, p]));

      // Built field-by-field, not a spread of the raw User row -- that
      // row still carries passwordHash, and this is the one place a
      // silent future field addition to User could otherwise leak
      // straight into an admin-listing response (same discipline as
      // players.ts's toPlayerProfileResponse for userId).
      const items: AdminUserListItem[] = userRows.map((u) => {
        const player = playersByUserId.get(u.id);
        return {
          id: u.id,
          email: u.email,
          role: u.role,
          status: u.status,
          createdAt: u.createdAt,
          firstName: player?.firstName ?? null,
          lastName: player?.lastName ?? null,
        };
      });

      return { items, total };
    },

    async deleteUser(userId) {
      await users.setStatus(userId, "deleted");
    },
  };
}
