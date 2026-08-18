import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

afterEach(() => {
  cleanup();
});

describe("Skeleton", () => {
  it("is hidden from assistive tech -- it's a loading placeholder, not content", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies the pulse animation with Tailwind's built-in reduced-motion override", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    // motion-reduce:animate-none is Tailwind's own prefers-reduced-motion
    // variant -- asserting the class is present is the correct level for
    // a jsdom test (jsdom doesn't evaluate media queries against real
    // OS settings); the actual reduced-motion behaviour is a CSS
    // media-query effect, not JS logic to unit test further.
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("motion-reduce:animate-none");
  });

  it.each([
    ["text", "rounded"],
    ["circle", "rounded-full"],
    ["rect", "rounded-md"],
  ] as const)("variant=%s applies %s", (variant, expectedClass) => {
    const { container } = render(<Skeleton variant={variant} />);
    expect((container.firstChild as HTMLElement).className).toContain(expectedClass);
  });

  it("applies explicit width/height as inline styles", () => {
    const { container } = render(<Skeleton width={120} height={16} />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("120px");
    expect(el.style.height).toBe("16px");
  });
});
