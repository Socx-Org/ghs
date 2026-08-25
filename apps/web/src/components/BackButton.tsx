import { ArrowLeft } from "lucide-react";
import { Button } from "./Button";
import type { ButtonProps } from "./Button";

export type BackButtonProps = Omit<ButtonProps, "variant" | "size" | "icon">;

// ghs#134: the exact "← Back" (or "← Back to X") Button, previously
// hand-copied identically across 10 pages (RoundEntryPage, ProfilePage,
// CourseDetailPage, AdminAccountsPage, AdminCreateUserPage,
// AdminSettingsPage, CreateCoursePage, NewRoundPage,
// AdminRoundReviewPage, RoundDetailsPage) -- the third-plus duplication
// this codebase's own convention treats as the point it stops being a
// coincidence worth tolerating. A real ArrowLeft icon replaces the
// em-dash-arrow text glyph this issue's own scope names as an example --
// a real accessibility improvement too, not just visual: "←" isn't
// reliably announced as "back" by assistive tech, where a plain "Back"
// (or "Back to My Rounds") label plus a decorative aria-hidden icon
// unambiguously is.
//
// Deliberately doesn't cover the four unauthenticated auth-flow pages'
// own "← Back to sign in" (RegisterPage/ForgotPasswordPage/
// ResetPasswordPage/ActivationPage) -- those are plain inline `Link`
// text under a form, not a `Button`, a genuinely different UI pattern
// this issue's own "icons in buttons" scope doesn't reach.
export function BackButton({ children = "Back", ...rest }: BackButtonProps) {
  return (
    <Button variant="ghost" size="sm" icon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />} {...rest}>
      {children}
    </Button>
  );
}
