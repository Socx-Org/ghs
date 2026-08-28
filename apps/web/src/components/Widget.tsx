import type { ComponentType, ReactNode } from "react";
import { Alert } from "./Alert";
import { Card, CardBody, CardHeader } from "./Card";
import { EmptyState } from "./EmptyState";
import { Skeleton } from "./Skeleton";
import { cn } from "../lib/cn";

// ghs#116 (design doc section 10): the shared Dashboard widget shell --
// title/icon/description/secondaryMetric header, one of the five states
// every widget on the dashboard needs, built entirely from existing
// primitives (Card/Skeleton/Alert/EmptyState), not a new visual system.
// Deliberately thin: `status` decides which of loading/error/empty/idle/
// ready to render, but the READY content is just `children` -- a stat, a
// table, or (once #117/#118 land) a chart. That's the "small number of
// deliberate widget variants, not one rigid template" the design doc
// asks for: this component owns the chrome and the state switch, never
// the shape of a widget's own real content.
//
// "idle" (review finding, ghs#116 PR #173): a widget's body has nothing
// meaningful to show yet, but that's not itself an error/empty/loading
// condition worth reporting -- e.g. PlayerDashboardPage's rounds widget
// when the player's own profile (a real prerequisite) hasn't loaded, an
// error already surfaced elsewhere on the page. Renders nothing in the
// body, but -- unlike hiding the whole widget -- the header/actions
// still render, so an action like "New round" stays available even
// while the body has nothing to show.
export type WidgetStatus = "loading" | "error" | "empty" | "idle" | "ready";

export interface WidgetProps {
  title: string;
  icon?: ComponentType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string }>;
  description?: string;
  // A small trailing figure in the header, distinct from the widget's
  // own primary content below -- e.g. a trend delta or a result count.
  // Only ever rendered alongside "ready" content; a loading/error/empty
  // widget has no secondary metric to show yet.
  secondaryMetric?: ReactNode;
  // A header-level action (e.g. "New round"), unlike secondaryMetric
  // rendered in every status -- an action like "create the first one"
  // stays useful (arguably most useful) while the widget is empty, and
  // shouldn't disappear just because there's nothing to show yet.
  actions?: ReactNode;
  status: WidgetStatus;
  errorMessage?: ReactNode;
  emptyState?: ReactNode;
  // Defaults to a generic 3-line block -- most widgets never need to
  // override this; a widget shaped very differently from its loaded
  // content (e.g. a chart) can pass its own.
  loadingSkeleton?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Widget({
  title,
  icon: Icon,
  description,
  secondaryMetric,
  actions,
  status,
  errorMessage,
  emptyState,
  loadingSkeleton,
  children,
  className,
}: WidgetProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {Icon && (
            <span aria-hidden="true" className="mt-0.5 text-text-muted">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div>
            <h3 className="text-sm font-semibold text-text">{title}</h3>
            {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
          </div>
        </div>
        {(actions || (status === "ready" && secondaryMetric)) && (
          <div className="flex shrink-0 items-center gap-2">
            {status === "ready" && secondaryMetric && <span className="text-sm text-text-muted">{secondaryMetric}</span>}
            {actions}
          </div>
        )}
      </CardHeader>
      <CardBody className="flex-1">
        {status === "loading" ? (
          loadingSkeleton ?? (
            <div className="flex flex-col gap-2">
              <Skeleton height={20} />
              <Skeleton height={20} />
              <Skeleton height={20} />
            </div>
          )
        ) : status === "error" ? (
          <Alert variant="error">{errorMessage ?? "Something went wrong. Try refreshing the page."}</Alert>
        ) : status === "empty" ? (
          (emptyState ?? <EmptyState title="Nothing here yet" />)
        ) : status === "idle" ? null : (
          children
        )}
      </CardBody>
    </Card>
  );
}
