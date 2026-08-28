import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

// ghs#175 (design doc section D): the 12-column responsive layout layer
// PlayerDashboardPage/AdminDashboardPage build on (#178/#181) -- replaces
// PlayerDashboardPage's current `max-w-3xl` single centred column. Always
// 12 columns at every breakpoint; a widget's own `colSpan` (Widget.tsx)
// decides how many of those 12 it occupies at each breakpoint. Ordering
// changes for a page-specific mobile layout are the consuming page's own
// responsibility (an `order-*` className on the widget), not this
// primitive's -- it only lays children out, it never reorders them.
export function DashboardGrid({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid grid-cols-12 gap-4 lg:gap-6", className)} {...rest} />;
}
