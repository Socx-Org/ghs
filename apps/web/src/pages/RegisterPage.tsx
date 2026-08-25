import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, FormField, Input, Logo, Skeleton } from "../components";
import { ApiError, getSelfRegistrationEnabled, register as registerAccount } from "../lib/api";

// ghs#105. Same split-panel visual pattern as LoginPage (ghs#64), not a
// new layout invented for this one screen. The enablement check
// (GET /auth/self-registration-enabled) happens here too, not just as a
// hidden link on LoginPage -- a direct /register visit must not reach
// a working form while the setting is off, matching this issue's own
// acceptance criterion ("screen ... not reachable").

const registerSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
type RegisterFormValues = z.infer<typeof registerSchema>;

const REGISTRATION_UNAVAILABLE_MESSAGE = "Self-registration is currently disabled. Contact your club administrator for an account.";

// ghs#105 review fix: POST /auth/register's only 403 is
// self_registration_disabled (the setting was toggled off between this
// page loading and the user submitting -- a real, if narrow, race). The
// raw error code isn't user-facing copy; map it to the same friendly
// message the disabled-gate state already shows, rather than surfacing
// error.message verbatim.
function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return REGISTRATION_UNAVAILABLE_MESSAGE;
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(values: RegisterFormValues) {
    setFeedback(null);
    try {
      // The backend responds identically whether or not the email is
      // already registered (enumeration protection) -- this form must
      // not contradict that with a different UI message for either
      // case, so onSuccess() fires unconditionally on a 2xx, with no
      // "already exists" branch to invent.
      await registerAccount(values);
      onSuccess();
    } catch (error) {
      setFeedback(describeError(error));
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {feedback && <Alert variant="error">{feedback}</Alert>}

      <FormField label="Email address" error={errors.email?.message}>
        <Input type="email" autoComplete="email" {...register("email")} />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="First name" error={errors.firstName?.message}>
          <Input type="text" autoComplete="given-name" {...register("firstName")} />
        </FormField>
        <FormField label="Last name" error={errors.lastName?.message}>
          <Input type="text" autoComplete="family-name" {...register("lastName")} />
        </FormField>
      </div>

      <FormField label="Password" helpText="At least 8 characters." error={errors.password?.message}>
        <Input type="password" autoComplete="new-password" {...register("password")} />
      </FormField>

      <Button type="submit" icon={<UserPlus aria-hidden="true" className="h-4 w-4" />} isLoading={isSubmitting} className="w-full">
        Create account
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

export default function RegisterPage() {
  const [registered, setRegistered] = useState(false);
  const enabledQuery = useQuery({ queryKey: ["auth", "self-registration-enabled"], queryFn: getSelfRegistrationEnabled });

  return (
    <div className="flex min-h-screen bg-surface">
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-[45%] lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm">
          <Logo label="GHS" />

          {enabledQuery.isPending ? (
            <div className="mt-8 flex flex-col gap-4">
              <Skeleton variant="text" width={220} height={28} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : enabledQuery.data !== true ? (
            // Fails closed on the *initial* fetch (data stays undefined
            // if it never succeeds) -- but deliberately does NOT key off
            // isError once real data has been obtained. A background
            // refetch (e.g. window refocus) that fails leaves isError
            // true while TanStack Query still retains the last-known
            // successful `data` (confirmed directly in @tanstack/query-
            // core's reducer -- the "error" case spreads ...state,
            // preserving data, only status flips). Gating on isError too
            // would flicker this page (or a mid-fill form) into "not
            // available" on a transient network blip, which is worse
            // than briefly trusting stale-but-correct data (review
            // finding, PR #123).
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">Registration isn't available</h1>
              <p className="mt-2 text-sm text-text-muted">{REGISTRATION_UNAVAILABLE_MESSAGE}</p>
              <BackToSignIn />
            </>
          ) : registered ? (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">Check your email</h1>
              <p className="mt-2 text-sm text-text-muted">
                Registration successful. Follow the activation link we sent you to finish setting up your account.
              </p>
              <BackToSignIn />
            </>
          ) : (
            <>
              <h1 className="mt-8 text-2xl font-semibold text-text">Create an account</h1>
              <p className="mt-2 text-sm text-text-muted">Register to start tracking your handicap.</p>
              <div className="mt-8">
                <RegisterForm onSuccess={() => setRegistered(true)} />
              </div>
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
