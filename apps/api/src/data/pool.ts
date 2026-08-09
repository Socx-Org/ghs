import { Pool } from "pg";
import type { DatabaseConfig } from "../config.ts";

// The only place a `pg.Pool` is constructed -- nothing outside data/ imports
// `pg` directly (ADR-060: data-access layer is the only layer permitted to
// touch persistence).
export function createPool(config: DatabaseConfig): Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });
}
