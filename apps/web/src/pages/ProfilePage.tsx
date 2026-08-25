import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, BackButton, Button, Card, CardBody, CardHeader, FormField, Input, RoleBadge, Skeleton } from "../components";
import { ApiError, changePassword, getMe } from "../lib/api";
import type { AccountProfile } from "../types/domain";

// ghs#108: profile screen -- design doc section 5.5. Displays account
// info from GET /auth/me (email, role, name) read-only -- role/status
// are never editable here regardless of the caller's own role, and
// status isn't part of this issue's display scope either (only email/
// role/name are). Change-password form calls POST /auth/change-password
// (both ghs#98). No editable name/email fields -- no backend endpoint
// exists for that (issue's own explicit non-scope).

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function accountName(profile: Pick<AccountProfile, "firstName" | "lastName">): string | null {
  return profile.firstName && profile.lastName ? `${profile.firstName} ${profile.lastName}` : null;
}

function ChangePasswordForm() {
  const [feedback, setFeedback] = useState<{ variant: "success" | "error"; message: string } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({ resolver: zodResolver(changePasswordSchema) });

  async function onSubmit(values: ChangePasswordFormValues) {
    setFeedback(null);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      setFeedback({ variant: "success", message: "Password changed." });
      reset();
    } catch (error) {
      setFeedback({ variant: "error", message: describeError(error, "Something went wrong. Please try again.") });
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {feedback && <Alert variant={feedback.variant}>{feedback.message}</Alert>}

      <FormField label="Current password" error={errors.currentPassword?.message}>
        <Input type="password" autoComplete="current-password" {...register("currentPassword")} />
      </FormField>

      <FormField label="New password" helpText="At least 8 characters." error={errors.newPassword?.message}>
        <Input type="password" autoComplete="new-password" {...register("newPassword")} />
      </FormField>

      <FormField label="Confirm new password" error={errors.confirmPassword?.message}>
        <Input type="password" autoComplete="new-password" {...register("confirmPassword")} />
      </FormField>

      <Button type="submit" isLoading={isSubmitting} className="w-full sm:w-auto">
        Change password
      </Button>
    </form>
  );
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const profileQuery = useQuery({ queryKey: ["auth", "me"], queryFn: getMe });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <div>
        <BackButton onClick={() => navigate("/")} />
        <h1 className="mt-4 text-2xl font-semibold text-text">Profile</h1>
        <p className="mt-2 text-sm text-text-muted">View your account details and change your password.</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-text">Account</h2>
        </CardHeader>
        <CardBody>
          {profileQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton variant="text" width={220} height={20} />
              <Skeleton variant="text" width={160} height={20} />
              <Skeleton variant="text" width={100} height={20} />
            </div>
          ) : profileQuery.isError ? (
            <Alert variant="error">{describeError(profileQuery.error, "Couldn't load your account. Try refreshing the page.")}</Alert>
          ) : (
            <dl className="flex flex-col gap-4">
              <div>
                <dt className="text-xs font-medium text-text-muted">Email</dt>
                <dd className="text-sm text-text">{profileQuery.data.email}</dd>
              </div>
              {accountName(profileQuery.data) && (
                <div>
                  <dt className="text-xs font-medium text-text-muted">Name</dt>
                  <dd className="text-sm text-text">{accountName(profileQuery.data)}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium text-text-muted">Role</dt>
                <dd className="mt-1">
                  <RoleBadge role={profileQuery.data.role} />
                </dd>
              </div>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-text">Change password</h2>
        </CardHeader>
        <CardBody>
          <ChangePasswordForm />
        </CardBody>
      </Card>
    </div>
  );
}
