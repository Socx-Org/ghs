import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
import { ToastProvider } from "../components";
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

// ghs#111: a successful create navigates to CourseDetailPage, which
// now calls useToast() unconditionally -- same reasoning as
// AppRoutes.test.tsx's own renderAt fix.
function renderAsRole(role: "player" | "admin" = "admin") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/courses/new"]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("CreateCoursePage", () => {
  it("redirects a non-admin away, ghs#110 -- admin-only at the route level, unlike /courses/:id", () => {
    renderAsRole("player");
    expect(screen.queryByRole("heading", { name: "Create course" })).not.toBeInTheDocument();
  });

  it("shows client-side validation errors without calling the API", async () => {
    renderAsRole("admin");
    await userEvent.click(screen.getByRole("button", { name: "Create course" }));

    expect(await screen.findByText("Course name is required")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  // Review finding, PR #132: name's schema previously only checked
  // min(1) on the raw value, so a whitespace-only name passed client
  // validation and only failed once trimmed at submit time (either
  // silently, or with a confusing server-side rejection).
  it("rejects a whitespace-only name, without calling the API", async () => {
    renderAsRole("admin");
    await userEvent.type(screen.getByLabelText("Course name"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create course" }));

    expect(await screen.findByText("Course name is required")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  it("rejects a country that isn't a 2-letter code, without calling the API", async () => {
    renderAsRole("admin");
    await userEvent.type(screen.getByLabelText("Course name"), "Test Course");
    // A single character, not "USA" -- the Input's own maxLength={2}
    // (a real UX guard, matching the backend's CHAR(2) column) makes a
    // 3-character value physically untypeable via userEvent.type, same
    // as a real browser.
    await userEvent.type(screen.getByLabelText("Country"), "U");
    await userEvent.click(screen.getByRole("button", { name: "Create course" }));

    expect(await screen.findByText("Country must be a 2-letter code, e.g. US")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  it("creates a course and navigates to its detail page", async () => {
    mock.onPost("/courses").reply(201, { id: "new-course-1", clubId: null, name: "Test Course", city: "Test City", country: "US", teeConfigurations: [] });
    mock.onGet("/courses/new-course-1").reply(200, { id: "new-course-1", clubId: null, name: "Test Course", city: "Test City", country: "US", teeConfigurations: [] });

    renderAsRole("admin");
    await userEvent.type(screen.getByLabelText("Course name"), "Test Course");
    await userEvent.type(screen.getByLabelText("City"), "Test City");
    await userEvent.type(screen.getByLabelText("Country"), "us");
    await userEvent.click(screen.getByRole("button", { name: "Create course" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Test Course" })).toBeInTheDocument());
    const [request] = mock.history.post ?? [];
    expect(JSON.parse(request.data)).toEqual({ name: "Test Course", city: "Test City", country: "US" });
  });

  it("omits city/country from the request when left blank", async () => {
    mock.onPost("/courses").reply(201, { id: "new-course-2", clubId: null, name: "Bare Course", city: null, country: null, teeConfigurations: [] });
    mock.onGet("/courses/new-course-2").reply(200, { id: "new-course-2", clubId: null, name: "Bare Course", city: null, country: null, teeConfigurations: [] });

    renderAsRole("admin");
    await userEvent.type(screen.getByLabelText("Course name"), "Bare Course");
    await userEvent.click(screen.getByRole("button", { name: "Create course" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Bare Course" })).toBeInTheDocument());
    const [request] = mock.history.post ?? [];
    expect(JSON.parse(request.data)).toEqual({ name: "Bare Course" });
  });

  it("shows the server's error message via a form-level alert", async () => {
    mock.onPost("/courses").reply(409, { error: "a course with this name and country already exists" });

    renderAsRole("admin");
    await userEvent.type(screen.getByLabelText("Course name"), "Duplicate Course");
    await userEvent.click(screen.getByRole("button", { name: "Create course" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("a course with this name and country already exists");
  });
});
