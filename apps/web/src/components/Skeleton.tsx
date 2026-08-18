import { cn } from "../lib/cn";

export type SkeletonVariant = "text" | "circle" | "rect";

const VARIANT_CLASSES: Record<SkeletonVariant, string> = {
  text: "h-4 rounded",
  circle: "rounded-full",
  rect: "rounded-md",
};

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
}

// One primitive, not six separate Skeleton{Avatar,Card,List,Table,Stat}
// components -- avatar/card/list/table/stat "skeletons" are documented
// compositions of this in the Components Catalogue, not new components.
// motion-reduce:animate-none is Tailwind's built-in prefers-reduced-motion
// variant -- no custom JS/media-query handling needed for that.
export function Skeleton({ variant = "rect", width, height, className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse bg-border motion-reduce:animate-none", VARIANT_CLASSES[variant], className)}
      style={{ width, height }}
    />
  );
}
