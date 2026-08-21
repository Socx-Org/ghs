import { ApiError } from "./api";

// ghs#107: shared with ActivationPage (ghs#106) -- both /auth/activate
// and /auth/password-reset/confirm return the identical three wire
// codes for the identical reason (see auth.service.ts's ActivationToken*
// Error / PasswordResetToken*Error classes), so this classification is
// real, byte-for-byte duplicated logic, not similar-looking page copy --
// worth extracting, unlike e.g. describeQueryError's per-page messages.
export type TokenOutcome = "expired" | "already_used" | "invalid";

export function classifyTokenError(error: unknown): TokenOutcome {
  if (error instanceof ApiError) {
    if (error.message === "expired_token") return "expired";
    if (error.message === "already_used_token") return "already_used";
  }
  // invalid_token, a missing/malformed response, or a network failure
  // all land here -- none of them have a more specific, honest story to
  // tell than "this link isn't valid."
  return "invalid";
}
