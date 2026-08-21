import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, FormField, Input, Logo } from "../components";
import { ApiError, confirmPasswordReset } from "../lib/api";
import { classifyTokenError } from "../lib/tokenOutcome";
import type { TokenOutcome } from "../lib/tokenOutcome";

// ghs#107. Same split-panel visual pattern as LoginPage/RegisterPage/
// ActivationPage. Unlike ActivationPage, the token's validity isn't
// checked until the user actually submits a new password -- there's no
// meaningful "checking your link" step before that, since the outcome
// (success/expired/already-used/invalid) is only knowable once
// POST /auth/password-reset/confirm is actually called. Password
// complexity mirrors the backend's real rule (min 8) -- design doc's
// own explicit instruction not to invent a stricter or looser
// frontend-only rule. No password-confirmation field -- no sibling
// screen in this app (RegisterPage, AdminCreateUserPage) asks for one
// either.

const resetSchema = z.object({ newPassword: z.string().min(8, "Password must be at least 8 characters") });
type ResetFormValues = z.infer<typeof resetSchema>;

function BackToSignIn() {
  return (
    <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
      ← Back to sign in
    </Link>
  );
}

function RequestNewLink() {
  const navigate = useNavigate();
  return (
    <Button className="mt-6" onClick={() => navigate("/forgot-password")}>
      Request a new link
    </Button>
  );
}

function ResetForm({ token, onSuccess, onOutcome }: { token: string; onSuccess: () => void; onOutcome: (outcome: TokenOutcome) => void }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetFormValues>({ resolver: zodResolver(resetSchema) });

  async function onSubmit(values: ResetFormValues) {
    setFeedback(null);
    try {
      await confirmPasswordReset(token, values.newPassword);
      onSuccess();
    } catch (error) {
      const isKnownTokenFailure =
        error instanceof ApiError && ["expired_token", "already_used_token", "invalid_token"].includes(error.message);
      if (isKnownTokenFailure) {
        onOutcome(classifyTokenError(error));
        return;
      }
      // A genuine unexpected failure (network/server error) -- not the
      // same UX as a broken link, so surface it right here on the form
      // instead of replacing the whole screen with "this link isn't
      // valid" for what might just be a transient error.
      setFeedback(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <form className="mt-8 flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {feedback && <Alert variant="error">{feedback}</Alert>}

      <FormField label="New password" helpText="At least 8 characters." error={errors.newPassword?.message}>
        <Input type="password" autoComplete="new-password" {...register("newPassword")} />
      </FormField>

      <Button type="submit" isLoading={isSubmitting} className="w-full">
        Reset password
      </Button>
    </form>
  );
}

type Step = { kind: "form" } | { kind: "success" } | { kind: "outcome"; outcome: TokenOutcome };

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const [step, setStep] = useState<Step>({ kind: "form" });

  let content;
  if (!token) {
    content = (
      <>
        <h1 className="mt-8 text-2xl font-semibold text-text">This reset link isn't valid</h1>
        <p className="mt-2 text-sm text-text-muted">
          The link is missing its reset code. Check that you copied the full link from your email.
        </p>
        <RequestNewLink />
        <BackToSignIn />
      </>
    );
  } else if (step.kind === "form") {
    content = (
      <>
        <h1 className="mt-8 text-2xl font-semibold text-text">Set a new password</h1>
        <p className="mt-2 text-sm text-text-muted">Choose a new password for your account.</p>
        <ResetForm token={token} onSuccess={() => setStep({ kind: "success" })} onOutcome={(outcome) => setStep({ kind: "outcome", outcome })} />
      </>
    );
  } else if (step.kind === "success") {
    content = (
      <>
        <h1 className="mt-8 text-2xl font-semibold text-text">Password reset</h1>
        <p className="mt-2 text-sm text-text-muted">Your password has been changed. Sign in with your new password.</p>
        <Button className="mt-6" onClick={() => navigate("/login")}>
          Go to sign in
        </Button>
      </>
    );
  } else if (step.outcome === "expired") {
    content = (
      <>
        <h1 className="mt-8 text-2xl font-semibold text-text">This reset link has expired</h1>
        <p className="mt-2 text-sm text-text-muted">Request a new one below.</p>
        <RequestNewLink />
        <BackToSignIn />
      </>
    );
  } else if (step.outcome === "already_used") {
    content = (
      <>
        <h1 className="mt-8 text-2xl font-semibold text-text">This reset link has already been used</h1>
        <p className="mt-2 text-sm text-text-muted">
          If you already reset your password, sign in with it. If not, request a new link.
        </p>
        <Button className="mt-6" onClick={() => navigate("/login")}>
          Go to sign in
        </Button>
        <RequestNewLink />
      </>
    );
  } else {
    content = (
      <>
        <h1 className="mt-8 text-2xl font-semibold text-text">This reset link isn't valid</h1>
        <p className="mt-2 text-sm text-text-muted">
          We couldn't find a matching reset request. Check that you copied the full link from your email.
        </p>
        <RequestNewLink />
        <BackToSignIn />
      </>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-[45%] lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm">
          <Logo label="GHS" />
          {content}
        </div>
      </div>

      <div className="hidden bg-gradient-to-br from-primary to-primary-hover lg:flex lg:flex-1 lg:items-center lg:justify-center">
        <p className="max-w-xs px-8 text-center text-lg font-medium text-white">
          Golf handicap management, done properly.
        </p>
      </div>
    </div>
  );
}
