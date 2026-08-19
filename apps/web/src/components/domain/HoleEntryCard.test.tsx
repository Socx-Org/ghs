import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MockAdapter from "axios-mock-adapter";
import { HoleEntryCard } from "./HoleEntryCard";
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

function renderCard(props: Partial<ComponentProps<typeof HoleEntryCard>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <HoleEntryCard roundId="round-1" holeNumber={1} par={4} strokeIndex={7} existingScore={undefined} disabled={false} {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("HoleEntryCard", () => {
  it("renders empty for a hole with no existing score", () => {
    renderCard();
    expect((screen.getByLabelText("Strokes") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("pre-fills strokes and shows Saved for an already-scored hole", () => {
    renderCard({
      existingScore: { id: "hs-1", holeNumber: 1, strokes: 5, putts: 2, gir: true, fairwayResult: "hit", inSand: false, penalties: 0, netDoubleBogeyAdjusted: 5 },
    });
    expect((screen.getByLabelText("Strokes") as HTMLInputElement).value).toBe("5");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("keeps more-details fields collapsed by default, expandable on request", async () => {
    renderCard();
    expect(screen.queryByLabelText("Putts")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add more details" }));
    expect(screen.getByLabelText("Putts")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByLabelText("Putts")).not.toBeInTheDocument();
  });

  it("requires a stroke count before saving", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Save hole" }));

    expect(await screen.findByText("Enter a stroke count")).toBeInTheDocument();
    expect(mock.history.post ?? []).toHaveLength(0);
  });

  it("saves a fresh hole with only strokes filled in", async () => {
    mock.onPost("/rounds/round-1/holes").reply(200, { id: "hs-1", holeNumber: 1, strokes: 4, putts: null, gir: false, fairwayResult: null, inSand: false, penalties: 0, netDoubleBogeyAdjusted: 4 });

    renderCard();
    await userEvent.type(screen.getByLabelText("Strokes"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Save hole" }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    const body = JSON.parse(mock.history.post![0]!.data);
    expect(body).toMatchObject({ holeNumber: 1, strokes: 4, gir: false, inSand: false, penalties: 0 });
    expect(body.fairwayResult).toBeUndefined();
    expect(body.putts).toBeUndefined();
  });

  it("resubmits a correction carrying forward the previously-recorded details (the form's own full current state)", async () => {
    mock.onPost("/rounds/round-1/holes").reply(200, {});

    renderCard({
      existingScore: { id: "hs-1", holeNumber: 1, strokes: 6, putts: 3, gir: true, fairwayResult: "missed_left", inSand: true, penalties: 1, netDoubleBogeyAdjusted: 6 },
    });

    const strokesInput = screen.getByLabelText("Strokes");
    await userEvent.clear(strokesInput);
    await userEvent.type(strokesInput, "4");
    // "More details" never opened -- the correction only touches strokes.
    await userEvent.click(screen.getByRole("button", { name: "Save hole" }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    const body = JSON.parse(mock.history.post![0]!.data);
    expect(body).toMatchObject({
      holeNumber: 1, strokes: 4, putts: 3, gir: true, fairwayResult: "missed_left", inSand: true, penalties: 1,
    });
  });

  it("shows a toast on successful save", async () => {
    mock.onPost("/rounds/round-1/holes").reply(200, {});

    renderCard();
    await userEvent.type(screen.getByLabelText("Strokes"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Save hole" }));

    expect(await screen.findByText("Hole 1 saved.")).toBeInTheDocument();
  });

  it("shows the real server error when saving fails", async () => {
    mock.onPost("/rounds/round-1/holes").reply(409, { error: "cannot add a hole score to a round in status 'pending'" });

    renderCard();
    await userEvent.type(screen.getByLabelText("Strokes"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Save hole" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("cannot add a hole score to a round in status 'pending'");
  });
});
