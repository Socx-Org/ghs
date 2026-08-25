import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackButton } from "./BackButton";

afterEach(() => {
  cleanup();
});

describe("BackButton", () => {
  it("defaults to the label 'Back' and fires onClick", async () => {
    const onClick = vi.fn();
    render(<BackButton onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("accepts a custom label, e.g. 'Back to My Rounds'", () => {
    render(<BackButton>Back to My Rounds</BackButton>);
    expect(screen.getByRole("button", { name: "Back to My Rounds" })).toBeInTheDocument();
  });
});
