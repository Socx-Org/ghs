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

function renderActivation(path = "/activate?token=real-token-123") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ActivationPage", () => {
  it("shows a not-valid state, with no API call at all, when the URL has no token", async () => {
    renderActivation("/activate");
    expect(await screen.findByRole("heading", { name: "This activation link isn't valid" })).toBeInTheDocument();
    expect(mock.history.post?.length ?? 0).toBe(0);
  });

  it("shows a real success state and a working Go to sign in action", async () => {
    mock.onPost("/auth/activate").reply(200, { message: "Account activated." });
    renderActivation();

    expect(await screen.findByRole("heading", { name: "Account activated" })).toBeInTheDocument();
    expect(JSON.parse(mock.history.post![0]!.data)).toEqual({ token: "real-token-123" });

    await userEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });

  it("shows the expired state with a working resend form for expired_token", async () => {
    mock.onPost("/auth/activate").reply(400, { error: "expired_token" });
    mock.onPost("/auth/resend-activation").reply(200, { message: "If that account needs activation, a new link has been sent." });
    renderActivation();

    expect(await screen.findByRole("heading", { name: "This activation link has expired" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Email address"), "expired@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Resend activation link" }));

    expect(await screen.findByText("If that account needs activation, a new link has been sent.")).toBeInTheDocument();
    const resendCall = mock.history.post!.find((r) => r.url === "/auth/resend-activation");
    expect(JSON.parse(resendCall!.data)).toEqual({ email: "expired@example.com" });
  });

  it("shows an already-activated state (no resend offered) for already_used_token", async () => {
    mock.onPost("/auth/activate").reply(400, { error: "already_used_token" });
    renderActivation();

    expect(await screen.findByRole("heading", { name: "This account is already activated" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to sign in" })).toBeInTheDocument();
  });

  it("shows an invalid-link state (no resend offered) for invalid_token", async () => {
    mock.onPost("/auth/activate").reply(400, { error: "invalid_token" });
    renderActivation();

    expect(await screen.findByRole("heading", { name: "This activation link isn't valid" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  });

  it("treats an unexpected failure (e.g. a real network/server error) the same as invalid, not a fourth generic state", async () => {
    mock.onPost("/auth/activate").reply(500, { error: "internal server error" });
    renderActivation();

    expect(await screen.findByRole("heading", { name: "This activation link isn't valid" })).toBeInTheDocument();
  });
});
