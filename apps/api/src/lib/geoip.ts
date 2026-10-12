import { open } from "maxmind";
import type { Reader, CityResponse } from "maxmind";
import type { Logger } from "../logger.ts";

// ghs#234: country/region/city for a login attempt's own ip_address,
// resolved from a local MaxMind GeoLite2-City database -- never a live
// third-party API call, so no per-login IP (including a failed/
// malicious attempt's own) ever leaves this infrastructure.
export interface GeoIpResult {
  country: string | null;
  region: string | null;
  city: string | null;
}

export interface GeoIpService {
  lookup(ipAddress: string): GeoIpResult;
}

const NULL_RESULT: GeoIpResult = { country: null, region: null, city: null };

// Always resolves, never rejects -- an unavailable/unreadable database
// file degrades to every lookup returning NULL_RESULT (identical to this
// column's behaviour before this issue, ghs#231), not a startup crash.
// Verified directly against the real database (private/loopback/
// reserved/malformed IPs -- 127.0.0.1, ::ffff:127.0.0.1, ::1,
// 192.168.1.1, 10.0.0.1, a non-IP string -- all return null from
// reader.get() itself, never throw), but the try/catch below is kept
// regardless: a lookup is enrichment on the login-audit write path, not
// something allowed to ever threaten it (same reasoning as auth.
// service.ts's own recordAttempt wrapper).
export async function createGeoIpService(dbPath: string, logger: Logger): Promise<GeoIpService> {
  let reader: Reader<CityResponse> | null = null;
  try {
    reader = await open(dbPath);
    logger.info("geoip database loaded", { dbPath });
  } catch (err) {
    logger.warn("geoip database unavailable -- country/region/city will be null for every login attempt", {
      dbPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    lookup(ipAddress) {
      if (!reader) return NULL_RESULT;
      try {
        const result = reader.get(ipAddress);
        if (!result) return NULL_RESULT;
        return {
          country: result.country?.names?.en ?? null,
          // GeoLite2's first subdivision is the most specific one
          // available (e.g. a US state) -- there is no separate
          // "region" field in the schema itself.
          region: result.subdivisions?.[0]?.names?.en ?? null,
          city: result.city?.names?.en ?? null,
        };
      } catch (err) {
        logger.warn("geoip lookup failed", { error: err instanceof Error ? err.message : String(err) });
        return NULL_RESULT;
      }
    },
  };
}
