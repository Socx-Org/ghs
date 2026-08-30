import { useEffect } from "react";
import { useAuth } from "./useAuth";
import { heartbeat } from "../lib/api";

// ghs#179 (design doc sections C/J.2): keeps users.last_active_at (ghs#177)
// fresh for every logged-in user, not just whoever is looking at the
// Admin Dashboard. Mounted once inside AppShell, which per AppRoutes.tsx
// only ever renders once RequireAuth has already cleared -- but this
// hook still gates on isAuthenticated itself (rather than assuming its
// mount context), so it stops immediately if that ever changes under it
// without an unmount, e.g. a logout that hasn't yet navigated away.
const HEARTBEAT_INTERVAL_MS = 60_000;

export function useHeartbeat(): void {
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    function sendHeartbeat() {
      heartbeat().catch(() => {
        // Best-effort -- a missed beat just means a slightly stale
        // last_active_at, not something worth surfacing to the user.
      });
    }

    // Page Visibility gating: a hidden tab stops sending entirely
    // rather than continuing in the background, and becoming visible
    // again resumes the normal cadence (the next beat 60s later) --
    // it never fires an immediate "catch up" beat for time missed
    // while hidden, and never fires more than one beat per interval.
    function start() {
      if (intervalId !== null) return;
      intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    }

    function stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    }

    if (!document.hidden) {
      start();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stop();
    };
  }, [isAuthenticated]);
}
