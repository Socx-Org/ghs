import type { Pool } from "pg";
import type { Logger } from "../logger.ts";
import type { User, UsersRepository, UserRole, UserStatus } from "../data/users.repository.ts";
import type { Player, PlayersRepository } from "../data/players.repository.ts";
import type { ActivationTokenRepository } from "../data/activation-tokens.repository.ts";
import type { NotificationsRepository } from "../data/notifications.repository.ts";
import { hashPassword } from "../lib/password.ts";
import { generateToken, hashToken } from "../lib/tokens.ts";

const ACTIVATION_TOKEN_TTL_HOURS = 24;

// ghs#191: admin account-edit's own domain errors -- same "route owns
// authorization, service owns domain validation" split as everywhere
// else in this file (adminCreateUser's role-elevation check lives in
// admin-users.ts, not here).
export class UserNotFoundError extends Error {}
export class EmailAlreadyInUseError extends Error {}
// Thrown for any role change that would cross the player/non-player
// boundary (player -> admin/super_admin, or the reverse) -- deliberately
// unsupported for now (see this issue's own Explicit Non-Scope): the
// players row's fate (keep/orphan its rounds/handicap history?) and
// where a name comes from for a newly-created player row are real
// questions, not ones to guess an answer to here.
export class RoleTransitionNotSupportedError extends Error {}
// Thrown when firstName/lastName is provided for an account with no
// players row (i.e. not currently role === "player") -- there's
// nowhere for a name to be written; explicitly rejected rather than
// silently ignored.
export class NameRequiresPlayerAccountError extends Error {}

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
  // ghs#114: the players table's own id, distinct from `id` above
  // (a users table id) -- found missing while implementing #114's own
  // stated intention to use this endpoint as the player-lookup source
  // for admin round creation, which needs the real players.id to pass
  // as POST /rounds' playerId, not a users.id. Same null-for-non-player
  // reasoning as firstName/lastName above.
  playerId: string | null;
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

// ghs#191: every field independently optional and presence-checked by
// the caller (admin-users.ts), matching PATCH /courses/:id's own
// "presence, not truthiness" convention -- an omitted field is simply
// not touched, not cleared.
export interface UpdateUserInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
}

export interface AdminUsersService {
  adminCreateUser(input: AdminCreateUserInput): Promise<{ userId: string }>;
  setUserStatus(userId: string, status: Extract<UserStatus, "active" | "disabled">): Promise<void>;
  listUsers(input: ListUsersInput): Promise<ListUsersResult>;
  // ghs#191: returns the refreshed row so the caller (the route) can
  // hand the frontend back exactly what it needs to update its own
  // local state, without a second GET.
  updateUser(userId: string, input: UpdateUserInput): Promise<AdminUserListItem>;
  // ghs#98: soft-delete only (status='deleted', already a reserved value
  // in the schema's own CHECK constraint) -- the players row, if any,
  // deliberately survives untouched, since rounds/handicap history must
  // remain queryable regardless of account deletion.
  deleteUser(userId: string): Promise<void>;
}

// Built field-by-field, not a spread of the raw User row -- that row
// still carries passwordHash, and this is the one place a silent
// future field addition to User could otherwise leak straight into an
// admin-facing response (same discipline as players.ts's own
// toPlayerProfileResponse for userId). Shared by listUsers and
// updateUser (ghs#191) -- one definition of "what an admin sees for a
// user row" to keep in sync, not two.
function toAdminUserListItem(user: User, player: Player | null): AdminUserListItem {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    firstName: player?.firstName ?? null,
    lastName: player?.lastName ?? null,
    playerId: player?.id ?? null,
  };
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

      const items: AdminUserListItem[] = userRows.map((u) => toAdminUserListItem(u, playersByUserId.get(u.id) ?? null));

      return { items, total };
    },

    async deleteUser(userId) {
      await users.setStatus(userId, "deleted");
    },

    async updateUser(userId, input) {
      const currentUser = await users.findById(userId);
      if (!currentUser) throw new UserNotFoundError("user not found");

      const currentPlayer = await players.findByUserId(userId);

      // Domain rules that don't depend on a live transaction are
      // validated up front, before any write.
      if (input.role !== undefined && input.role !== currentUser.role) {
        const currentIsPlayer = currentUser.role === "player";
        const nextIsPlayer = input.role === "player";
        if (currentIsPlayer !== nextIsPlayer) {
          throw new RoleTransitionNotSupportedError("changing role to/from player is not supported yet");
        }
      }

      if ((input.firstName !== undefined || input.lastName !== undefined) && !currentPlayer) {
        throw new NameRequiresPlayerAccountError("name can only be set for a player account");
      }

      // Review finding, PR #192: up to 3 writes (email/name/role) --
      // a real transaction, same BEGIN/COMMIT/ROLLBACK pattern as
      // adminCreateUser above, so a later failure partway through
      // (e.g. a transient DB error between the email and role writes)
      // can't leave a half-applied update either.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (input.email !== undefined && input.email !== currentUser.email) {
          const existing = await users.findByEmail(input.email);
          if (existing && existing.id !== userId) {
            throw new EmailAlreadyInUseError("email already in use");
          }
          try {
            await users.updateEmail(userId, input.email, client);
          } catch (err) {
            // Review finding, PR #192: the findByEmail check above is a
            // real TOCTOU race under concurrency -- a second request
            // could take the same email between that check and this
            // UPDATE. The CITEXT UNIQUE constraint is the real
            // backstop; a raw 23505 here is translated to the same
            // clean domain error the common case already produces,
            // not left to surface as an unhandled 500.
            const pgErr = err as { code?: string };
            if (pgErr.code === "23505") {
              throw new EmailAlreadyInUseError("email already in use");
            }
            throw err;
          }
        }

        if (input.firstName !== undefined && input.lastName !== undefined) {
          await players.updateName(currentPlayer!.id, input.firstName, input.lastName, client);
        }

        if (input.role !== undefined && input.role !== currentUser.role) {
          await users.updateRole(userId, input.role, client);
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      const refreshedUser = await users.findById(userId);
      const refreshedPlayer = await players.findByUserId(userId);
      return toAdminUserListItem(refreshedUser!, refreshedPlayer);
    },
  };
}
