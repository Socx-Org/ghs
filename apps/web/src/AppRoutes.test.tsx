import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AppRoutes from "./AppRoutes";
import { ToastProvider } from "./components";
import { setTokens } from "./lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

const AUTHENTICATED_TOKENS = {
  accessToken: makeAccessToken({ sub: "user-1", email: "alice@example.com", ghs_role: "player" }),
  refreshToken: "refresh-1",
  expiresIn: 900,
};

const ADMIN_TOKENS = {
  accessToken: makeAccessToken({ sub: "admin-1", email: "admin@example.com", ghs_role: "admin" }),
  refreshToken: "refresh-2",
  expiresIn: 900,
};

// ghs#65: PlayerDashboardPage (rendered at "/" for a player role) uses
// TanStack Query -- a real QueryClientProvider ancestor is required or
// useQuery throws synchronously, same as the real App.tsx tree. retry:
// false so an unmocked network call (this file doesn't mock `api`,
// only cares about routing) settles into its error state immediately
// instead of retrying with backoff and slowing the test down.
// ghs#111: ToastProvider wraps AppRoutes here too, matching App.tsx's
// own real tree (App.tsx wraps everything in it globally) -- some
// reachable page (CourseDetailPage, since this issue) now calls
// useToast() unconditionally, so rendering AppRoutes without it would
// crash on any route that can reach it, not just /courses/:id itself.
function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  setTokens(null);
  localStorage.clear();
});

