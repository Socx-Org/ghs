import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AccountStatusBadge,
  Alert,
  Button,
  Card,
  CardBody,
  EmptyState,
  ListView,
  Modal,
  RoleBadge,
  Skeleton,
  TableCell,
  TableHeaderCell,
  useToast,
} from "../components";
import { ApiError, deleteUser, listUsers, setUserStatus } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import type { AdminUserListItem } from "../types/domain";

// ghs#104: admin account list -- design doc sections 5.6-5.8. First
// real consumer of ListView (#103). Filtering/pagination UI is
// explicit non-scope (the issue's own text) -- listUsers() calls the
// backend with no params, relying entirely on its defaults.

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

export default function AdminAccountsPage() {
  const navigate = useNavigate();
  const { user: caller } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<AdminUserListItem | null>(null);

  const usersQuery = useQuery({ queryKey: ["admin", "users"], queryFn: listUsers });

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
    const nextStatus = item.status === "active" ? "disabled" : "active";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          isLoading={statusMutation.isPending && statusMutation.variables?.id === item.id}
          onClick={() => statusMutation.mutate({ id: item.id, status: nextStatus })}
        >
          {item.status === "active" ? "Disable" : "Enable"}
        </Button>
        {/* Self-deletion is already rejected server-side (400), but not
            offering the action at all on your own row is the honest UI
            -- matching, not merely tolerating, that server rule. */}
        {!isSelf && (
          <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(item)}>
            Delete
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            ← Back
          </Button>
          <h1 className="mt-4 text-2xl font-semibold text-text">Accounts</h1>
          <p className="mt-2 text-sm text-text-muted">Manage member and staff accounts.</p>
        </div>
        <Button onClick={() => navigate("/admin/users/new")}>Create account</Button>
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

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete account"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
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
