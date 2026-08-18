import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Alert, Button, Checkbox, FormField, Input, Select } from "../components";
import { ApiError, createUser } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

// ghs#86. The real onboarding path -- until this exists, creating an
// account means hand-crafted SQL or raw HTTP calls, which isn't a
// workflow a real club administrator has access to.

const createUserSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  role: z.enum(["player", "admin", "super_admin"]),
  password: z.string().min(8, "Password must be at least 8 characters"),
  autoActivate: z.boolean(),
});
type CreateUserFormValues = z.infer<typeof createUserSchema>;

const EMPTY_FORM: CreateUserFormValues = {
  email: "",
  firstName: "",
  lastName: "",
  role: "player",
  password: "",
  autoActivate: false,
};

interface FormFeedback {
  variant: "success" | "error";
  message: string;
}

export default function AdminCreateUserPage() {
  const { user: caller } = useAuth();
  const navigate = useNavigate();
  // Only a super_admin may create admin/super_admin accounts (verified
  // backend rule, apps/api/src/interface/http/routes/admin-users.ts).
  // The role field is only rendered at all for a super_admin caller --
  // a plain admin has exactly one legal choice, so a disabled dropdown
  // showing it would just be noise, not real affordance.
  const canElevate = caller?.role === "super_admin";
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: EMPTY_FORM,
  });

  async function onSubmit(values: CreateUserFormValues) {
    setFeedback(null);
    // Defence in depth: the role field is hidden for a plain admin, but
    // a tampered submission shouldn't reach the server as anything other
    // than "player" -- the server's own 403 is the real authority here,
    // this just avoids relying on it alone.
    const role = canElevate ? values.role : "player";
    try {
      const result = await createUser({ ...values, role });
      setFeedback({
        variant: "success",
        message: values.autoActivate
          ? `Account created and active (user ${result.userId}).`
          : `Account created -- an activation email will be sent (user ${result.userId}).`,
      });
      reset(EMPTY_FORM);
    } catch (error) {
      setFeedback({
        variant: "error",
        message: error instanceof ApiError ? error.message : "Something went wrong. Please try again.",
      });
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center bg-bg-page px-4 py-12">
      <div className="mx-auto w-full max-w-lg">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          ← Back
        </Button>
        <h1 className="mt-4 text-2xl font-semibold text-text">Create account</h1>
        <p className="mt-2 text-sm text-text-muted">
          New accounts default to pending activation. Check "Activate immediately" to skip the
          activation email and make the account active right away.
        </p>

        <form className="mt-8 flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
          {feedback && <Alert variant={feedback.variant}>{feedback.message}</Alert>}

          <FormField label="Email address" error={errors.email?.message}>
            <Input type="email" autoComplete="off" {...register("email")} />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="First name" error={errors.firstName?.message}>
              <Input type="text" autoComplete="off" {...register("firstName")} />
            </FormField>
            <FormField label="Last name" error={errors.lastName?.message}>
              <Input type="text" autoComplete="off" {...register("lastName")} />
            </FormField>
          </div>

          {canElevate && (
            <FormField label="Role" error={errors.role?.message}>
              <Select {...register("role")}>
                <option value="player">Player</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super admin</option>
              </Select>
            </FormField>
          )}

          <FormField
            label="Initial password"
            helpText="At least 8 characters. This is the account's real password until the holder resets it themselves."
            error={errors.password?.message}
          >
            <Input type="password" autoComplete="new-password" {...register("password")} />
          </FormField>

          <label className="flex items-center gap-2 text-sm text-text">
            <Checkbox {...register("autoActivate")} />
            Activate immediately (skip the activation email)
          </label>

          <Button type="submit" isLoading={isSubmitting} className="w-full">
            Create account
          </Button>
        </form>
      </div>
    </div>
  );
}
