import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import MockAdapter from "axios-mock-adapter";
import AppRoutes from "../AppRoutes";
import { bootstrapClient } from "../lib/api";
import { setTokens } from "../lib/auth-store";

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(bootstrapClient);
});

afterEach(() => {
  cleanup();
  mock.restore();
  setTokens(null);
  localStorage.clear();
});

function renderRegister() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/register"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillForm() {
  await userEvent.type(screen.getByLabelText("Email address"), "new@example.com");
  await userEvent.type(screen.getByLabelText("First name"), "New");
  await userEvent.type(screen.getByLabelText("Last name"), "Player");
  await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery");
}

describe("RegisterPage", () => {
  it("is not reachable while self-registration is disabled -- fails closed, no working form", async () => {
    mock.onGet("/auth/self-registration-enabled").reply(200, { enabled: false });
    renderRegister();

    expect(await screen.findByRole("heading", { name: "Registration isn't available" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(mock.history.post?.length ?? 0).toBe(0);
  });

  it("is not reachable when the enablement check itself fails -- fails closed, not open", async () => {
    mock.onGet("/auth/self-registration-enabled").reply(500, { error: "internal server error" });
    renderRegister();

    expect(await screen.findByRole("heading", { name: "Registration isn't available" })).toBeInTheDocument();
  });

  it("shows client-side validation errors without calling the API", async () => {
    mock.onGet("/auth/self-registration-enabled").reply(200, { enabled: true });
    renderRegister();
    await screen.findByRole("button", { name: "Create account" });

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("First name is required")).toBeInTheDocument();
    expect(screen.getByText("Last name is required")).toBeInTheDocument();
    expect(screen.getByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(mock.history.post?.length ?? 0).toBe(0);
  });

  it("submits a real registration and shows the pending-activation confirmation", async () => {
    mock.onGet("/auth/self-registration-enabled").reply(200, { enabled: true });
    mock.onPost("/auth/register").reply(201, { message: "Registration successful. Check your email to activate your account." });
    renderRegister();
    await screen.findByRole("button", { name: "Create account" });

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    await waitFor(() => expect(mock.history.post?.length).toBe(1));
    const body = JSON.parse(mock.history.post![0]!.data);
    expect(body).toMatchObject({ email: "new@example.com", firstName: "New", lastName: "Player" });
  });

  it("shows the same success confirmation for a duplicate email as for a new one -- respects the backend's enumeration protection", async () => {
    mock.onGet("/auth/self-registration-enabled").reply(200, { enabled: true });
    // The real backend responds 201 with identical copy whether or not
    // the email already exists (enumeration protection) -- this test
    // proves the UI doesn't invent a different branch for that case.
    mock.onPost("/auth/register").reply(201, { message: "Registration successful. Check your email to activate your account." });
    renderRegister();
    await screen.findByRole("button", { name: "Create account" });

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
  });

  it("shows a real error and does not advance to the success state when registration fails", async () => {
    mock.onGet("/auth/self-registration-enabled").reply(200, { enabled: true });
    mock.onPost("/auth/register").reply(500, { error: "internal server error" });
    renderRegister();
    await screen.findByRole("button", { name: "Create account" });

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("internal server error")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Check your email" })).not.toBeInTheDocument();
  });

  it("Back to sign in navigates to the real login page", async () => {
    mock.onGet("/auth/self-registration-enabled").reply(200, { enabled: false });
    renderRegister();

    await userEvent.click(await screen.findByRole("link", { name: /Back to sign in/ }));
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });
});
