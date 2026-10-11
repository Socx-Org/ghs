import { test } from "node:test";
import assert from "node:assert/strict";
import { createLoginAttemptsRepository } from "../src/data/login-attempts.repository.ts";
import type { Pool } from "pg";

// Pure unit test (ENG-030.3) -- no real database. A fake Pool that just
// records the SQL text/params passed to query(), standing in for pg
// entirely (same fake-the-dependency technique as auth-provider.test.ts's
// own fakeRefreshTokens).
//
// This exists specifically because a genuine BEHAVIOURAL reproduction of
// the regression it guards against (real Postgres returning tied rows
// in a different relative order across separate queries, absent a
// tiebreaker) turned out not to be reliably forceable in a fast,
// portable test -- tried directly against the real test database first
// (several rows sharing an identical created_at, paged one at a time),
// and it passed regardless of whether the tiebreaker was present,
// because Postgres happened to return a stable physical scan order in
// that simple, unmodified-table scenario every time. A test that passes
// either way proves nothing, so inspecting the actual SQL text for the
// real guarantee (the tiebreaker clause existing at all) is the
// honest, reliable check instead.
function fakePool(): Pool & { queries: { sql: string; params: unknown[] }[] } {
  const queries: { sql: string; params: unknown[] }[] = [];
  const fake = {
    queries,
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (/SELECT COUNT/.test(sql)) return { rows: [{ count: "0" }] };
      return { rows: [] };
    },
  };
  return fake as unknown as Pool & { queries: { sql: string; params: unknown[] }[] };
}

test("ghs#231 review fix: list()'s query orders by created_at DESC with a real id tiebreaker -- Postgres's own now() is constant for a whole transaction, so a burst of attempts (e.g. credential-stuffing) can genuinely share one created_at, which would otherwise paginate non-deterministically (same reasoning as rounds.repository.ts's own ORDER BY ..., r.id ASC)", async () => {
  const pool = fakePool();
  const repository = createLoginAttemptsRepository(pool);

  await repository.list(50, 0);

  const listQuery = pool.queries.find((q) => /FROM login_attempts/.test(q.sql) && /LEFT JOIN/.test(q.sql));
  assert.ok(listQuery, "expected the main list query (the one joining refresh_tokens) to have run");
  assert.match(listQuery!.sql, /ORDER BY la\.created_at DESC, la\.id ASC/);
});
