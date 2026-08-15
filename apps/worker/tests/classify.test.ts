import { test } from "node:test";
import assert from "node:assert/strict";
import { EmailSendError } from "@ghs/api/lib/email";
import { classifyFailure } from "../src/application/classify.ts";

// Pure unit tests -- no DB, no network (ENG-030.3).

test("an SMTP 5xx response is permanent -- real SMTP semantics (RFC 5321: hard rejection), not the ADR's generic HTTP-flavoured illustration", () => {
  const err = new EmailSendError("SMTP send failed: 550 no such user", { responseCode: 550 });
  assert.equal(classifyFailure(err), "permanent");
});

test("an SMTP 4xx response is retryable -- real SMTP semantics (temporary failure, e.g. mailbox full/greylisting)", () => {
  const err = new EmailSendError("SMTP send failed: 421 try again later", { responseCode: 421 });
  assert.equal(classifyFailure(err), "retryable");
});

test("a network-level connection error (no SMTP response at all) is retryable", () => {
  const err = new EmailSendError("SMTP send failed: connect ECONNREFUSED", { code: "ECONNREFUSED" });
  assert.equal(classifyFailure(err), "retryable");
});

test("a timeout is retryable", () => {
  const err = new EmailSendError("SMTP send failed: timeout", { code: "ETIMEDOUT" });
  assert.equal(classifyFailure(err), "retryable");
});

test("an unclassifiable error shape defaults to retryable -- the safer failure mode (bounded cost: at most MAX_ATTEMPTS-1 wasted retries either way)", () => {
  assert.equal(classifyFailure(new Error("something unexpected")), "retryable");
  assert.equal(classifyFailure("a raw string throw"), "retryable");
  assert.equal(classifyFailure(undefined), "retryable");
});

test("classification looks through EmailSendError to the real provider error (cause), not the wrapper's own message", () => {
  const err = new EmailSendError("SMTP send failed: 550 rejected", { responseCode: 550, message: "550 rejected" });
  assert.equal(classifyFailure(err), "permanent");
});
