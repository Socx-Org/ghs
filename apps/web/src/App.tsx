import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./AppRoutes";
import { ToastProvider } from "./components/ToastProvider";

// ghs#62/#78/#82 kept this as a placeholder (dev catalogue vs. a
// production stub) because no real product screens existed yet. ghs#64
// is the first real one -- Login/MFA, with a genuine RequireAuth-gated
// destination behind it -- so that split is retired here, not extended.
// The old scaffold's live /healthz check goes with it: a real, working
// login is itself a stronger end-to-end proof that the frontend can
// reach the backend than a bare liveness ping ever was.

// ghs#65: first real read screen, first use of TanStack Query (the
// issue's own approved choice) rather than useEffect+useState -- gives
// real caching/loading/error state for free instead of hand-rolling it
// per screen, and this is exactly the kind of server-state (not UI
// state) TanStack Query is for. One client at the app root, not
// per-screen -- so a query started on one screen is still cached if the
// user navigates away and back.
const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
