import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function renderAsRole(role: "player" | "admin" = "admin", courseId = "course-1") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/courses/${courseId}`]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COURSE = {
  id: "course-1",
  clubId: null,
  name: "Pebble Beach",
  city: "Pebble Beach",
  country: "US",
  teeConfigurations: [
    { id: "tee-1", name: "Blue", holeCount: 18, courseRating: 74.1, slopeRating: 135, holes: [] },
  ],
};

describe("CourseDetailPage", () => {
  it("shows the course's name, location, and tee configurations for a player (read-only)", async () => {
    mock.onGet("/courses/course-1").reply(200, COURSE);
    renderAsRole("player");

    expect(await screen.findByRole("heading", { name: "Pebble Beach" })).toBeInTheDocument();
    expect(screen.getByText("Pebble Beach, US")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.getByText(/18 holes/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Course name")).not.toBeInTheDocument();
  });

  it("shows an editable form for an admin", async () => {
    mock.onGet("/courses/course-1").reply(200, COURSE);
    renderAsRole("admin");

    expect(await screen.findByLabelText("Course name")).toHaveValue("Pebble Beach");
    expect(screen.getByLabelText("City")).toHaveValue("Pebble Beach");
    expect(screen.getByLabelText("Country")).toHaveValue("US");
  });

  it("shows a not-found message for a 404, distinct from a generic error", async () => {
    mock.onGet("/courses/course-1").reply(404, { error: "course not found" });
    renderAsRole("admin");

    expect(await screen.findByRole("alert")).toHaveTextContent("This course doesn't exist, or has been deleted.");
  });

  it("shows the server's real error message for a non-404 failure", async () => {
    mock.onGet("/courses/course-1").reply(500, { error: "unexpected failure" });
    renderAsRole("admin");

    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected failure");
  });

  it("saves changes via PATCH, sending name/city/country every time", async () => {
    mock.onGet("/courses/course-1").reply(200, COURSE);
    mock.onPatch("/courses/course-1").reply(200, { ...COURSE, name: "Pebble Beach Golf Links" });

    renderAsRole("admin");
    const nameInput = await screen.findByLabelText("Course name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Pebble Beach Golf Links");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Course updated."));
    const [request] = mock.history.patch ?? [];
    expect(JSON.parse(request.data)).toEqual({ name: "Pebble Beach Golf Links", city: "Pebble Beach", country: "US" });
  });

  it("sends null for city/country when cleared, not an empty string", async () => {
    mock.onGet("/courses/course-1").reply(200, COURSE);
    mock.onPatch("/courses/course-1").reply(200, { ...COURSE, city: null, country: null });

    renderAsRole("admin");
    const cityInput = await screen.findByLabelText("City");
    await userEvent.clear(cityInput);
    await userEvent.clear(screen.getByLabelText("Country"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    const [request] = mock.history.patch ?? [];
    expect(JSON.parse(request.data)).toEqual({ name: "Pebble Beach", city: null, country: null });
  });

  it("shows the server's error message via a form-level alert on save failure", async () => {
    mock.onGet("/courses/course-1").reply(200, COURSE);
    mock.onPatch("/courses/course-1").reply(409, { error: "a course with this name and country already exists" });

    renderAsRole("admin");
    await screen.findByLabelText("Course name");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("a course with this name and country already exists");
  });
});
