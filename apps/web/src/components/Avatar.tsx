import { cn } from "../lib/cn";

export type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};

// Deterministic colour per name so the same person looks the same
// everywhere without a lookup table.
const PALETTE = [
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800",
  "bg-slate-200 text-slate-800",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function paletteIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % PALETTE.length;
}

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  className?: string;
}

// Initials only, by design -- no image upload/profile-photo feature
// exists anywhere in the GHS domain (see frontend-architecture.md), so
// this isn't a placeholder for one.
export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span
      title={name}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-full font-medium",
        SIZE_CLASSES[size],
        PALETTE[paletteIndex(name)],
        className,
      )}
    >
      <span aria-hidden="true">{initials(name)}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}
