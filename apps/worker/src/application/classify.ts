import { EmailSendError } from "@ghs/api/lib/email";

// ADR-210 point 4 requires the retryable/permanent distinction but
// explicitly leaves the specific rules to the app ("depend on the
// provider's actual error surface"). ADR-210's own illustrative text
// ("4xx-style hard rejection = permanent", "5xx/connection errors =
// retryable") is written from an HTTP-API provider's perspective
// (SendGrid/SES REST semantics). This worker's only real implemented
// provider is SMTP (mailpit/smtp, ghs#40) -- and raw SMTP's wire-protocol
// convention is the OPPOSITE of that (RFC 5321): a 4xx reply is a
// *temporary* failure (mailbox full, greylisting, try again later); a
// 5xx reply is a permanent rejection (no such user, policy rejection).
// Applying the ADR's HTTP-flavoured illustration literally to a real SMTP
// response would misclassify both directions. This is exactly the
// "depend on the provider's actual error surface" case ADR-210 itself
// defers to the app -- resolved here for SMTP's real semantics, not a
// deviation from the ADR.
interface NodemailerErrorShape {
  code?: string;
  responseCode?: number;
}

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ESOCKET",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

export function classifyFailure(err: unknown): "retryable" | "permanent" {
  const cause = err instanceof EmailSendError ? err.cause : err;
  const shape = cause as NodemailerErrorShape | undefined;

  if (shape?.responseCode !== undefined) {
    // Real SMTP semantics (RFC 5321), not the ADR's generic HTTP-flavoured
    // illustration -- see the file-level comment above.
    return shape.responseCode >= 500 ? "permanent" : "retryable";
  }

  if (shape?.code && RETRYABLE_NETWORK_CODES.has(shape.code)) {
    return "retryable";
  }

  // Unclassifiable shape -- default to retryable. The cost of guessing
  // wrong here is bounded and small (at most MAX_ATTEMPTS-1 wasted
  // retries before landing in 'failed' regardless, matching ADR-210
  // point 2's own "a duplicate/extra attempt is a low-severity,
  // recoverable inconvenience" framing) -- silently dropping a
  // notification that could have succeeded on retry is the worse failure
  // mode of the two.
  return "retryable";
}
