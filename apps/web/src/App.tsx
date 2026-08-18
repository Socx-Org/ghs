import { useEffect, useState } from "react";
import ComponentsCatalogue from "./ComponentsCatalogue";
import { ToastProvider } from "./components/ToastProvider";

// ghs#62/#78/#82: no real product screens exist yet (#64 onward), so
// this stays a placeholder in production/test. In the actual dev server
// it renders the Components Catalogue instead -- the living design-
// system reference, not a mockup. import.meta.env.DEV is true under
// Vitest's "test" mode too (verified directly, not assumed), which
// would route tests into the catalogue and break these assertions --
// MODE is the correct check here: "development" only for `vite`/`vite dev`.
type ApiStatus = "checking" | "ok" | "error";

function ProductionPlaceholder() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/healthz")
      .then((res) => {
        if (!cancelled) setApiStatus(res.ok ? "ok" : "error");
      })
      .catch(() => {
        if (!cancelled) setApiStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-bg-page text-text">
      <h1 className="text-2xl font-semibold">GHS</h1>
      <p className="text-sm text-text-muted">Product screens land in a later issue -- see ghs#64 onward.</p>
      <p className="text-sm" data-testid="api-status">
        API: {apiStatus}
      </p>
    </main>
  );
}

export default function App() {
  const isDev = import.meta.env.MODE === "development";
  if (!isDev) return <ProductionPlaceholder />;
  // ToastProvider mounted here, at the app root -- not inside
  // ComponentsCatalogue itself -- since real product screens (once
  // Login/MFA replaces this dev-only branch) need useToast() available
  // from anywhere, not just within the catalogue page.
  return (
    <ToastProvider>
      <ComponentsCatalogue />
    </ToastProvider>
  );
}
