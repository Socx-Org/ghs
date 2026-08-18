import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, FormField, Input, Logo } from "../components";
import { ApiError, login, verifyMfa } from "../lib/api";
import type { LoginRequest } from "../lib/api";

// ghs#64: split-screen layout, structurally adapted from Tailwind UI's
// "Split screen" sign-in block (form panel + a full-height visual panel)
// per the approved direction -- not a literal copy of its content.
// Deliberately dropped from that reference, because none of it is real
// for GHS: "Or continue with Google/GitHub" (no OAuth provider exists
// anywhere in the backend), "Forgot password?" (no reset UI yet --
// explicitly Wave 2, ghs#64's own non-scope), "Remember me" (the
// refresh token already persists the session for 30 days regardless;
// a checkbox with no backend effect would be decorative, not functional),
// and the marketing "Start a free trial" copy (GHS has no such flow).
// The right-hand panel uses a solid brand-colour field with a short
// tagline instead of a stock photo -- no photography asset exists
// anywhere in this app, and sourcing one for this alone would be a real
// licensing/provenance question worth raising explicitly, not quietly
// deciding by embedding a random web image.

const credentialsSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type CredentialsFormValues = z.infer<typeof credentialsSchema>;

const mfaSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"),
});
type MfaFormValues = z.infer<typeof mfaSchema>;

interface FormFeedback {
  variant: "error" | "warning";
  message: string;
}

// A 429 gets its own distinct copy (acceptance criterion) -- everything
// else surfaces the API's own {error: "..."} message directly, matching
// the approved decision to use it as a whole-form message, not parsed
// into field-level errors.
function describeAuthError(error: unknown): FormFeedback {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return { variant: "warning", message: "Too many attempts. Please wait a few minutes and try again." };
    }
    return { variant: "error", message: error.message };
  }
  return { variant: "error", message: "Something went wrong. Please try again." };
}

function CredentialsForm({
  onMfaRequired,
  onSuccess,
}: {
  onMfaRequired: (mfaPendingToken: string) => void;
  onSuccess: () => void;
}) {
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CredentialsFormValues>({ resolver: zodResolver(credentialsSchema) });

  async function onSubmit(values: CredentialsFormValues) {
    setFeedback(null);
    const input: LoginRequest = values;
    try {
      const result = await login(input);
      if (result.mfaRequired) {
        onMfaRequired(result.mfaPendingToken);
      } else {
        onSuccess();
      }
    } catch (error) {
      setFeedback(describeAuthError(error));
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {feedback && <Alert variant={feedback.variant}>{feedback.message}</Alert>}

      <FormField label="Email address" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...register("email")} />
      </FormField>

      <FormField label="Password" error={errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...register("password")} />
      </FormField>

      <Button type="submit" isLoading={isSubmitting} className="w-full">
        Sign in
      </Button>
    </form>
  );
}

function MfaCodeForm({ mfaPendingToken, onBack, onSuccess }: { mfaPendingToken: string; onBack: () => void; onSuccess: () => void }) {
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<MfaFormValues>({ resolver: zodResolver(mfaSchema) });

  async function onSubmit(values: MfaFormValues) {
    setFeedback(null);
    try {
      await verifyMfa({ mfaPendingToken, code: values.code });
      onSuccess();
    } catch (error) {
      setFeedback(describeAuthError(error));
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {feedback && <Alert variant={feedback.variant}>{feedback.message}</Alert>}

      <FormField label="Authentication code" helpText="Enter the 6-digit code from your authenticator app." error={errors.code?.message}>
        <Input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          {...register("code")}
        />
      </FormField>

      <div className="flex gap-3">
        {/* Disabled while submitting, not just Verify -- otherwise
            clicking Back mid-request unmounts this form (the parent
            switches step back to credentials), but the in-flight
            verifyMfa() call can still resolve successfully afterwards
            and call onSuccess() regardless, navigating the user into
            the app even though they'd asked to go back (review
            finding, PR #85). */}
        <Button type="button" variant="ghost" onClick={onBack} disabled={isSubmitting}>
          Back
        </Button>
        <Button type="submit" isLoading={isSubmitting} className="flex-1">
          Verify
        </Button>
      </div>
    </form>
  );
}

type LoginStep = { kind: "credentials" } | { kind: "mfa"; mfaPendingToken: string };

interface LoginLocationState {
  /** The pathname RequireAuth redirected from, if that's how the user
   *  got here -- see RequireAuth.tsx. Absent for a direct /login visit. */
  from?: string;
}

export default function LoginPage() {
  const [step, setStep] = useState<LoginStep>({ kind: "credentials" });
  const navigate = useNavigate();
  const location = useLocation();

  function handleSuccess() {
    const state = location.state as LoginLocationState | null;
    navigate(state?.from ?? "/", { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-[45%] lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm">
          <Logo label="GHS" />
          <h1 className="mt-8 text-2xl font-semibold text-text">
            {step.kind === "credentials" ? "Sign in to your account" : "Two-factor verification"}
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {step.kind === "credentials"
              ? "Enter your email and password to continue."
              : "Your account has an extra layer of protection enabled."}
          </p>

          <div className="mt-8">
            {step.kind === "credentials" ? (
              <CredentialsForm onMfaRequired={(mfaPendingToken) => setStep({ kind: "mfa", mfaPendingToken })} onSuccess={handleSuccess} />
            ) : (
              <MfaCodeForm mfaPendingToken={step.mfaPendingToken} onBack={() => setStep({ kind: "credentials" })} onSuccess={handleSuccess} />
            )}
          </div>
        </div>
      </div>

      {/* Hidden below lg: -- a decorative brand panel isn't worth the
          screen real estate on a phone, and login isn't itself a
          mobile-critical flow the way round entry is. */}
      <div className="hidden bg-gradient-to-br from-primary to-primary-hover lg:flex lg:flex-1 lg:items-center lg:justify-center">
        <p className="max-w-xs px-8 text-center text-lg font-medium text-white">
          Golf handicap management, done properly.
        </p>
      </div>
    </div>
  );
}
