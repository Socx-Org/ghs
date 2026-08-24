import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, CardBody, Checkbox, Skeleton, useToast } from "../components";
import { ApiError, getAdminSettings, setMaintenanceMode, setNotificationSetting, setSelfRegistrationEnabled } from "../lib/api";
import type { NotificationSettingType } from "../lib/api";

// ghs#157: the one admin-only screen for GHS's fixed, finite settings
// vocabulary -- design doc / admin-settings.ts's own comment: "a fixed,
// finite, GHS-defined vocabulary, not a truly arbitrary key/value admin
// UI." notify_poll_interval_seconds has no HTTP route yet (explicit
// non-scope) and isn't offered here.
//
// Each toggle calls its own PUT endpoint independently on change,
// matching the backend's own per-setting route shape -- not a single
// bulk "Save" button, so each one gives its own immediate, honest
// success/error feedback via toast, and a failure on one never blocks
// or loses another.
//
// No manual revert-on-error logic: every checkbox's `checked` value is
// read directly from settingsQuery.data (the server's last confirmed
// state), never from local optimistic state. A successful mutation
// invalidates the query, pulling in the new confirmed value; a failed
// one leaves the query cache (and so every checkbox) exactly where it
// already was -- correct by construction, nothing to roll back.

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

interface SettingRowProps {
  label: string;
  description: string;
  checked: boolean;
  isLoading: boolean;
  onChange: (next: boolean) => void;
}

function SettingRow({ label, description, checked, isLoading, onChange }: SettingRowProps) {
  return (
    <label className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
      <Checkbox checked={checked} disabled={isLoading} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 shrink-0" />
      <span>
        <span className="block text-sm font-medium text-text">{label}</span>
        <span className="block text-sm text-text-muted">{description}</span>
      </span>
    </label>
  );
}

export default function AdminSettingsPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["admin", "settings"], queryFn: getAdminSettings });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
  }

  const maintenanceMutation = useMutation({
    mutationFn: setMaintenanceMode,
    onSuccess: async (_data, value) => {
      await invalidate();
      show({ variant: "success", message: `Maintenance mode ${value ? "enabled" : "disabled"}.`, duration: 2500 });
    },
    onError: (error) => show({ variant: "error", message: describeError(error, "Couldn't update maintenance mode. Try again.") }),
  });

  const selfRegistrationMutation = useMutation({
    mutationFn: setSelfRegistrationEnabled,
    onSuccess: async (_data, value) => {
      await invalidate();
      show({ variant: "success", message: `Self-registration ${value ? "enabled" : "disabled"}.`, duration: 2500 });
    },
    onError: (error) => show({ variant: "error", message: describeError(error, "Couldn't update self-registration. Try again.") }),
  });

  // One shared mutation for all three notification toggles, disambiguated
  // by comparing .variables.type -- same established pattern as
  // AdminAccountsPage's own statusMutation (one mutation, several
  // independently-triggerable targets, per-target loading state read via
  // `.variables`), not a special case invented here.
  const notificationMutation = useMutation({
    mutationFn: ({ type, value }: { type: NotificationSettingType; value: boolean }) => setNotificationSetting(type, value),
    onSuccess: async (_data, { value }) => {
      await invalidate();
      show({ variant: "success", message: `Notification setting ${value ? "enabled" : "disabled"}.`, duration: 2500 });
    },
    onError: (error) => show({ variant: "error", message: describeError(error, "Couldn't update this notification setting. Try again.") }),
  });

  function isNotificationLoading(type: NotificationSettingType): boolean {
    return notificationMutation.isPending && notificationMutation.variables?.type === type;
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
        ← Back
      </Button>
      <h1 className="mt-4 text-2xl font-semibold text-text">Settings</h1>
      <p className="mt-2 text-sm text-text-muted">System-wide configuration for GHS.</p>

      <Card className="mt-8">
        <CardBody>
          {settingsQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={56} />
              <Skeleton height={56} />
              <Skeleton height={56} />
            </div>
          ) : settingsQuery.isError ? (
            <Alert variant="error">{describeError(settingsQuery.error, "Couldn't load settings. Try refreshing the page.")}</Alert>
          ) : (
            <div className="divide-y divide-border">
              <SettingRow
                label="Maintenance mode"
                description="Flags the app as under maintenance. No frontend behaviour reads this yet -- toggling it here honestly records the setting, without yet doing anything else with it."
                checked={settingsQuery.data.maintenanceMode}
                isLoading={maintenanceMutation.isPending}
                onChange={(value) => maintenanceMutation.mutate(value)}
              />
              <SettingRow
                label="Self-registration"
                description="Allow visitors to create their own account from the login screen. Turning this on exposes the registration flow that already exists -- it doesn't build anything new."
                checked={settingsQuery.data.selfRegistrationEnabled}
                isLoading={selfRegistrationMutation.isPending}
                onChange={(value) => selfRegistrationMutation.mutate(value)}
              />
              <SettingRow
                label="Notify on round submitted"
                description="Send a notification when a player submits a round for review."
                checked={settingsQuery.data.notifications.roundSubmitted}
                isLoading={isNotificationLoading("round-submitted")}
                onChange={(value) => notificationMutation.mutate({ type: "round-submitted", value })}
              />
              <SettingRow
                label="Notify on round approved"
                description="Send a notification when a submitted round is approved."
                checked={settingsQuery.data.notifications.roundApproved}
                isLoading={isNotificationLoading("round-approved")}
                onChange={(value) => notificationMutation.mutate({ type: "round-approved", value })}
              />
              <SettingRow
                label="Maintenance alert notifications"
                description="Send a notification when maintenance mode changes."
                checked={settingsQuery.data.notifications.maintenanceAlerts}
                isLoading={isNotificationLoading("maintenance-alerts")}
                onChange={(value) => notificationMutation.mutate({ type: "maintenance-alerts", value })}
              />
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
