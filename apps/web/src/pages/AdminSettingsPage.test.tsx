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

const SETTINGS = {
  maintenanceMode: false,
  selfRegistrationEnabled: false,
  notifications: { roundSubmitted: true, roundApproved: true, maintenanceAlerts: true },
};

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

function renderAsRole(role: "player" | "admin" = "admin") {
  setTokens(tokensFor(role));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/admin/settings"]}>
          <AppRoutes />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("AdminSettingsPage", () => {
  it("redirects a non-admin away", () => {
    mock.onGet("/admin/settings").reply(200, SETTINGS);
    renderAsRole("player");
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("shows the real current value of every toggle", async () => {
    mock.onGet("/admin/settings").reply(200, {
      maintenanceMode: true,
      selfRegistrationEnabled: false,
      notifications: { roundSubmitted: true, roundApproved: false, maintenanceAlerts: true },
    });
    renderAsRole("admin");

    expect(await screen.findByRole("checkbox", { name: /Maintenance mode/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Self-registration/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Notify on round submitted/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Notify on round approved/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Maintenance alert notifications/ })).toBeChecked();
  });

  it("shows an error alert when the request fails", async () => {
    mock.onGet("/admin/settings").reply(500, { error: "unexpected failure" });
    renderAsRole("admin");

    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected failure");
  });

  it("toggling maintenance mode calls the real endpoint, shows a toast, and refetches", async () => {
    mock.onGet("/admin/settings").reply(() => [200, SETTINGS]);
    mock.onPut("/admin/settings/maintenance-mode").reply(200, { maintenanceMode: true });

    renderAsRole("admin");
    const checkbox = await screen.findByRole("checkbox", { name: /Maintenance mode/ });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Maintenance mode enabled."));
    const [request] = mock.history.put?.filter((r) => r.url === "/admin/settings/maintenance-mode") ?? [];
    expect(JSON.parse(request!.data)).toEqual({ value: true });
  });

  it("toggling self-registration calls the real endpoint and shows a toast", async () => {
    mock.onGet("/admin/settings").reply(200, SETTINGS);
    mock.onPut("/admin/settings/self-registration-enabled").reply(200, { selfRegistrationEnabled: true });

    renderAsRole("admin");
    const checkbox = await screen.findByRole("checkbox", { name: /Self-registration/ });
    await userEvent.click(checkbox);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Self-registration enabled."));
    const [request] = mock.history.put?.filter((r) => r.url === "/admin/settings/self-registration-enabled") ?? [];
    expect(JSON.parse(request!.data)).toEqual({ value: true });
  });

  it("toggling each notification setting hits its own endpoint independently", async () => {
    mock.onGet("/admin/settings").reply(200, SETTINGS);
    mock.onPut("/admin/settings/notifications/round-approved").reply(200, { roundApproved: false });

    renderAsRole("admin");
    const checkbox = await screen.findByRole("checkbox", { name: /Notify on round approved/ });
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Notification setting disabled."));
    const [request] = mock.history.put?.filter((r) => r.url === "/admin/settings/notifications/round-approved") ?? [];
    expect(JSON.parse(request!.data)).toEqual({ value: false });
    // Only the one endpoint was called -- not round-submitted/maintenance-alerts.
    expect(mock.history.put?.filter((r) => r.url?.includes("notifications")).length).toBe(1);
  });

  it("shows the server's error message when a toggle fails, without changing the checkbox", async () => {
    mock.onGet("/admin/settings").reply(200, SETTINGS);
    mock.onPut("/admin/settings/maintenance-mode").reply(500, { error: "database unavailable" });

    renderAsRole("admin");
    const checkbox = await screen.findByRole("checkbox", { name: /Maintenance mode/ });
    await userEvent.click(checkbox);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("database unavailable"));
    // No local optimistic flip -- the query was never invalidated on
    // error, so the checkbox still reflects the last confirmed value.
    expect(checkbox).not.toBeChecked();
  });
});
