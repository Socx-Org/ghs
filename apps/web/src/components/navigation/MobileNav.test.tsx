import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MobileNav } from "./MobileNav";
import { setTokens } from "../../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

afterEach(() => {
  cleanup();
  setTokens(null);
});

// A small controlled wrapper -- MobileNav is a real open/onClose
// controlled component (same convention as Modal), so exercising its
// own "closes on selection" behaviour needs a real parent state, not
// just a fixed `open` prop.
function ControlledMobileNav({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <MobileNav
      open={open}
      onClose={() => {
        setOpen(false);
        onClose?.();
      }}
    />
  );
}

function renderMobileNav(props: { open?: boolean; onClose?: () => void; role?: string } = {}) {
  setTokens({
    accessToken: makeAccessToken({ sub: "user-1", email: "a@example.com", ghs_role: props.role ?? "player" }),
    refreshToken: "refresh-1",
    expiresIn: 900,
  });
  if (props.open === undefined) {
    return render(
      <MemoryRouter>
        <ControlledMobileNav onClose={props.onClose} />
      </MemoryRouter>,
    );
  }
  return render(
    <MemoryRouter>
      <MobileNav open={props.open} onClose={props.onClose ?? (() => {})} />
    </MemoryRouter>,
  );
}

describe("MobileNav", () => {
  it("is not visible when closed", () => {
    renderMobileNav({ open: false });
    expect(screen.queryByRole("link", { name: /Dashboard/ })).not.toBeInTheDocument();
  });

  it("shows the nav entries when open", () => {
    renderMobileNav();
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New Round/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Courses$/ })).toBeInTheDocument();
  });

  // ghs#109: review finding, PR #130 -- the PR description claimed this
  // file covers every role, but renderMobileNav previously hardcoded
  // "player" with no way to override it, so the claim was never actually
  // exercised here. Matches Sidebar.test.tsx's own equivalent case.
  it("shows Courses for every role, ghs#109 -- no role restriction on viewing", () => {
    renderMobileNav({ role: "admin" });
    expect(screen.getByRole("link", { name: /^Courses$/ })).toBeInTheDocument();
  });

  it("shows Pending Rounds for admin, not for a player (ghs#67)", () => {
    renderMobileNav({ role: "admin" });
    expect(screen.getByRole("link", { name: /Pending Rounds/ })).toBeInTheDocument();

    cleanup();
    renderMobileNav({ role: "player" });
    expect(screen.queryByRole("link", { name: /Pending Rounds/ })).not.toBeInTheDocument();
  });

  it("shows All Rounds for admin, not for a player (ghs#113)", () => {
    renderMobileNav({ role: "admin" });
    expect(screen.getByRole("link", { name: /All Rounds/ })).toBeInTheDocument();

    cleanup();
    renderMobileNav({ role: "player" });
    expect(screen.queryByRole("link", { name: /All Rounds/ })).not.toBeInTheDocument();
  });

  it("closes on selecting a nav item", async () => {
    const onClose = vi.fn();
    renderMobileNav({ onClose });
    await userEvent.click(screen.getByRole("link", { name: /New Round/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes via its own close button", async () => {
    const onClose = vi.fn();
    renderMobileNav({ onClose });
    await userEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(onClose).toHaveBeenCalled();
  });
});
