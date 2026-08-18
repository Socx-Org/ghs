import type { HTMLAttributes, KeyboardEvent, LiHTMLAttributes, MouseEvent } from "react";
import { cn } from "../lib/cn";

export function List({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("divide-y divide-border rounded-lg border border-border bg-surface", className)} {...rest} />;
}

export interface ListItemProps extends LiHTMLAttributes<HTMLLIElement> {
  interactive?: boolean;
}

export function ListItem({ interactive = false, className, onClick, onKeyDown, ...rest }: ListItemProps) {
  // interactive rows are focusable and look clickable, so they must also
  // respond to Enter/Space -- a focusable element that only reacts to a
  // mouse click is a real keyboard/assistive-tech failure, not just a
  // style gap (review finding, PR #79).
  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    onKeyDown?.(event);
    if (interactive && !event.defaultPrevented && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onClick?.(event as unknown as MouseEvent<HTMLLIElement>);
    }
  };

  return (
    <li
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? handleKeyDown : onKeyDown}
      className={cn(
        "px-4 py-3 sm:px-6",
        interactive &&
          "cursor-pointer hover:bg-bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
        className,
      )}
      {...rest}
    />
  );
}
