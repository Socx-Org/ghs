import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, FormField, Input, Logo, Spinner } from "../components";
import { ApiError, activateAccount, resendActivation } from "../lib/api";

// ghs#106. Same split-panel visual pattern as LoginPage/RegisterPage.
// Four real, distinct outcomes -- no generic "something went wrong"
// collapsing them (design doc's own explicit instruction). The backend
// itself only distinguished these after a review fix during this issue
// (see auth.service.ts's ActivationToken*Error classes) -- the original
// issue text assumed this was already true, which it wasn't; verified
// directly, not assumed, before building this screen on top of it.

type ActivationOutcome = "expired" | "already_used" | "invalid";

function classifyError(error: unknown): ActivationOutcome {
  if (error instanceof ApiError) {
    if (error.message === "expired_token") return "expired";
    if (error.message === "already_used_token") return "already_used";
  }
  // invalid_token, a missing/malformed response, or a network failure
  // all land here -- none of them have a more specific, honest story to
  // tell than "this link isn't valid."
  return "invalid";
}

const resendSchema = z.object({ email: z.string().email("Enter a valid email address") });
type ResendFormValues = z.infer<typeof resendSchema>;

function ResendActivationForm() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResendFormValues>({ resolver: zodResolver(resendSchema) });

  async function onSubmit(values: ResendFormValues) {
    // Always the same outcome regardless of what resendActivation()
    // resolves with -- the backend's own enumeration protection means
    // there's nothing to branch on (review discipline already applied
    // to RegisterPage, ghs#105).
    await resendActivation(values.email);
    setSent(true);
  }

  if (sent) {
    return <p className="mt-4 text-sm text-text-muted">If that account needs activation, a new link has been sent.</p>;
  }

  return (
    <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Email address" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...register("email")} />
      </FormField>
      <Button type="submit" isLoading={isSubmitting}>
        Resend activation link
      </Button>
    </form>
  );
}

function BackToSignIn() {
  return (
    <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
      ← Back to sign in
    </Link>
  );
}

export default function ActivationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const activateQuery = useQuery({
    queryKey: ["auth", "activate", token],
    queryFn: () => activateAccount(token!),
    enabled: Boolean(token),
    retry: false,
  });

  return (
    <div className="flex min-h-screen bg-surface">
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-[45%] lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm">
          <Logo label="GHS" />

          {!token ? (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">This activation link isn't valid</h1>
              <p className="mt-2 text-sm text-text-muted">
                The link is missing its activation code. Check that you copied the full link from your email.
              </p>
              <BackToSignIn />
            </>
          ) : activateQuery.isPending ? (
            <div className="mt-8 flex items-center gap-3">
              <Spinner label="Activating your account" />
              <span className="text-sm text-text-muted">Activating your account…</span>
            </div>
          ) : activateQuery.isSuccess ? (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">Account activated</h1>
              <p className="mt-2 text-sm text-text-muted">Your account is ready. Sign in to get started.</p>
              <Button className="mt-6" onClick={() => navigate("/login")}>
                Go to sign in
              </Button>
            </>
          ) : classifyError(activateQuery.error) === "expired" ? (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">This activation link has expired</h1>
              <p className="mt-2 text-sm text-text-muted">Enter your email address and we'll send you a new one.</p>
              <ResendActivationForm />
              <BackToSignIn />
            </>
          ) : classifyError(activateQuery.error) === "already_used" ? (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">This account is already activated</h1>
              <p className="mt-2 text-sm text-text-muted">This activation link has already been used. You can sign in directly.</p>
              <Button className="mt-6" onClick={() => navigate("/login")}>
                Go to sign in
              </Button>
            </>
          ) : (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">This activation link isn't valid</h1>
              <p className="mt-2 text-sm text-text-muted">
                We couldn't find a matching activation request. Check that you copied the full link from your email, or contact your
                club administrator.
              </p>
              <BackToSignIn />
            </>
          )}
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
