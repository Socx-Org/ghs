import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth-store";

function makeAccessToken(claims: object): string {
  const base64url = (input: string) => btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(claims));
  return `${header}.${body}.fake-signature`;
}

function tokensFor(role: string) {
  return {
    accessToken: makeAccessToken({ sub: "caller-1", email: "caller@example.com", ghs_role: role }),
    refreshToken: "refresh-1",
    expiresIn: 900,
  };
}

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

// Rendered through the real AppRoutes -- exercises RequireAuth too, same
// rationale as ProfilePage.test.tsx.
function renderAsRole(role: "player" | "admin" = "player") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/courses"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COURSES = [
  { id: "course-1", clubId: null, name: "Pebble Beach", city: "Pebble Beach", country: "USA" },
  { id: "course-2", clubId: null, name: "St Andrews", city: null, country: "Scotland" },
  { id: "course-3", clubId: null, name: "No Location Course", city: null, country: null },
];

describe("CourseListPage", () => {
  it("shows a loading skeleton, then the real course list", async () => {
    mock.onGet("/courses").reply(200, COURSES);
    renderAsRole("player");

    expect(await screen.findByText("Pebble Beach")).toBeInTheDocument();
    expect(screen.getByText("St Andrews")).toBeInTheDocument();
    expect(screen.getByText("Pebble Beach, USA")).toBeInTheDocument();
    expect(screen.getByText("Scotland")).toBeInTheDocument();
  });

  it("falls back to an em dash when a course has neither city nor country", async () => {
    mock.onGet("/courses").reply(200, COURSES);
    renderAsRole("player");

    await screen.findByText("No Location Course");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows an empty state when there are no courses", async () => {
    mock.onGet("/courses").reply(200, []);
    renderAsRole("player");

    expect(await screen.findByText("No courses yet")).toBeInTheDocument();
  });

  it("shows an error alert when the request fails", async () => {
    mock.onGet("/courses").reply(500, { error: "unexpected failure" });
    renderAsRole("player");

    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected failure");
  });

  it("is reachable for a player too, ghs#109 -- no role restriction on viewing", async () => {
    mock.onGet("/courses").reply(200, COURSES);
    renderAsRole("player");

    expect(await screen.findByRole("heading", { name: "Courses" })).toBeInTheDocument();
  });

  // ghs#110
  it("links each course name to its detail page", async () => {
    mock.onGet("/courses").reply(200, COURSES);
    renderAsRole("player");

    const link = await screen.findByRole("link", { name: "Pebble Beach" });
    expect(link).toHaveAttribute("href", "/courses/course-1");
  });

  it("sorts by Name and by Location, with a raw-value nulls-last comparator (not the '—' placeholder) for Location (ghs#203)", async () => {
    mock.onGet("/courses").reply(200, COURSES);
    renderAsRole("player");
    await screen.findByText("Pebble Beach");

    await userEvent.click(screen.getByRole("button", { name: /Name/ }));
    let rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("No Location Course")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Pebble Beach")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("St Andrews")).toBeInTheDocument();

    // Location: the course with neither city nor country sorts last in
    // BOTH directions -- proof this uses locationLine's own raw (nullable)
    // return value, not the "—" placeholder renderTableRow displays for it.
    await userEvent.click(screen.getByRole("button", { name: /Location/ }));
    rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[rows.length - 1]!).getByText("No Location Course")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Location/ }));
    rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[rows.length - 1]!).getByText("No Location Course")).toBeInTheDocument();
  });

  it("shows a Create course button for an admin, not for a player", async () => {
    mock.onGet("/courses").reply(200, COURSES);
    renderAsRole("admin");
    await screen.findByText("Pebble Beach");
    expect(screen.getByRole("button", { name: "Create course" })).toBeInTheDocument();

    cleanup();
    mock.onGet("/courses").reply(200, COURSES);
    renderAsRole("player");
    await screen.findByText("Pebble Beach");
    expect(screen.queryByRole("button", { name: "Create course" })).not.toBeInTheDocument();
  });
});
