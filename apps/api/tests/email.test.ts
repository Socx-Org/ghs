import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMockEmailProvider,
  createSmtpEmailProvider,
  createEmailProvider,
  EmailSendError,
} from "../src/lib/email.ts";
import type { EmailConfig } from "../src/config.ts";
import { parseEmailProviderKind } from "../src/config.ts";

// Pure unit tests -- no network, no real SMTP/Mailpit connection (ENG-030.3).
// The SMTP provider's transportFactory is injectable specifically so these
// tests can verify message-construction and error-translation logic
// against a fake nodemailer transporter, matching this issue's own "local
// SMTP test double" requirement without a real running Mailpit instance.

function smtpConfig(overrides: Partial<EmailConfig> = {}): EmailConfig {
  return {
    provider: "smtp",
    fromAddress: "noreply@ghs.test",
    smtp: { host: "127.0.0.1", port: 1025, secure: false },
    ...overrides,
  };
}

test("parseEmailProviderKind (EMAIL_PROVIDER config parsing) accepts exactly the three real values and rejects everything else at startup", () => {
  assert.equal(parseEmailProviderKind("mailpit"), "mailpit");
  assert.equal(parseEmailProviderKind("smtp"), "smtp");
  assert.equal(parseEmailProviderKind("mock"), "mock");
  assert.throws(() => parseEmailProviderKind("sendgrid"), /Invalid EMAIL_PROVIDER 'sendgrid'/, "sendgrid/ses are named in ADR-210 point 10's aspirational shape but not built (ghs#40) -- must fail fast at startup, not silently misconfigure");
  assert.throws(() => parseEmailProviderKind(""), /Invalid EMAIL_PROVIDER/);
});

test("mock provider records every send in memory and never throws", async () => {
  const provider = createMockEmailProvider();

  const result = await provider.send({ to: "player@example.com", subject: "Round approved", text: "Your round was approved." });

  assert.equal(provider.sent.length, 1);
  assert.deepEqual(provider.sent[0], { to: "player@example.com", subject: "Round approved", text: "Your round was approved." });
  assert.ok(result.providerMessageId);
});

test("smtp provider constructs the real transport message from config.fromAddress and the given EmailMessage", async () => {
  const calls: unknown[] = [];
  const fakeTransportFactory = (() => ({
    async sendMail(mail: unknown) {
      calls.push(mail);
      return { messageId: "<real-message-id@ghs.test>" };
    },
  })) as unknown as typeof import("nodemailer").createTransport;

  const provider = createSmtpEmailProvider(smtpConfig(), fakeTransportFactory);
  const result = await provider.send({ to: "admin@example.com", subject: "Handicap changed", text: "plain", html: "<p>html</p>" });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    from: "noreply@ghs.test",
    to: "admin@example.com",
    subject: "Handicap changed",
    text: "plain",
    html: "<p>html</p>",
  });
  assert.equal(result.providerMessageId, "<real-message-id@ghs.test>");
});

test("smtp provider passes auth through only when an smtp user is configured -- matches Mailpit's no-auth default", () => {
  const seenOptions: unknown[] = [];
  const fakeTransportFactory = ((options: unknown) => {
    seenOptions.push(options);
    return { async sendMail() { return {}; } };
  }) as unknown as typeof import("nodemailer").createTransport;

  createSmtpEmailProvider(smtpConfig({ smtp: { host: "127.0.0.1", port: 1025, secure: false } }), fakeTransportFactory);
  assert.equal((seenOptions[0] as { auth?: unknown }).auth, undefined);

  createSmtpEmailProvider(
    smtpConfig({ smtp: { host: "smtp.real-provider.test", port: 587, secure: true, user: "real-user", password: "real-pass" } }),
    fakeTransportFactory,
  );
  assert.deepEqual((seenOptions[1] as { auth?: unknown }).auth, { user: "real-user", pass: "real-pass" });
});

test("createSmtpEmailProvider fails fast when smtp.user is set without a password, rather than silently sending auth: { pass: undefined }", () => {
  assert.throws(
    () => createSmtpEmailProvider(smtpConfig({ smtp: { host: "smtp.real-provider.test", port: 587, secure: true, user: "real-user" } })),
    /smtp.user is set but smtp.password is missing/,
  );
});

test("createEmailProvider throws for a provider value outside the known union, instead of returning undefined", () => {
  const bogusConfig = { ...smtpConfig(), provider: "sendgrid" } as unknown as EmailConfig;
  assert.throws(() => createEmailProvider(bogusConfig), /Unknown email provider: sendgrid/);
});

test("smtp provider translates a transport failure into a classifiable EmailSendError, never lets the raw provider error escape uncaught", async () => {
  const fakeTransportFactory = (() => ({
    async sendMail() {
      throw new Error("ECONNREFUSED");
    },
  })) as unknown as typeof import("nodemailer").createTransport;

  const provider = createSmtpEmailProvider(smtpConfig(), fakeTransportFactory);

  await assert.rejects(
    () => provider.send({ to: "player@example.com", subject: "x", text: "x" }),
    (err: unknown) => {
      assert.ok(err instanceof EmailSendError);
      assert.match(err.message, /ECONNREFUSED/);
      assert.ok(err.cause instanceof Error, "the raw provider error is preserved as cause -- ghs#42's worker classifies retryable-vs-permanent from it (ADR-210 point 4), not this abstraction");
      return true;
    },
  );
});

test("createEmailProvider selects the mock provider for provider: 'mock'", async () => {
  const provider = createEmailProvider({ provider: "mock", fromAddress: "noreply@ghs.test", smtp: { host: "127.0.0.1", port: 1025, secure: false } });
  await provider.send({ to: "x@example.com", subject: "x", text: "x" });
  assert.ok((provider as ReturnType<typeof createMockEmailProvider>).sent.length === 1, "config-selected provider must actually be the mock implementation, not just structurally compatible");
});

test("createEmailProvider selects a real SMTP transport for both 'smtp' and 'mailpit' -- the only difference is connection settings, never which code runs (ADR-210 point 10)", () => {
  const smtpProvider = createEmailProvider(smtpConfig({ provider: "smtp" }));
  const mailpitProvider = createEmailProvider(smtpConfig({ provider: "mailpit" }));

  assert.equal(typeof smtpProvider.send, "function");
  assert.equal(typeof mailpitProvider.send, "function");
  // Neither is the mock implementation -- distinguished by absence of the
  // mock's own diagnostic 'sent' array (the SMTP provider intentionally
  // exposes no such introspection surface).
  assert.equal((smtpProvider as Partial<ReturnType<typeof createMockEmailProvider>>).sent, undefined);
  assert.equal((mailpitProvider as Partial<ReturnType<typeof createMockEmailProvider>>).sent, undefined);
});
