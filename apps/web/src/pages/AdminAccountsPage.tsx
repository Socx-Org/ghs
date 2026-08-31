import { useState } from "react";
import { Ban, CircleCheck, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  AccountStatusBadge,
  Alert,
  BackButton,
  Button,
  Card,
  CardBody,
  EmptyState,
  FormField,
  Input,
  ListView,
  Modal,
  RoleBadge,
  Select,
  Skeleton,
  TableCell,
  TableHeaderCell,
  Tooltip,
  useToast,
} from "../components";
import { ApiError, deleteUser, listUsers, setUserStatus, updateUser } from "../lib/api";
import type { UpdateUserRequest } from "../lib/api";
import { ACCOUNT_STATUS_OPTIONS, ROLE_OPTIONS } from "../lib/domain-labels";
import { useAuth } from "../hooks/useAuth";
import type { AdminUserListItem } from "../types/domain";

// ghs#104: admin account list -- design doc sections 5.6-5.8. First
// real consumer of ListView (#103). listUsers() calls the backend with
// no params, relying entirely on its defaults -- narrowing the result
// happens client-side, via ListView's own search/filter (ghs#137).
//
// ghs#137 review fix: Role/Status filter options are sourced from
// RoleBadge/AccountStatusBadge's own exported option lists, not
// redefined here -- a second copy of those labels would drift from the
// badge's the moment either changed independently.

function formatCreatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function accountName(item: AdminUserListItem): string {
  // null for admin/super_admin accounts -- no players row exists for
  // them at all (see AdminUserListItem's own doc comment), not a
  // loading/error state to distinguish from a real one.
  return item.firstName && item.lastName ? `${item.firstName} ${item.lastName}` : "—";
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// ghs#191. firstName/lastName only required when actually rendered
// (a player account, see canEditName below) -- react-hook-form still
// populates them with a real (non-undefined) value whenever the field
// is mounted at all, so .min(1) correctly rejects an empty submission
// either way. role is restricted to admin/super_admin here -- crossing
// the player boundary is deliberately unsupported (see the issue's own
// Explicit Non-Scope), so "player" is never a selectable option.
const editAccountSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  firstName: z.string().min(1, "First name is required").optional(),
  lastName: z.string().min(1, "Last name is required").optional(),
  role: z.enum(["admin", "super_admin"]).optional(),
});
type EditAccountFormValues = z.infer<typeof editAccountSchema>;

interface EditAccountFormProps {
  target: AdminUserListItem;
  canEditRole: boolean;
  onSubmit: (input: UpdateUserRequest) => Promise<void>;
  onCancel: () => void;
}

