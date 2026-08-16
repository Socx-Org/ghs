import nodemailer from "nodemailer";
import type { EmailConfig } from "../config.ts";

// ghs#40 (ADR-210 point 10) -- provider abstraction for the worker's send
// step (ghs#42). No outbox/worker logic may be coupled to a specific
// provider's SDK/API shape beyond this boundary.
//
// Nothing in apps/api's own request-handling path calls send() -- this
// exists only for the future worker (ghs#42) and this issue's own tests.
// The API is required to never perform synchronous email delivery
// (ADR-210); building this abstraction here does not create a call site,
// since nothing in src/application or src/interface imports it.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  // Not every provider/transport returns one (e.g. Mailpit's SMTP
  // acceptance doesn't guarantee a stable id) -- present when available,
  // for future observability (ADR-210 point 9), never required.
  providerMessageId?: string;
}

// Thrown by every provider's send() on failure. Classifying this as
// retryable-vs-permanent (ADR-210 point 4) is explicitly the worker's
// job, not this abstraction's -- cause carries the provider's raw error
// so that classification has enough to work with, without this file
// needing to understand any provider's specific error surface itself.
export class EmailSendError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "EmailSendError";
    this.cause = cause;
  }
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<SendResult>;
}

// Records every send in memory, never touches the network -- for tests
// (this issue's own test plan) and, once ghs#41 exists, no other
// production-code use.
export interface MockEmailProvider extends EmailProvider {
  readonly sent: EmailMessage[];
}

export function createMockEmailProvider(): MockEmailProvider {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return { providerMessageId: `mock-${sent.length}` };
    },
  };
}

// Real transport, used for both 'smtp' and 'mailpit' provider selections
// -- Mailpit IS an SMTP server; the only difference between the two is
// which connection settings apply (config.ts), never which code runs.
// transportFactory is injectable so tests can verify message-construction
// and error-translation logic against a fake transporter, without a real
// network connection or a running Mailpit instance (this issue's own
// "local SMTP test double" requirement).
export function createSmtpEmailProvider(
  config: EmailConfig,
  transportFactory: typeof nodemailer.createTransport = nodemailer.createTransport,
): EmailProvider {
  // A user with no password is never valid SMTP auth -- nodemailer would
  // otherwise silently pass `auth: { pass: undefined }` through to the
  // wire, producing a confusing auth failure far from its real cause
  // (caught in review, PR #45).
  if (config.smtp.user && !config.smtp.password) {
    throw new Error("Invalid SMTP config: smtp.user is set but smtp.password is missing");
  }

  const transporter = transportFactory({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    // Found for real during ghs#43's production verification: a claimed
    // outbox row can hang indefinitely mid-send with no error and no
    // timeout at all (e.g. a network path that completes the TCP
    // handshake but then silently drops all application-layer data --
    // reproduced there against multiple, unrelated SMTP providers, so a
    // provider-side issue was ruled out; the underlying cause was
    // infrastructure-level, not something this abstraction can fix).
    // Without an explicit timeout, nothing ever rejects, so classify.ts
    // never runs and the row never enters the retry/backoff path ADR-210
    // requires -- it just sits in 'processing' until crash-recovery's own,
    // much longer timeout eventually reclaims it. These bound that: ANY
    // genuinely unreachable or non-responding provider now fails fast
    // enough for retry/backoff to actually engage.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    async send(message) {
      try {
        const info = await transporter.sendMail({
          from: config.fromAddress,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return { providerMessageId: typeof info.messageId === "string" ? info.messageId : undefined };
      } catch (err) {
        // Normalized rather than a blind `(err as Error).message` -- a
        // non-Error throw would otherwise produce "SMTP send failed:
        // undefined" and lose whatever was actually thrown (same fix as
        // migrate.ts's own catch block, PR #37; caught in review, PR #45).
        const message = err instanceof Error ? err.message : String(err);
        throw new EmailSendError(`SMTP send failed: ${message}`, err);
      }
    },
  };
}

export function createEmailProvider(config: EmailConfig): EmailProvider {
  switch (config.provider) {
    case "mock":
      return createMockEmailProvider();
    case "smtp":
    case "mailpit":
      return createSmtpEmailProvider(config);
    default: {
      // Exhaustiveness check: if EmailProviderKind ever grows a new
      // member without a corresponding case above, this fails to compile
      // (config.provider would no longer be assignable to `never`) --
      // and if an invalid value somehow slips through at runtime anyway
      // (e.g. a cast bypassing parseEmailProviderKind's validation), this
      // throws instead of silently returning undefined (caught in
      // review, PR #45).
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown email provider: ${String(exhaustiveCheck)}`);
    }
  }
}
