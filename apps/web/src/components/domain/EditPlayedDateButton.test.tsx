import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockAdapter from "axios-mock-adapter";
import { EditPlayedDateButton } from "./EditPlayedDateButton";
import { ToastProvider } from "../ToastProvider";
import { api } from "../../lib/api";

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  cleanup();
  mock.restore();
});

function renderButton(playedAt = "2026-05-01T12:00:00.000Z") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <EditPlayedDateButton roundId="round-1" playedAt={playedAt} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("EditPlayedDateButton", () => {
  it("opens a modal pre-filled with the round's current played date", async () => {
    renderButton("2026-05-01T12:00:00.000Z");
    await userEvent.click(screen.getByRole("button", { name: "Edit date" }));

    expect(await screen.findByRole("dialog", { name: "Edit played date" })).toBeInTheDocument();
    expect((screen.getByLabelText("Date played") as HTMLInputElement).value).toBe("2026-05-01");
  });

  it("saves the new date via PATCH /rounds/:id/played-at, using the timezone-safe conversion, and closes on success", async () => {
    mock.onPatch("/rounds/round-1/played-at").reply((config) => {
      const body = JSON.parse(config.data);
      // The exact bug class this issue's own acceptance criteria calls
      // out -- a bare "2026-06-15" sent instead of the real
      // playedAtToIsoString conversion would fail this assertion under a
      // negative-UTC-offset test environment.
      expect(new Date(body.playedAt).getDate()).toBe(15);
      return [200, { round: { id: "round-1", playedAt: body.playedAt, status: "draft" } }];
    });
    renderButton("2026-05-01T12:00:00.000Z");

    await userEvent.click(screen.getByRole("button", { name: "Edit date" }));
    const input = await screen.findByLabelText("Date played");
    await userEvent.clear(input);
    await userEvent.type(input, "2026-06-15");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Played date updated.")).toBeInTheDocument();
  });

  it("shows the server's error and keeps the modal open on failure, so the player can retry", async () => {
    mock.onPatch("/rounds/round-1/played-at").reply(409, { error: "cannot change the played date of a round in status 'approved'" });
    renderButton();

    await userEvent.click(screen.getByRole("button", { name: "Edit date" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("cannot change the played date of a round in status 'approved'")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit played date" })).toBeInTheDocument();
  });

  // Review fix: clearing the date input used to reach playedAtToIsoString
  // with an empty string, which throws (Invalid Date -> toISOString
  // RangeError) synchronously in the click handler -- outside
  // useMutation's own error handling entirely, an uncaught crash rather
  // than a reportable error.
  it("disables Save when the date is cleared, preventing the crash entirely rather than catching it after the fact", async () => {
    renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Edit date" }));

    const input = await screen.findByLabelText("Date played");
    await userEvent.clear(input);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(mock.history.patch ?? []).toHaveLength(0);
  });

  it("re-derives the date field from the current playedAt each time it's reopened, not stale from a previous open", async () => {
    const { rerender } = renderButton("2026-05-01T12:00:00.000Z");
    await userEvent.click(screen.getByRole("button", { name: "Edit date" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <EditPlayedDateButton roundId="round-1" playedAt="2026-07-04T12:00:00.000Z" />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit date" }));
    expect(await screen.findByLabelText("Date played")).toHaveValue("2026-07-04");
  });
});