describe("AppRoutes", () => {
  it("renders the login form at /login when unauthenticated", () => {
    renderAt("/login");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects / to /login when unauthenticated", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("renders the player dashboard at / for a player (ghs#65)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/");
    // "Recent rounds" is static JSX, not gated behind either query's
    // state -- a deterministic marker that PlayerDashboardPage rendered,
    // regardless of how its (unmocked, in this routing-focused file)
    // network calls resolve.
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
  });

  it("renders the dashboard placeholder at / for a non-player (admin) -- PlayerDashboardPage is player-only (ghs#65)", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/");
    expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
    // ghs#96: AccountMenu's own trigger also shows the email now (a
    // second real element, not a bug) -- getAllByText, not getByText,
    // since more than one match is expected and correct here.
    expect(screen.getAllByText("admin@example.com", { exact: false }).length).toBeGreaterThan(0);
  });

  it("redirects /login to / when already authenticated", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/login");
    expect(screen.queryByRole("heading", { name: "Sign in to your account" })).not.toBeInTheDocument();
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
  });

  it("shows the 404 page (not a redirect) for an unknown route when unauthenticated (ghs#102)", () => {
    renderAt("/some/unknown/path");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to your account" })).not.toBeInTheDocument();
  });

  it("shows the 404 page inside the real shell for an unknown route when authenticated (ghs#102)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/some/unknown/path");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    // Proof it's rendered inside AppShell, not the bare unauthenticated
    // wrapper -- the sidebar/account menu are real shell chrome.
    expect(screen.getByRole("link", { name: /Dashboard/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });

  it("redirects /profile to /login when unauthenticated (ghs#108)", () => {
    renderAt("/profile");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("renders the profile screen at /profile for an authenticated player (ghs#108)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/profile");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });

  it("renders the profile screen at /profile for an authenticated admin too, ghs#108 -- not admin-gated", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/profile");
    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
  });

  it("redirects /courses to /login when unauthenticated (ghs#109)", () => {
    renderAt("/courses");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("renders the course list at /courses for an authenticated player, ghs#109 -- no role restriction on viewing", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/courses");
    expect(screen.getByRole("heading", { name: "Courses" })).toBeInTheDocument();
  });

  it("renders the course list at /courses for an authenticated admin (ghs#109)", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/courses");
    expect(screen.getByRole("heading", { name: "Courses" })).toBeInTheDocument();
  });

  it("redirects /courses/new to /login when unauthenticated (ghs#110)", () => {
    renderAt("/courses/new");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects /courses/new to / for an authenticated non-admin (ghs#110)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/courses/new");
    expect(screen.queryByRole("heading", { name: "Create course" })).not.toBeInTheDocument();
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
  });

  it("renders the create-course form at /courses/new for an admin (ghs#110)", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/courses/new");
    expect(screen.getByRole("heading", { name: "Create course" })).toBeInTheDocument();
  });

  it("redirects /courses/:id to /login when unauthenticated (ghs#110)", () => {
    renderAt("/courses/some-course-id");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("renders the course detail screen at /courses/:id for an authenticated player, ghs#110 -- no role restriction on viewing", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/courses/some-course-id");
    // "Course details" is static JSX, rendered regardless of how the
    // (unmocked, in this routing-focused file) course query resolves --
    // a deterministic marker that CourseDetailPage rendered.
    expect(screen.getByText("Course details")).toBeInTheDocument();
  });

  it("redirects /admin/rounds/pending to /login when unauthenticated (ghs#67)", () => {
    renderAt("/admin/rounds/pending");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects /admin/rounds/pending to / for an authenticated non-admin (ghs#67)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/admin/rounds/pending");
    expect(screen.queryByRole("heading", { name: "Pending rounds" })).not.toBeInTheDocument();
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
  });

  it("renders the pending queue at /admin/rounds/pending for an admin (ghs#67)", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/admin/rounds/pending");
    expect(screen.getByRole("heading", { name: "Pending rounds" })).toBeInTheDocument();
  });

  it("redirects /admin/rounds/:id to /login when unauthenticated (ghs#67)", () => {
    renderAt("/admin/rounds/some-round-id");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects /admin/rounds to /login when unauthenticated (ghs#113)", () => {
    renderAt("/admin/rounds");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects /admin/rounds to / for an authenticated non-admin (ghs#113)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/admin/rounds");
    expect(screen.queryByRole("heading", { name: "All rounds" })).not.toBeInTheDocument();
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
  });

  it("renders the all-rounds list at /admin/rounds for an admin, not confused with /admin/rounds/pending (ghs#113)", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/admin/rounds");
    expect(screen.getByRole("heading", { name: "All rounds" })).toBeInTheDocument();
  });

  it("renders the round-review screen at /admin/rounds/:id for an admin (ghs#67)", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/admin/rounds/some-round-id");
    expect(screen.getByRole("heading", { name: "Review round" })).toBeInTheDocument();
  });

  it("redirects /admin/users/new to /login when unauthenticated (ghs#86)", () => {
    renderAt("/admin/users/new");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("redirects /admin/users/new to / for an authenticated non-admin (ghs#86)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/admin/users/new");
    expect(screen.queryByRole("heading", { name: "Create account" })).not.toBeInTheDocument();
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
  });

  it("renders the admin create-user form at /admin/users/new for an admin (ghs#86)", () => {
    setTokens(ADMIN_TOKENS);
    renderAt("/admin/users/new");
    expect(screen.getByRole("heading", { name: "Create account" })).toBeInTheDocument();
  });

  it("redirects /rounds/new to /login when unauthenticated (ghs#94)", () => {
    renderAt("/rounds/new");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("renders the new-round form at /rounds/new for an authenticated player (ghs#94)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/rounds/new");
    expect(screen.getByRole("heading", { name: "Start a round" })).toBeInTheDocument();
  });

  it("redirects /rounds/:id to /login when unauthenticated (ghs#94)", () => {
    renderAt("/rounds/some-round-id");
    expect(screen.getByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("renders the round entry screen at /rounds/:id for an authenticated player (ghs#94)", () => {
    setTokens(AUTHENTICATED_TOKENS);
    renderAt("/rounds/some-round-id");
    // "← Back" is static JSX, rendered regardless of how the (unmocked,
    // in this routing-focused file) round/tee-configuration queries
    // resolve -- a deterministic marker that RoundEntryPage rendered.
    expect(screen.getByRole("button", { name: "← Back" })).toBeInTheDocument();
  });
});
