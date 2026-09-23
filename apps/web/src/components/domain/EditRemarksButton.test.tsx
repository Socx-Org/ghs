import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockAdapter from "axios-mock-adapter";
import { EditRemarksButton } from "./EditRemarksButton";
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

function renderButton(remarks: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <EditRemarksButton roundId="round-1" remarks={remarks} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("EditRemarksButton", () => {
  it("opens a modal pre-filled with the round's current remarks", async () => {
    renderButton("Windy, played the back nine twice.");
    await userEvent.click(screen.getByRole("button", { name: "Edit remarks" }));

    expect(await screen.findByRole("dialog", { name: "Edit remarks" })).toBeInTheDocument();
    expect((screen.getByLabelText("Remarks") as HTMLTextAreaElement).value).toBe("Windy, played the back nine twice.");
  });

  it("opens with an empty field when there are no remarks yet", async () => {
    renderButton(null);
    await userEvent.click(screen.getByRole("button", { name: "Edit remarks" }));

    expect((await screen.findByLabelText("Remarks")) as HTMLTextAreaElement).toHaveValue("");
  });

  it("saves the new remarks via PATCH /rounds/:id/remarks and closes on success", async () => {
    mock.onPatch("/rounds/round-1/remarks").reply((config) => {
      const body = JSON.parse(config.data);
      expect(body).toEqual({ remarks: "Lost a ball on 14." });
      return [200, { round: { id: "round-1", remarks: body.remarks, status: "draft" } }];
    });
    renderButton(null);

    await userEvent.click(screen.getByRole("button", { name: "Edit remarks" }));
    const textarea = await screen.findByLabelText("Remarks");
    await userEvent.type(textarea, "Lost a ball on 14.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Remarks updated.")).toBeInTheDocument();
  });

  it("saving a whitespace-only value sends null, clearing the remarks", async () => {
    mock.onPatch("/rounds/round-1/remarks").reply((config) => {
      const body = JSON.parse(config.data);
      expect(body).toEqual({ remarks: null });
      return [200, { round: { id: "round-1", remarks: null, status: "draft" } }];
    });
    renderButton("Something worth noting.");

    await userEvent.click(screen.getByRole("button", { name: "Edit remarks" }));
    const textarea = await screen.findByLabelText("Remarks");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "   ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the server's error and keeps the modal open on failure, so the player can retry", async () => {
    mock.onPatch("/rounds/round-1/remarks").reply(409, { error: "cannot change remarks on a round in status 'approved'" });
    renderButton();

    await userEvent.click(screen.getByRole("button", { name: "Edit remarks" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("cannot change remarks on a round in status 'approved'")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit remarks" })).toBeInTheDocument();
  });

  it("re-derives the field from the current remarks each time it's reopened, not stale from a previous open", async () => {
    const { rerender } = renderButton("Original remarks.");
    await userEvent.click(screen.getByRole("button", { name: "Edit remarks" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <EditRemarksButton roundId="round-1" remarks="Updated after a refetch." />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit remarks" }));
    expect(await screen.findByLabelText("Remarks")).toHaveValue("Updated after a refetch.");
  });
});
