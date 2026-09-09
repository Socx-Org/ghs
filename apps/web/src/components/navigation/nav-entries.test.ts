import { describe, expect, it } from "vitest";
import { isNavEntryActive } from "./nav-entries";
import type { NavEntry } from "./nav-entries";
import { History } from "lucide-react";

// A minimal fixture matching the real /admin/rounds* collision this
// helper exists to resolve (ghs#211) -- the icon is irrelevant to the
// logic under test, so every entry shares one.
function entry(to: string): NavEntry {
  return { to, label: to, icon: History };
}

const DASHBOARD = entry("/");
const ALL_ROUNDS = entry("/admin/rounds");
const PENDING_ROUNDS = entry("/admin/rounds/pending");
const ENTRIES = [DASHBOARD, ALL_ROUNDS, PENDING_ROUNDS];

describe("isNavEntryActive", () => {
  it("ghs#211: a sibling route (/admin/rounds/pending) activates only its own, more specific entry -- not the shorter-prefix sibling it also starts with", () => {
    expect(isNavEntryActive(PENDING_ROUNDS, ENTRIES, "/admin/rounds/pending")).toBe(true);
    expect(isNavEntryActive(ALL_ROUNDS, ENTRIES, "/admin/rounds/pending")).toBe(false);
  });

  it("an exact match activates its own entry", () => {
    expect(isNavEntryActive(ALL_ROUNDS, ENTRIES, "/admin/rounds")).toBe(true);
    expect(isNavEntryActive(PENDING_ROUNDS, ENTRIES, "/admin/rounds")).toBe(false);
  });

  it("a genuine child route (/admin/rounds/:id) activates the parent entry, since no more specific sibling matches it", () => {
    expect(isNavEntryActive(ALL_ROUNDS, ENTRIES, "/admin/rounds/some-round-id")).toBe(true);
  });

  it("the root entry only matches an exact '/' -- never a prefix", () => {
    expect(isNavEntryActive(DASHBOARD, ENTRIES, "/")).toBe(true);
    expect(isNavEntryActive(DASHBOARD, ENTRIES, "/admin/rounds")).toBe(false);
    expect(isNavEntryActive(DASHBOARD, ENTRIES, "/anything")).toBe(false);
  });

  it("an unrelated path matches nothing", () => {
    expect(isNavEntryActive(ALL_ROUNDS, ENTRIES, "/courses")).toBe(false);
    expect(isNavEntryActive(PENDING_ROUNDS, ENTRIES, "/courses")).toBe(false);
  });

  it("a path that only partially overlaps a `to` (no '/' boundary) does not match -- e.g. /admin/roundsomething must not activate /admin/rounds", () => {
    expect(isNavEntryActive(ALL_ROUNDS, ENTRIES, "/admin/roundsomething")).toBe(false);
  });
});
