import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

// ghs#112: TeeConfigurationsSection (rendered once courseQuery.data
// resolves) now calls useToast() unconditionally, matching how
// App.tsx's real tree already wraps everything in ToastProvider
// globally -- without it here, any test that mocks a successful course
// fetch would crash on render.
function renderAsRole(role: "player" | "admin" = "admin", courseId = "course-1") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/courses/${courseId}`]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
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
    {
      id: "tee-1",
      name: "Blue",
      holeCount: 9,
      courseRating: 74.1,
      slopeRating: 135,
      holes: Array.from({ length: 9 }, (_, i) => ({ id: `hole-${i + 1}`, holeNumber: i + 1, distanceYards: 380 + i, par: 4, strokeIndex: i + 1 })),
    },
  ],
};

describe("CourseDetailPage", () => {
  it("shows the course's name, location, and tee configurations for a player (read-only)", async () => {
    mock.onGet("/courses/course-1").reply(200, COURSE);
    renderAsRole("player");

    expect(await screen.findByRole("heading", { name: "Pebble Beach" })).toBeInTheDocument();
    expect(screen.getByText("Pebble Beach, US")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.getByText(/9 holes/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Course name")).not.toBeInTheDocument();
  });

  it("shows an editable form for an admin", async () => {
    mock.onGet("/courses/course-1").reply(200, COURSE);
    renderAsRole("admin");

    expect(await screen.findByLabelText("Course name")).toHaveValue("Pebble Beach");
    expect(screen.getByLabelText("City")).toHaveValue("Pebble Beach");
    expect(screen.getByLabelText("Country")).toHaveValue("US");
  });

  // Review finding, PR #132: same whitespace-only-name gap as
  // CreateCoursePage -- name's schema only checked min(1) on the raw
  // value, so a whitespace-only name passed client validation and only
  // failed once trimmed at submit time.
  it("rejects a whitespace-only name, without calling the API", async () => {
    mock.onGet("/courses/course-1").reply(200, COURSE);
    renderAsRole("admin");

    const nameInput = await screen.findByLabelText("Course name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Course name is required")).toBeInTheDocument();
    expect(mock.history.patch ?? []).toHaveLength(0);
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

  // ghs#112
  describe("tee configurations", () => {
    it("shows Add/Edit/Delete tee-configuration actions for admin, not for a player", async () => {
      mock.onGet("/courses/course-1").reply(200, COURSE);
      renderAsRole("admin");
      await screen.findByText("Blue");
      expect(screen.getByRole("button", { name: "Add tee configuration" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();

      cleanup();
      mock.onGet("/courses/course-1").reply(200, COURSE);
      renderAsRole("player");
      await screen.findByText("Blue");
      expect(screen.queryByRole("button", { name: "Add tee configuration" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });

    it("creates a tee configuration via the shared form, shows a success toast, and closes the modal", async () => {
      mock.onGet("/courses/course-1").reply(200, COURSE);
      mock.onPost("/courses/course-1/tee-configurations").reply(201, {
        id: "tee-2",
        name: "White",
        holeCount: 9,
        courseRating: 71.2,
        slopeRating: 128,
        holes: Array.from({ length: 9 }, (_, i) => ({ id: `new-hole-${i + 1}`, holeNumber: i + 1, distanceYards: 300 + i, par: 4, strokeIndex: i + 1 })),
      });

      renderAsRole("admin");
      await screen.findByText("Blue");
      await userEvent.click(screen.getByRole("button", { name: "Add tee configuration" }));
      const dialog = await screen.findByRole("dialog", { name: "Add tee configuration" });

      await userEvent.type(within(dialog).getByLabelText("Name"), "White");
      await userEvent.selectOptions(within(dialog).getByLabelText("Holes"), "9");
      await userEvent.type(within(dialog).getByLabelText("Course rating"), "71.2");
      await userEvent.type(within(dialog).getByLabelText("Slope rating"), "128");
      for (let i = 0; i < 9; i++) {
        await userEvent.type(within(dialog).getByLabelText(`Hole ${i + 1} distance in yards`), String(300 + i));
        await userEvent.type(within(dialog).getByLabelText(`Hole ${i + 1} par`), "4");
        await userEvent.type(within(dialog).getByLabelText(`Hole ${i + 1} stroke index`), String(i + 1));
      }
      await userEvent.click(within(dialog).getByRole("button", { name: "Add tee configuration" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tee configuration added."));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      const [request] = mock.history.post ?? [];
      const body = JSON.parse(request.data);
      expect(body).toMatchObject({ name: "White", holeCount: 9, courseRating: 71.2, slopeRating: 128 });
      expect(body.holes).toHaveLength(9);
    });

    it("edits an existing tee configuration, pre-filled from its real data", async () => {
      mock.onGet("/courses/course-1").reply(200, COURSE);
      mock.onPatch("/tee-configurations/tee-1").reply(200, { ...COURSE.teeConfigurations[0], name: "Blue (Updated)" });

      renderAsRole("admin");
      await screen.findByText("Blue");
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
      const dialog = await screen.findByRole("dialog", { name: "Edit tee configuration" });

      expect(within(dialog).getByLabelText("Name")).toHaveValue("Blue");
      expect(within(dialog).getByLabelText("Holes")).toHaveValue("9");
      expect(within(dialog).getByLabelText("Course rating")).toHaveValue(74.1);
      expect(within(dialog).getByLabelText("Hole 1 distance in yards")).toHaveValue(380);

      await userEvent.clear(within(dialog).getByLabelText("Name"));
      await userEvent.type(within(dialog).getByLabelText("Name"), "Blue (Updated)");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tee configuration updated."));
      const [request] = mock.history.patch!.filter((r) => r.url === "/tee-configurations/tee-1");
      expect(JSON.parse(request!.data)).toMatchObject({ name: "Blue (Updated)", holeCount: 9 });
    });

    it("deletes an unreferenced tee configuration via a real Modal confirmation", async () => {
      mock.onGet("/courses/course-1").reply(200, COURSE);
      mock.onDelete("/tee-configurations/tee-1").reply(200, { message: "Tee configuration deleted." });

      renderAsRole("admin");
      await screen.findByText("Blue");
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = await screen.findByRole("dialog", { name: "Delete tee configuration" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete tee configuration" }));

      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tee configuration deleted."));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows a clear explanation, not a raw error code, for a tee_configuration_has_rounds conflict -- modal stays open", async () => {
      mock.onGet("/courses/course-1").reply(200, COURSE);
      mock.onDelete("/tee-configurations/tee-1").reply(409, { error: "tee_configuration_has_rounds" });

      renderAsRole("admin");
      await screen.findByText("Blue");
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = await screen.findByRole("dialog", { name: "Delete tee configuration" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete tee configuration" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This tee configuration can't be deleted because it has rounds recorded against it.",
      );
      expect(screen.getByRole("dialog", { name: "Delete tee configuration" })).toBeInTheDocument();
    });
  });
});
