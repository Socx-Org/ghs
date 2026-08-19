import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ErrorFallback } from "./ErrorFallback";

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// ghs#102: one application-level boundary (wrapping AppRoutes in
// App.tsx), not per-route -- this app doesn't have enough independent
// route surfaces yet to justify per-page boundaries (design principle
// 9: no speculative abstraction ahead of real need). React only
// supports error boundaries via class components (getDerivedStateFromError
// has no hook equivalent as of React 19) -- this is the one class
// component in the app for exactly that reason.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught an error:", error, info.componentStack);
    }
  }

  // Retry re-renders the exact same children rather than navigating
  // away -- per design doc section 2, "attempt to recover the current
  // application state before forcing the user elsewhere." If the cause
  // was transient, this succeeds; if not, render throws again and
  // getDerivedStateFromError re-catches it immediately.
  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
