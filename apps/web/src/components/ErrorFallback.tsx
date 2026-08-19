import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

export interface ErrorFallbackProps {
  onRetry: () => void;
}

// ghs#102: deliberately self-contained, not rendered inside AppShell --
// the crash that triggered this could have originated anywhere in the
// tree ErrorBoundary wraps, including the shell itself, so the fallback
// must not depend on any of that still working.
export function ErrorFallback({ onRetry }: ErrorFallbackProps) {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-page p-4">
      <EmptyState
        icon={<AlertTriangle aria-hidden="true" className="h-10 w-10" />}
        title="Something went wrong"
        description="We hit an unexpected problem displaying this page. Try again, or head back to somewhere safe."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={onRetry}>Retry</Button>
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button variant="secondary" onClick={() => navigate("/")}>
              Go to Dashboard
            </Button>
          </div>
        }
      />
    </div>
  );
}
