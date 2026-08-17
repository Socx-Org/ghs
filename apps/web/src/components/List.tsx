import type { HTMLAttributes, LiHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function List({ className, ...rest }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white", className)} {...rest} />;
}

export interface ListItemProps extends LiHTMLAttributes<HTMLLIElement> {
  interactive?: boolean;
}

export function ListItem({ interactive = false, className, ...rest }: ListItemProps) {
  return (
    <li
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        "px-4 py-3 sm:px-6",
        interactive &&
          "cursor-pointer hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600",
        className,
      )}
      {...rest}
    />
  );
}
