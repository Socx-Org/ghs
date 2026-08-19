import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import { setTokens } from "../lib/auth-store";

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

function renderShell() {
  setTokens({
    accessToken: makeAccessToken({ sub: "user-1", email: "player@example.com", ghs_role: "player" }),
    refreshToken: "refresh-1",
    expiresIn: 900,
  });
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>Real page content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("renders the sidebar, header account menu, page content, and footer together", () => {
    renderShell();
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
    expect(screen.getByText("Real page content")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("opens the mobile navigation drawer via the header's hamburger trigger", async () => {
    renderShell();
    // The mobile drawer's own nav entries aren't in the document until
    // opened -- the desktop Sidebar's identical-looking links already
    // exist, so this specifically confirms a *second* set appears.
    expect(screen.getAllByRole("link", { name: /Dashboard/ })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(screen.getAllByRole("link", { name: /Dashboard/ })).toHaveLength(2);
  });
});
