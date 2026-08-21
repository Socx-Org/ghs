import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import MockAdapter from "axios-mock-adapter";
import { AccountMenu } from "./AccountMenu";
import { bootstrapClient } from "../../lib/api";
import { setTokens, getTokens } from "../../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

let mock: MockAdapter;

afterEach(() => {
  cleanup();
  mock?.restore();
  setTokens(null);
});

function renderMenu(role = "player") {
  mock = new MockAdapter(bootstrapClient);
  mock.onPost("/auth/logout").reply(200, { message: "Logged out." });
  setTokens({
    accessToken: makeAccessToken({ sub: "user-1", email: "player@example.com", ghs_role: role }),
    refreshToken: "refresh-1",
    expiresIn: 900,
  });
  return render(
    <MemoryRouter>
      <AccountMenu />
    </MemoryRouter>,
  );
}

describe("AccountMenu", () => {
  it("renders a trigger with a stable accessible name, panel closed by default", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Sign out/ })).not.toBeInTheDocument();
  });

  it("opens on click, showing the user's email/role and Sign out -- not a hover-only menu", async () => {
    renderMenu("admin");
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));

    expect(screen.getByRole("button", { name: "Account menu" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText("player@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeInTheDocument();
  });

  it("includes a Profile link to /profile, ghs#108", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));

    const profileLink = screen.getByRole("link", { name: "Profile" });
    expect(profileLink).toHaveAttribute("href", "/profile");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Account menu" });
    await userEvent.click(trigger);
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: /Sign out/ })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on an outside click", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeInTheDocument();

    await userEvent.click(document.body);

    expect(screen.queryByRole("button", { name: /Sign out/ })).not.toBeInTheDocument();
  });

  it("signs out via the real logout flow, clearing local auth state", async () => {
    renderMenu();
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: /Sign out/ }));

    // logout() clears local auth state regardless of network outcome
    // (established behaviour, ghs#63) -- the observable proof, not a
    // mocked callback.
    await waitFor(() => expect(getTokens()).toBeNull());
  });
});
