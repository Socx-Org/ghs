import type { Pool } from "pg";

export type UserStatus = "pending_verification" | "active" | "disabled" | "deleted";
export type UserRole = "player" | "admin" | "super_admin";

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
  role: UserRole;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface UsersRepository {
  create(input: { email: string; passwordHash: string; role: UserRole; status: UserStatus }): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  markEmailVerified(id: string): Promise<void>;
  setStatus(id: string, status: UserStatus): Promise<void>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  status: UserStatus;
  role: UserRole;
  email_verified_at: Date | null;
  created_at: Date;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    status: row.status,
    role: row.role,
    emailVerifiedAt: row.email_verified_at ? row.email_verified_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = "id, email::text AS email, password_hash, status, role, email_verified_at, created_at";

export function createUsersRepository(pool: Pool): UsersRepository {
  return {
    async create(input) {
      const result = await pool.query<UserRow>(
        `INSERT INTO users (email, password_hash, role, status)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SELECT_COLUMNS}`,
        [input.email, input.passwordHash, input.role, input.status],
      );
      return toUser(result.rows[0]!);
    },

    async findByEmail(email) {
      const result = await pool.query<UserRow>(
        `SELECT ${SELECT_COLUMNS} FROM users WHERE email = $1`,
        [email],
      );
      return result.rows[0] ? toUser(result.rows[0]) : null;
    },

    async findById(id) {
      const result = await pool.query<UserRow>(
        `SELECT ${SELECT_COLUMNS} FROM users WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? toUser(result.rows[0]) : null;
    },

    async markEmailVerified(id) {
      await pool.query(
        "UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1",
        [id],
      );
    },

    async setStatus(id, status) {
      await pool.query(
        "UPDATE users SET status = $2, updated_at = now() WHERE id = $1",
        [id, status],
      );
    },

    async setPasswordHash(id, passwordHash) {
      await pool.query(
        "UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1",
        [id, passwordHash],
      );
    },
  };
}