function EditAccountForm({ target, canEditRole, onSubmit, onCancel }: EditAccountFormProps) {
  // null firstName/lastName (no players row, ghs#98) means there's
  // nothing to edit -- the account is admin/super_admin, matching
  // AdminUserListItem's own established null-for-non-player contract.
  const canEditName = target.firstName !== null && target.lastName !== null;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditAccountFormValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: {
      email: target.email,
      firstName: target.firstName ?? undefined,
      lastName: target.lastName ?? undefined,
      role: target.role === "player" ? undefined : target.role,
    },
  });

  async function submit(values: EditAccountFormValues) {
    // Only fields this form actually offered are sent -- presence, not
    // truthiness, matches PATCH /admin/users/:id's own convention
    // (an omitted field is left untouched server-side, not cleared).
    const input: UpdateUserRequest = { email: values.email };
    if (canEditName) {
      input.firstName = values.firstName;
      input.lastName = values.lastName;
    }
    if (canEditRole) {
      input.role = values.role;
    }
    try {
      await onSubmit(input);
    } catch {
      // Deliberately swallowed here -- the caller's own mutation
      // onError already shows the real error via a toast (and, unlike
      // a delete confirmation, deliberately leaves this modal open so
      // the admin can fix and resubmit, e.g. a duplicate-email 409).
      // This catch exists only to keep isSubmitting resolving cleanly
      // without an unhandled rejection.
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(submit)} noValidate>
      <FormField label="Email address" error={errors.email?.message}>
        <Input type="email" autoComplete="off" {...register("email")} />
      </FormField>

      {canEditName && (
        <div className="grid grid-cols-2 gap-4">
          <FormField label="First name" error={errors.firstName?.message}>
            <Input type="text" autoComplete="off" {...register("firstName")} />
          </FormField>
          <FormField label="Last name" error={errors.lastName?.message}>
            <Input type="text" autoComplete="off" {...register("lastName")} />
          </FormField>
        </div>
      )}

      {canEditRole && (
        <FormField label="Role" error={errors.role?.message}>
          <Select {...register("role")}>
            <option value="admin">Admin</option>
            <option value="super_admin">Super admin</option>
          </Select>
        </FormField>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" icon={<Save aria-hidden="true" className="h-4 w-4" />} isLoading={isSubmitting}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

export default function AdminAccountsPage() {
  const navigate = useNavigate();
  const { user: caller } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<AdminUserListItem | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUserListItem | null>(null);

  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: () => listUsers() });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserRequest }) => updateUser(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      show({ variant: "success", message: "Account updated.", duration: 2500 });
      setEditTarget(null);
    },
    // Modal deliberately stays open on error (unlike delete's own
    // success-only close) -- a real, actionable failure here (most
    // concretely a duplicate email, 409) is something the admin can
    // fix and resubmit without losing what they'd already typed.
    onError: (error) => {
      show({ variant: "error", message: describeQueryError(error, "Couldn't update the account. Try again.") });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) => setUserStatus(id, status),
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      show({ variant: "success", message: `Account ${status === "active" ? "enabled" : "disabled"}.`, duration: 2500 });
    },
    onError: (error) => {
      show({ variant: "error", message: describeQueryError(error, "Couldn't update the account. Try again.") });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      show({ variant: "success", message: "Account deleted.", duration: 2500 });
      setDeleteTarget(null);
    },
    onError: (error) => {
      show({ variant: "error", message: describeQueryError(error, "Couldn't delete the account. Try again.") });
    },
  });

  function renderActions(item: AdminUserListItem) {
    if (item.status === "deleted") return null;
    const isSelf = item.id === caller?.sub;
    // Enable/Disable is only a real active<->disabled toggle (#98's
    // PATCH .../status endpoint) -- a pending_verification account only
    // gets Delete here. Offering "Enable" on it would silently
    // force-activate the account, skipping the real activation-token
    // flow entirely, which is a materially different, more consequential
    // action than this button's label would honestly convey (review
    // finding, PR #122).
    const showStatusToggle = item.status === "active" || item.status === "disabled";
    const nextStatus = item.status === "active" ? "disabled" : "active";
    // ghs#134: row actions are icon-only within a ListView -- the row's
    // own cells already give a sighted user context, and the accessible
    // name (aria-label, below) names the account explicitly rather than
    // relying on ambiguous table-position context for assistive tech.
    const isDisabling = item.status === "active";
    // ghs#166: content mirrors each button's own aria-label -- single
    // source of truth, not a second copy that can drift.
    const statusLabel = `${isDisabling ? "Disable" : "Enable"} ${item.email}`;
    const deleteLabel = `Delete ${item.email}`;
    const editLabel = `Edit ${item.email}`;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={editLabel}>
          <Button variant="secondary" size="sm" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} aria-label={editLabel} onClick={() => setEditTarget(item)} />
        </Tooltip>
        {showStatusToggle && (
          <Tooltip content={statusLabel}>
            <Button
              variant="secondary"
              size="sm"
              icon={isDisabling ? <Ban aria-hidden="true" className="h-4 w-4" /> : <CircleCheck aria-hidden="true" className="h-4 w-4" />}
              aria-label={statusLabel}
              isLoading={statusMutation.isPending && statusMutation.variables?.id === item.id}
              onClick={() => statusMutation.mutate({ id: item.id, status: nextStatus })}
            />
          </Tooltip>
        )}
        {/* Self-deletion is already rejected server-side (400), but not
            offering the action at all on your own row is the honest UI
            -- matching, not merely tolerating, that server rule. */}
        {!isSelf && (
          <Tooltip content={deleteLabel}>
            <Button variant="destructive" size="sm" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} aria-label={deleteLabel} onClick={() => setDeleteTarget(item)} />
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <BackButton onClick={() => navigate("/")} />
          <h1 className="mt-4 text-2xl font-semibold text-text">Accounts</h1>
          <p className="mt-2 text-sm text-text-muted">Manage member and staff accounts.</p>
        </div>
        <Button icon={<Plus aria-hidden="true" className="h-4 w-4" />} onClick={() => navigate("/admin/users/new")}>
          Create account
        </Button>
      </div>

      <Card className="mt-8">
        <CardBody>
          {usersQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          ) : usersQuery.isError ? (
            <Alert variant="error">{describeQueryError(usersQuery.error, "Couldn't load accounts. Try refreshing the page.")}</Alert>
          ) : (
            <ListView<AdminUserListItem>
              id="accounts"
              items={usersQuery.data.items}
              getKey={(item) => item.id}
              searchPlaceholder="Search by email or name…"
              getSearchText={(item) => `${item.email} ${accountName(item)}`}
              filters={[
                { id: "role", label: "Role", getValue: (item) => item.role, options: ROLE_OPTIONS },
                { id: "status", label: "Status", getValue: (item) => item.status, options: ACCOUNT_STATUS_OPTIONS },
              ]}
              tableHead={
                <>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </>
              }
              renderTableRow={(item) => (
                <>
                  <TableCell>{item.email}</TableCell>
                  <TableCell>{accountName(item)}</TableCell>
                  <TableCell>
                    <RoleBadge role={item.role} />
                  </TableCell>
                  <TableCell>
                    <AccountStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell>{formatCreatedAt(item.createdAt)}</TableCell>
                  <TableCell>{renderActions(item)}</TableCell>
                </>
              )}
              renderCard={(item) => (
                <Card>
                  <CardBody className="flex flex-col gap-3">
                    <div>
                      <p className="text-sm font-medium text-text">{item.email}</p>
                      <p className="text-xs text-text-muted">{accountName(item)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <RoleBadge role={item.role} />
                      <AccountStatusBadge status={item.status} />
                    </div>
                    <p className="text-xs text-text-muted">Created {formatCreatedAt(item.createdAt)}</p>
                    {renderActions(item)}
                  </CardBody>
                </Card>
              )}
              emptyState={<EmptyState title="No accounts yet" description="Accounts created here or by self-registration will show up here." />}
            />
          )}
        </CardBody>
      </Card>

      {/* Conditionally rendered, not just open={editTarget !== null} on an
          always-mounted Modal -- Modal never unmounts its children when
          closed, so EditAccountForm's own useForm state would otherwise
          persist across a close/reopen instead of resetting to fresh
          defaults for whichever row was clicked next (same pattern as
          CourseDetailPage's tee-configuration edit modal). */}
      {editTarget && (
        <Modal open={Boolean(editTarget)} onClose={() => setEditTarget(null)} title="Edit account">
          <EditAccountForm
            target={editTarget}
            canEditRole={caller?.role === "super_admin" && editTarget.id !== caller.sub && editTarget.role !== "player"}
            onSubmit={async (input) => {
              await updateMutation.mutateAsync({ id: editTarget.id, input });
            }}
            onCancel={() => setEditTarget(null)}
          />
        </Modal>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete account"
        footer={
          <>
            <Button variant="secondary" icon={<X aria-hidden="true" className="h-4 w-4" />} onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
              isLoading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete account
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Delete <strong>{deleteTarget?.email}</strong>? This is a destructive action -- the account will no longer be
          able to sign in. Any rounds and handicap history linked to it are kept.
        </p>
      </Modal>
    </div>
  );
}
