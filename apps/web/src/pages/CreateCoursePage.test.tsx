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

// ghs#111/#112: a successful create navigates to CourseDetailPage,
// which (and whose TeeConfigurationsSection) now call useToast()
// unconditionally -- same reasoning as AppRoutes.test.tsx's and
// CourseDetailPage.test.tsx's own renderAsRole/renderAt fixes.
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

  // ghs#155: Load from CSV mode.
  describe("Load from CSV", () => {
    const VALID_CSV =
      "course_id,course_name,course_city,course_country,configuration_id,configuration_name,tee_colour,hole_count,course_rating,slope_rating,hole_number,distance_yards,par,stroke_index\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,1,300,4,1\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,2,310,4,2\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,3,320,4,3\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,4,330,4,4\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,5,340,4,5\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,6,350,4,6\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,7,360,4,7\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,8,370,4,8\n" +
      "c1,CSV Course,CSV City,US,cfg1,Blue,Blue,9,68.5,120,9,380,4,9\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,1,300,5,1\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,2,310,4,2\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,3,320,4,3\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,4,330,5,4\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,5,340,4,5\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,6,350,4,6\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,7,360,5,7\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,8,370,4,8\n" +
      "c1,CSV Course,CSV City,US,cfg2,Members,White,9,,,9,380,4,9";

    function csvFile(text: string, name = "course.csv") {
      return new File([text], name, { type: "text/csv" });
    }

    it("switches to the CSV form via the toggle, hiding the manual fields", async () => {
      renderAsRole("admin");
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));

      expect(screen.queryByLabelText("Course name")).not.toBeInTheDocument();
      expect(screen.getByLabelText("CSV file")).toBeInTheDocument();
    });

    it("shows a preview naming each tee configuration found and its outcome, before any submit happens", async () => {
      renderAsRole("admin");
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));
      await userEvent.upload(screen.getByLabelText("CSV file"), csvFile(VALID_CSV));

      expect(await screen.findByText("CSV Course")).toBeInTheDocument();
      expect(screen.getByText("CSV City, US")).toBeInTheDocument();
      expect(screen.getByText(/Tee configurations found \(1 of 2 will import\)/)).toBeInTheDocument();
      expect(screen.getByText("Blue")).toBeInTheDocument();
      expect(screen.getByText("Will import")).toBeInTheDocument();
      expect(screen.getByText("Members (White)")).toBeInTheDocument();
      expect(screen.getByText("Skipped")).toBeInTheDocument();
      expect(screen.getByText(/course rating/i)).toBeInTheDocument();
      // No request yet -- the preview is shown before any submit.
      expect(mock.history.post ?? []).toHaveLength(0);
    });

    it("submits only the valid tee configuration(s) and navigates to the new course's detail page", async () => {
      mock.onPost("/courses").reply(201, { id: "csv-course-1", clubId: null, name: "CSV Course", city: "CSV City", country: "US", teeConfigurations: [] });
      mock.onGet("/courses/csv-course-1").reply(200, { id: "csv-course-1", clubId: null, name: "CSV Course", city: "CSV City", country: "US", teeConfigurations: [] });

      renderAsRole("admin");
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));
      await userEvent.upload(screen.getByLabelText("CSV file"), csvFile(VALID_CSV));
      await screen.findByText("CSV Course");
      await userEvent.click(screen.getByRole("button", { name: "Create course" }));

      await waitFor(() => expect(screen.getByRole("heading", { name: "CSV Course" })).toBeInTheDocument());
      const [request] = mock.history.post ?? [];
      const body = JSON.parse(request.data);
      expect(body.name).toBe("CSV Course");
      expect(body.city).toBe("CSV City");
      expect(body.country).toBe("US");
      // Only the Blue configuration -- Members was skipped (no rating).
      expect(body.teeConfigurations).toHaveLength(1);
      expect(body.teeConfigurations[0].name).toBe("Blue");
      expect(body.teeConfigurations[0].holes).toHaveLength(9);
    });

    it("shows a clear parse error for a malformed file, without calling the API", async () => {
      renderAsRole("admin");
      await userEvent.click(screen.getByRole("radio", { name: "Load from CSV" }));
      await userEvent.upload(screen.getByLabelText("CSV file"), csvFile("not,a,valid,course,csv\n1,2,3,4,5"));

      expect(await screen.findByText(/Missing required column/)).toBeInTheDocument();
      expect(mock.history.post ?? []).toHaveLength(0);
    });
  });
});
