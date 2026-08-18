// Client-side JWT *payload* decode only -- never verifies the signature,
// never treated as an authorization boundary. This is explicitly UX
// state (immediate role/identity display without waiting on a round
// trip); the backend remains the sole security authority on every real
// request (it verifies HS256 signatures server-side and returns 401/403
// itself -- see apps/api/src/application/auth-provider.ts). No jwt-decode
// dependency -- a JWT payload is just base64url-encoded JSON, decoding it
// is a few lines, not worth a package for.
export function decodeJwtPayload<T>(token: string): T | null {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return null;
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    // base64url (what a JWT segment actually is) omits the trailing "="
    // padding real base64 requires -- atob() happens to tolerate that on
    // the current V8 (confirmed directly: it decodes an unpadded string
    // without throwing here), but that's implementation leniency, not a
    // guarantee. Adding the padding back is correct regardless of
    // whether the current environment needs it (review finding, PR #84).
    const paddingLength = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(paddingLength);
    const json = atob(padded);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
