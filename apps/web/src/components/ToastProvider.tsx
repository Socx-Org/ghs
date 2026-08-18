import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Toast } from "./Toast";
import { ToastContext } from "./ToastContext";
import type { ToastOptions } from "./ToastContext";

interface ToastItem extends ToastOptions {
  id: string;
}

const DEFAULT_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const scheduleDismiss = useCallback(
    (id: string, duration: number) => {
      if (duration <= 0) return;
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const show = useCallback(
    (options: ToastOptions) => {
      const id = crypto.randomUUID();
      const duration = options.duration ?? DEFAULT_DURATION;
      setToasts((current) => [...current, { ...options, id }]);
      scheduleDismiss(id, duration);
    },
    [scheduleDismiss],
  );

  const pause = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const resume = useCallback(
    (id: string, duration: number) => {
      if (!timers.current.has(id)) scheduleDismiss(id, duration);
    },
    [scheduleDismiss],
  );

  // ToastProvider is mounted once at the app root today (App.tsx), so
  // this never fires in current usage -- but it's a generic primitive
  // meant for reuse, and without this a conditionally-unmounted provider
  // (a future route change, or a test's own unmount) would leave
  // outstanding timers running, still holding references, and still
  // calling setToasts after the component using them is gone (review
  // finding, PR #83).
  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {/* Bottom-centre on every viewport, not corner-on-desktop /
          centre-on-mobile -- one responsive rule instead of two
          different positioning schemes, and avoids edge-cutoff on
          narrow phones entirely. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto w-full max-w-sm"
            onMouseEnter={() => pause(toast.id)}
            onMouseLeave={() => resume(toast.id, toast.duration ?? DEFAULT_DURATION)}
          >
            <Toast variant={toast.variant} title={toast.title} message={toast.message} onDismiss={() => dismiss(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
