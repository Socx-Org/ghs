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
export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ToastProvider>
  );
}
