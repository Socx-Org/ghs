import { describe, expect, it } from "vitest";
import { decodeJwtPayload } from "./jwt";

// A real JWT's payload segment (base64url), not a hand-typed guess at
// the encoding -- built the same way the backend actually produces one
// (header.payload.signature, only the payload matters for this decode).
function makeToken(payload: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe("decodeJwtPayload", () => {
  it("decodes a well-formed token's payload", () => {
    const token = makeToken({ sub: "user-1", ghs_role: "player" });
    expect(decodeJwtPayload(token)).toEqual({ sub: "user-1", ghs_role: "player" });
  });

  it("returns null for a malformed token (not enough segments)", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
  });

  it("returns null for a token whose payload isn't valid base64url JSON", () => {
    expect(decodeJwtPayload("header.not-valid-base64!!!.sig")).toBeNull();
  });

  it("handles base64url characters (-, _) that plain base64 doesn't use", () => {
    // A payload whose JSON serialization is large/varied enough to
    // plausibly produce - and _ in its base64url encoding, not just 0-9a-zA-Z+/.
    const token = makeToken({ sub: "user-1", amr: ["pwd", "totp"], email: "a+b@example.com" });
    expect(decodeJwtPayload<{ sub: string }>(token)?.sub).toBe("user-1");
  });
});
