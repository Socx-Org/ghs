import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecentRoundsWidget } from "./RecentRoundsWidget";
import type { PlayerRoundListItem } from "../../types/domain";

afterEach(() => {
  cleanup();
});

function round(id: string, playedAt: string, status: PlayerRoundListItem["status"]): PlayerRoundListItem {
  return { id, playerId: "player-1", courseId: "course-1", courseName: "Pebble Beach", teeConfigurationId: "tee-1", teeConfigurationName: "Blue", playedAt, status };
}

describe("RecentRoundsWidget", () => {
  it("shows a loading skeleton when isLoading", () => {
    const { container } = render(<RecentRoundsWidget isLoading isError={false} rounds={[]} onContinue={vi.fn()} />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("shows the error message when isError", () => {
    render(<RecentRoundsWidget isLoading={false} isError errorMessage="Couldn't load your rounds." rounds={[]} onContinue={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your rounds.");
  });

  it("shows an empty state when there are no rounds", () => {
    render(<RecentRoundsWidget isLoading={false} isError={false} rounds={[]} onContinue={vi.fn()} />);
    expect(screen.getByText("No rounds yet")).toBeInTheDocument();
  });

  it("ghs#116 (design doc 9.1): shows only the 3 most recent rounds, even when more are given", async () => {
    const rounds = [
      round("r1", "2026-05-05T09:00:00.000Z", "approved"),
      round("r2", "2026-05-04T09:00:00.000Z", "approved"),
      round("r3", "2026-05-03T09:00:00.000Z", "approved"),
      round("r4", "2026-05-02T09:00:00.000Z", "approved"),
      round("r5", "2026-05-01T09:00:00.000Z", "approved"),
    ];
    render(<RecentRoundsWidget isLoading={false} isError={false} rounds={rounds} onContinue={vi.fn()} />);

    const rows = await screen.findAllByRole("row");
    // 3 data rows + 1 header row.
    expect(rows).toHaveLength(4);
  });

  it("offers Continue only for editable-status rounds, and calls onContinue with the right id", async () => {
    const onContinue = vi.fn();
    const rounds = [round("r-draft", "2026-05-02T09:00:00.000Z", "draft"), round("r-approved", "2026-05-01T09:00:00.000Z", "approved")];
    render(<RecentRoundsWidget isLoading={false} isError={false} rounds={rounds} onContinue={onContinue} />);

    const continueButtons = screen.getAllByRole("button", { name: "Continue" });
    expect(continueButtons).toHaveLength(1);

    await userEvent.click(continueButtons[0]!);
    expect(onContinue).toHaveBeenCalledWith("r-draft");
  });

  it("renders header actions (e.g. New round) regardless of state", () => {
    render(
      <RecentRoundsWidget isLoading={false} isError={false} rounds={[]} onContinue={vi.fn()} actions={<button>New round</button>} />,
    );
    expect(screen.getByRole("button", { name: "New round" })).toBeInTheDocument();
  });
});
