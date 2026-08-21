import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

function renderReset(path = "/reset-password?token=real-token-123") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ResetPasswordPage", () => {
  it("shows a not-valid state, with no form and no API call, when the URL has no token", async () => {
    renderReset("/reset-password");
    expect(await screen.findByRole("heading", { name: "This reset link isn't valid" })).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(mock.history.post?.length ?? 0).toBe(0);
  });

  it("shows a client-side validation error without calling the API", async () => {
    renderReset();
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(mock.history.post?.length ?? 0).toBe(0);
  });

  it("submits a real reset and shows a working Go to sign in action", async () => {
    mock.onPost("/auth/password-reset/confirm").reply(200, { message: "Password reset." });
    renderReset();

    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("heading", { name: "Password reset" })).toBeInTheDocument();
    expect(JSON.parse(mock.history.post![0]!.data)).toEqual({ token: "real-token-123", newPassword: "brand-new-password" });

    await userEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("shows the expired outcome with a working Request a new link action for expired_token", async () => {
    mock.onPost("/auth/password-reset/confirm").reply(400, { error: "expired_token" });
    renderReset();

    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("heading", { name: "This reset link has expired" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Request a new link" }));
    expect(await screen.findByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
  });

  it("shows the already-used outcome with both Go to sign in and Request a new link for already_used_token", async () => {
    mock.onPost("/auth/password-reset/confirm").reply(400, { error: "already_used_token" });
    renderReset();

    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("heading", { name: "This reset link has already been used" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request a new link" })).toBeInTheDocument();
  });

  it("shows the invalid outcome for invalid_token", async () => {
    mock.onPost("/auth/password-reset/confirm").reply(400, { error: "invalid_token" });
    renderReset();

    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("heading", { name: "This reset link isn't valid" })).toBeInTheDocument();
  });

  it("shows an inline error on the form (not a full-screen swap) for an unexpected failure, distinct from a broken link", async () => {
    mock.onPost("/auth/password-reset/confirm").reply(500, { error: "internal server error" });
    renderReset();

    await userEvent.type(screen.getByLabelText("New password"), "brand-new-password");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("internal server error")).toBeInTheDocument();
    // Still on the form -- an unexpected error isn't the same UX as a
    // genuinely broken/expired/used link.
    expect(screen.getByRole("button", { name: "Reset password" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "This reset link isn't valid" })).not.toBeInTheDocument();
  });
});
