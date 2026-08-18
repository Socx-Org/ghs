import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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

// Rendered through the real AppRoutes, same rationale as LoginPage.test.tsx
// -- this exercises the real RequireAuth + RequireAdmin guards too, not
// just the form component in isolation.
function renderAsAdmin(role: "admin" | "super_admin" = "admin") {
  setTokens(tokensFor(role));
  return render(
    <MemoryRouter initialEntries={["/admin/users/new"]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

async function fillRequiredFields() {
  await userEvent.type(screen.getByLabelText("Email address"), "new.player@example.com");
  await userEvent.type(screen.getByLabelText("First name"), "New");
  await userEvent.type(screen.getByLabelText("Last name"), "Player");
  await userEvent.type(screen.getByLabelText("Initial password"), "correct-horse-battery-1");
}

describe("AdminCreateUserPage", () => {
  it("shows client-side validation errors without calling the API", async () => {
    renderAsAdmin();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("First name is required")).toBeInTheDocument();
    expect(screen.getByText("Last name is required")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  it("hides the role field for a plain admin (can only create players)", () => {
    renderAsAdmin("admin");
    expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
  });

  it("shows the role field with all three options for a super_admin", () => {
    renderAsAdmin("super_admin");
    const roleSelect = screen.getByLabelText("Role") as HTMLSelectElement;
    const options = Array.from(roleSelect.options).map((option) => option.value);
    expect(options).toEqual(["player", "admin", "super_admin"]);
  });

  it("creates a player account with autoActivate unset, sending role=player for a plain admin caller", async () => {
    mock.onPost("/admin/users").reply(201, { userId: "user-123" });

    renderAsAdmin("admin");
    await fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/activation email will be sent/i));
    expect(screen.getByRole("status")).toHaveTextContent("user-123");

    const [request] = mock.history.post ?? [];
    const body = JSON.parse(request.data);
    expect(body).toMatchObject({
      email: "new.player@example.com",
      firstName: "New",
      lastName: "Player",
      role: "player",
      autoActivate: false,
    });
  });

  it("shows immediately-active feedback when 'Activate immediately' is checked", async () => {
    mock.onPost("/admin/users").reply(201, { userId: "user-456" });

    renderAsAdmin("admin");
    await fillRequiredFields();
    await userEvent.click(screen.getByRole("checkbox", { name: /Activate immediately/i }));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Account created and active"));
    const [request] = mock.history.post ?? [];
    expect(JSON.parse(request.data)).toMatchObject({ autoActivate: true });
  });

  it("lets a super_admin submit an elevated role", async () => {
    mock.onPost("/admin/users").reply(201, { userId: "user-789" });

    renderAsAdmin("super_admin");
    await fillRequiredFields();
    await userEvent.selectOptions(screen.getByLabelText("Role"), "admin");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    const [request] = mock.history.post ?? [];
    expect(JSON.parse(request.data)).toMatchObject({ role: "admin" });
  });

  it("shows the server's error message (e.g. the 403 role restriction) via a form-level alert", async () => {
    mock.onPost("/admin/users").reply(403, { error: "only super_admin may create admin or super_admin accounts" });

    renderAsAdmin("admin");
    await fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("only super_admin may create admin or super_admin accounts");
  });
});
