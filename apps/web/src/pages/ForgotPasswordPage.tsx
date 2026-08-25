import { useState } from "react";
import { Send } from "lucide-react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, FormField, Input, Logo } from "../components";
import { ApiError, requestPasswordReset } from "../lib/api";

// ghs#107. Same split-panel visual pattern as LoginPage/RegisterPage/
// ActivationPage. Email-only, always the same success confirmation
// regardless of whether the email is registered -- the backend's own
// enumeration protection (design doc's explicit instruction, same
// discipline already applied to RegisterPage's duplicate-email case).

const requestSchema = z.object({ email: z.string().email("Enter a valid email address") });
type RequestFormValues = z.infer<typeof requestSchema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestFormValues>({ resolver: zodResolver(requestSchema) });

  async function onSubmit(values: RequestFormValues) {
    setFeedback(null);
    try {
      // A genuine failure (network/server error) is still real
      // feedback the user needs -- distinct from "email not found,"
      // which the backend's enumeration protection already turns into
      // an identical 2xx (review discipline established for
      // RegisterPage/ActivationPage, PR #124).
      await requestPasswordReset(values.email);
      setSent(true);
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-[45%] lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm">
          <Logo label="GHS" />

          {sent ? (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">Check your email</h1>
              <p className="mt-2 text-sm text-text-muted">
                If that email is registered, a password reset link has been sent.
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">Reset your password</h1>
              <p className="mt-2 text-sm text-text-muted">Enter your email address and we'll send you a link to reset it.</p>

              <form className="mt-8 flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
                {feedback && <Alert variant="error">{feedback}</Alert>}

                <FormField label="Email address" error={errors.email?.message}>
                  <Input type="email" autoComplete="email" {...register("email")} />
                </FormField>

                <Button type="submit" icon={<Send aria-hidden="true" className="h-4 w-4" />} isLoading={isSubmitting} className="w-full">
                  Send reset link
                </Button>
              </form>
            </>
          )}

          <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
            ← Back to sign in
          </Link>
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
