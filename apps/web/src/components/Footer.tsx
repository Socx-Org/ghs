// ghs#96: understated, fixed within the shell -- copyright + the
// environment tier (import.meta.env.MODE, the same signal already
// used elsewhere in this app, e.g. AppRoutes.tsx's dev-only catalogue
// route). No version string: package.json's "0.0.0" isn't a
// meaningful value to surface, and inventing one would be worse than
// omitting it.
//
// ghs#133: the environment tag is dev/test-only -- a real production
// visitor seeing "· production" in the footer isn't useful to them,
// it's an internal signal meant for non-production environments.
export function Footer() {
  const year = new Date().getFullYear();
  const isProduction = import.meta.env.MODE === "production";

  return (
    <footer className="shrink-0 border-t border-border bg-surface px-4 py-3 text-center text-xs text-text-muted sm:px-6">
      © {year} Socx Organisation. All rights reserved.{!isProduction && ` · ${import.meta.env.MODE}`}
    </footer>
  );
}
