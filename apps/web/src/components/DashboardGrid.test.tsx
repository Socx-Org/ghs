import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DashboardGrid } from "./DashboardGrid";

afterEach(() => {
  cleanup();
});

describe("DashboardGrid", () => {
  it("renders a 12-column grid container with its children", () => {
    const { container, getByText } = render(
      <DashboardGrid>
        <div>Widget A</div>
      </DashboardGrid>,
    );
    expect(getByText("Widget A")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("grid", "grid-cols-12");
  });

  it("merges a caller className rather than replacing the grid classes", () => {
    const { container } = render(<DashboardGrid className="mx-auto" />);
    expect(container.firstChild).toHaveClass("grid", "grid-cols-12", "mx-auto");
  });
});
