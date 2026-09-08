import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Tooltip", () => {
  it("shows on focus (no delay) and hides on blur", async () => {
    render(
      <Tooltip content="Delete this round">
        <Button aria-label="Delete round">X</Button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Delete this round");

    await userEvent.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows on hover after a short delay, not instantly", async () => {
    vi.useFakeTimers();
    render(
      <Tooltip content="Delete this round">
        <Button aria-label="Delete round">X</Button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Delete this round");

    fireEvent.mouseLeave(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // ghs#207: regression test for a real bug -- the tooltip span is
  // absolutely positioned inside a `relative` wrapper sized to the
  // trigger itself, so plain `width:auto` computed its shrink-to-fit
  // width from that tiny containing block and wrapped multi-line
  // copy far too early (a ~44px-wide box, not max-w-xs's 320px), no
  // matter how long the content actually was. `w-max` (content's own
  // natural width, still capped by max-w-xs) is what fixes that --
  // this only checks the class names, since jsdom doesn't lay out
  // real box widths, but a regression back to `whitespace-nowrap` or
  // a bare `width:auto` would fail this immediately.
  it("ghs#207: sizes to its own content (w-max), not the tiny trigger-sized containing block, so long copy wraps within max-w-xs instead of collapsing to one word per line", async () => {
    render(
      <Tooltip content="A much longer piece of help text than any of this component's original one-line labels.">
        <Button aria-label="Info">i</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveClass("w-max", "max-w-xs");
    expect(tooltip).not.toHaveClass("whitespace-nowrap");
  });

  it("shows immediately on touchstart and auto-hides shortly after, without blocking the button's own click", async () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(
      <Tooltip content="Delete this round">
        <Button aria-label="Delete round" onClick={onClick}>
          X
        </Button>
      </Tooltip>,
    );
    const button = screen.getByRole("button");
    fireEvent.touchStart(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Delete this round");

    // A tap fires the button's own click same as any other interaction --
    // the tooltip preview never consumes it.
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1600));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dismisses on a click outside the trigger (the touch-shown case, where nothing was ever focused to blur)", () => {
    render(
      <div>
        <Tooltip content="Delete this round">
          <Button aria-label="Delete round">X</Button>
        </Tooltip>
        {/* A plain non-focusable element -- proves this is the
            mousedown-outside listener doing the dismissal, not blur
            (which a click on a focusable element would also trigger). */}
        <div>Elsewhere</div>
      </div>,
    );
    fireEvent.touchStart(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dismisses on Escape while visible", async () => {
    await userEvent.setup();
    render(
      <Tooltip content="Delete this round">
        <Button aria-label="Delete round">X</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  // ghs#166: an icon-only button's aria-label IS the tooltip content --
  // aria-describedby pointing at the same text would double-announce it.
  it("does not set aria-describedby when the tooltip content mirrors the child's own aria-label", async () => {
    render(
      <Tooltip content="Delete round">
        <Button aria-label="Delete round">X</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    await screen.findByRole("tooltip");
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-describedby");
  });

  it("sets aria-describedby when the tooltip content adds information beyond a labelled button's own text", async () => {
    render(
      <Tooltip content="This can't be undone">
        <Button>Delete</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("aria-describedby", tooltip.id);
  });

  // Review fix: a child that already carries its own aria-describedby
  // (e.g. linked to real form error/help text) must keep that link --
  // Tooltip appends its own id, it doesn't replace it.
  it("appends to, rather than overwrites, a child's pre-existing aria-describedby", async () => {
    render(
      <Tooltip content="This can't be undone">
        <Button aria-describedby="existing-help-text">Delete</Button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toHaveAttribute("aria-describedby", "existing-help-text");

    await userEvent.tab();
    const tooltip = await screen.findByRole("tooltip");
    expect(button).toHaveAttribute("aria-describedby", `existing-help-text ${tooltip.id}`);

    await userEvent.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-describedby", "existing-help-text");
  });
});
