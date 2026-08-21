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

function renderForgotPassword() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ForgotPasswordPage", () => {
  it("shows a client-side validation error without calling the API", async () => {
    renderForgotPassword();
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(mock.history.post?.length ?? 0).toBe(0);
  });

  it("submits a real request and shows the same confirmation regardless of whether the email is registered", async () => {
    mock.onPost("/auth/password-reset/request").reply(200, { message: "If that email is registered, a reset link has been sent." });
    renderForgotPassword();

    await userEvent.type(screen.getByLabelText("Email address"), "maybe-registered@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(JSON.parse(mock.history.post![0]!.data)).toEqual({ email: "maybe-registered@example.com" });
  });

  it("shows a real error and stays on the form when the request itself fails", async () => {
    mock.onPost("/auth/password-reset/request").reply(500, { error: "internal server error" });
    renderForgotPassword();

    await userEvent.type(screen.getByLabelText("Email address"), "someone@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(await screen.findByText("internal server error")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Check your email" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeInTheDocument();
  });

  it("Back to sign in navigates to the real login page", async () => {
    renderForgotPassword();
    await userEvent.click(screen.getByRole("link", { name: /Back to sign in/ }));
    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
  });
});
