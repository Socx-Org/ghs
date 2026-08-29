import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Flag } from "lucide-react";
import { Widget } from "./Widget";

afterEach(() => {
  cleanup();
});

describe("Widget", () => {
  it("renders title, icon, and description", () => {
    render(<Widget title="Recent rounds" icon={Flag} description="Your last few rounds" status="ready">Content</Widget>);
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
    expect(screen.getByText("Your last few rounds")).toBeInTheDocument();
  });

  it("status=loading renders a skeleton, not the children", () => {
    const { container } = render(
      <Widget title="Recent rounds" status="loading">
        Real content
      </Widget>,
    );
    expect(screen.queryByText("Real content")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("status=loading uses a custom loadingSkeleton when given, instead of the default", () => {
    render(
      <Widget title="Recent rounds" status="loading" loadingSkeleton={<p>Custom skeleton</p>}>
        Real content
      </Widget>,
    );
    expect(screen.getByText("Custom skeleton")).toBeInTheDocument();
  });

  it("status=error renders an alert with the error message, not the children", () => {
    render(
      <Widget title="Recent rounds" status="error" errorMessage="Couldn't load rounds.">
        Real content
      </Widget>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load rounds.");
    expect(screen.queryByText("Real content")).not.toBeInTheDocument();
  });

  it("status=error falls back to a generic message when none is given", () => {
    render(<Widget title="Recent rounds" status="error">Real content</Widget>);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("status=empty renders the given emptyState, not the children", () => {
    render(
      <Widget title="Recent rounds" status="empty" emptyState={<p>Nothing yet</p>}>
        Real content
      </Widget>,
    );
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.queryByText("Real content")).not.toBeInTheDocument();
  });

  it("status=ready renders the children", () => {
    render(<Widget title="Recent rounds" status="ready">Real content</Widget>);
    expect(screen.getByText("Real content")).toBeInTheDocument();
  });

  it("status=idle renders nothing in the body, but the title and actions still render (review finding, PR #173)", () => {
    render(
      <Widget title="Recent rounds" status="idle" actions={<button>New round</button>}>
        Real content
      </Widget>,
    );
    expect(screen.getByText("Recent rounds")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New round" })).toBeInTheDocument();
    expect(screen.queryByText("Real content")).not.toBeInTheDocument();
  });

  it("secondaryMetric only renders alongside ready content, not during loading/error/empty", () => {
    const { rerender } = render(
      <Widget title="Recent rounds" status="ready" secondaryMetric="12 total">
        Content
      </Widget>,
    );
    expect(screen.getByText("12 total")).toBeInTheDocument();

    rerender(
      <Widget title="Recent rounds" status="loading" secondaryMetric="12 total">
        Content
      </Widget>,
    );
    expect(screen.queryByText("12 total")).not.toBeInTheDocument();
  });

  it("colSpan resolves to real, statically-present Tailwind classes at each breakpoint (ghs#175 -- not a template-constructed class string)", () => {
    const { container } = render(
      <Widget title="Recent rounds" status="ready" colSpan={{ base: 12, md: 6, lg: 8 }}>
        Content
      </Widget>,
    );
    expect(container.firstChild).toHaveClass("col-span-12", "md:col-span-6", "lg:col-span-8");
  });

  it("colSpan supports a span of 2, needed by the Player Dashboard's Row 3 (GIR/Sand/Penalties, ghs#178 -- missing from ghs#175's original span set)", () => {
    const { container } = render(
      <Widget title="GIR" status="ready" colSpan={{ md: 4, lg: 2 }}>
        Content
      </Widget>,
    );
    expect(container.firstChild).toHaveClass("md:col-span-4", "lg:col-span-2");
  });

  it("colSpan is a no-op when omitted", () => {
    const { container } = render(
      <Widget title="Recent rounds" status="ready">
        Content
      </Widget>,
    );
    expect(container.firstChild).not.toHaveClass("col-span-12");
  });

  it("colSpan.base defaults to 12 when omitted but md/lg are given (review finding, PR #182 -- otherwise falls back to grid auto-placement/span-1 on mobile)", () => {
    const { container } = render(
      <Widget title="Recent rounds" status="ready" colSpan={{ lg: 8 }}>
        Content
      </Widget>,
    );
    expect(container.firstChild).toHaveClass("col-span-12", "lg:col-span-8");
  });

  it("colSpan.base is respected when explicitly given, not overridden by the default", () => {
    const { container } = render(
      <Widget title="Recent rounds" status="ready" colSpan={{ base: 6, lg: 8 }}>
        Content
      </Widget>,
    );
    expect(container.firstChild).toHaveClass("col-span-6");
    expect(container.firstChild).not.toHaveClass("col-span-12");
  });

  it("actions render in every status, e.g. an empty-state 'create the first one' affordance", () => {
    const { rerender } = render(
      <Widget title="Recent rounds" status="empty" actions={<button>New round</button>}>
        Content
      </Widget>,
    );
    expect(screen.getByRole("button", { name: "New round" })).toBeInTheDocument();

    rerender(
      <Widget title="Recent rounds" status="loading" actions={<button>New round</button>}>
        Content
      </Widget>,
    );
    expect(screen.getByRole("button", { name: "New round" })).toBeInTheDocument();
  });
});
