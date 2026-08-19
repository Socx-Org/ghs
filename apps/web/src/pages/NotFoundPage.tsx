import { Compass } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";

// ghs#102: reachable both authenticated (rendered inside AppShell, via
// AppRoutes.tsx's catch-all NotFoundRoute) and unauthenticated (rendered
// bare) -- deliberately no height/viewport assumptions of its own so it
// looks right nested inside <main> either way; the unauthenticated case
// gets its own centering wrapper at the call site instead.
export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <EmptyState
        icon={<Compass aria-hidden="true" className="h-10 w-10" />}
        title="Page not found"
        description="The page you're looking for doesn't exist or may have moved."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Go Back
            </Button>
            <Button onClick={() => navigate("/")}>Go to Dashboard</Button>
          </div>
        }
      />
    </div>
  );
}
