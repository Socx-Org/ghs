import { useEffect, useState } from "react";

// ghs#62: deliberately a placeholder, not a designed screen -- proves the
// pipeline (build, deploy, Tailwind, and a real API round-trip through
// the dev-server proxy / production nginx split) end-to-end. Visual
// language and reusable UI primitives are their own, later increment;
// this gets replaced once that work lands, not extended in place.
type ApiStatus = "checking" | "ok" | "error";

export default function App() {
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 text-slate-900">
      <h1 className="text-2xl font-semibold">GHS</h1>
      <p className="text-sm text-slate-600">Frontend scaffold placeholder -- ghs#62</p>
      <p className="text-sm" data-testid="api-status">
        API: {apiStatus}
      </p>
    </main>
  );
}
