import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../src/logger.ts";
import { createGeoIpService } from "../src/lib/geoip.ts";

// ghs#234. No real database shipped in the repo (apps/api/data/geoip/ is
// gitignored, ~50MB of MaxMind-licensed binary data, refreshed
// periodically) -- so a missing file is the one scenario every
// environment this test runs in (CI included) can always exercise for
// real, without conditionally skipping anything.
test("createGeoIpService: a missing database file degrades to every lookup returning all-null, never throws, never blocks startup", async () => {
  const logger = createLogger("test");
  const service = await createGeoIpService("/nonexistent/path/GeoLite2-City.mmdb", logger);

  assert.deepEqual(service.lookup("8.8.8.8"), { country: null, region: null, city: null });
  assert.deepEqual(service.lookup("not-an-ip-at-all"), { country: null, region: null, city: null });
});

const REAL_DB_PATH = join(import.meta.dirname, "..", "data", "geoip", "GeoLite2-City.mmdb");

// Only runs where the real database has actually been downloaded (local
// dev, per .env.example's own documented one-time download command) --
// t.skip(), not an assertion failure, when it hasn't, since CI has no
// MaxMind license key and never downloads one. This is the one test in
// this suite that proves the acceptance criteria ("a real public IP
// resolves to a real country/region/city... a private/local/reserved
// IP resolves to null gracefully") against the real library + real
// data, not a fake.
test("createGeoIpService: against the real GeoLite2-City database -- a real public IP resolves to real data, private/loopback/reserved IPs resolve to null, not an error", async (t) => {
  if (!existsSync(REAL_DB_PATH)) {
    t.skip("no local GeoLite2-City.mmdb downloaded -- see .env.example for the one-time download command");
    return;
  }

  const logger = createLogger("test");
  const service = await createGeoIpService(REAL_DB_PATH, logger);

  const googleDns = service.lookup("8.8.8.8");
  assert.equal(googleDns.country, "United States");

  for (const privateIp of ["127.0.0.1", "::ffff:127.0.0.1", "::1", "192.168.1.1", "10.0.0.1"]) {
    assert.deepEqual(service.lookup(privateIp), { country: null, region: null, city: null }, `expected ${privateIp} to resolve to all-null`);
  }
});
