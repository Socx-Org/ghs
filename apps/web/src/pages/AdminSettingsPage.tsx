import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Alert, BackButton, Button, Card, CardBody, Checkbox, Input, Skeleton, ToggleGroup, useToast } from "../components";
import {
  ApiError,
  getAdminSettings,
  setActiveUsersChartPeriod,
  setMaintenanceMode,
  setNotificationSetting,
  setPlayerStatsRoundsWindow,
  setSelfRegistrationEnabled,
} from "../lib/api";
import type { NotificationSettingType } from "../lib/api";
import type { ActiveUsersChartPeriod } from "../types/domain";

// ghs#209: playerStatsRoundsWindow's own bounds -- mirrors the backend's
// (admin-settings.ts/system-settings.service.ts), duplicated here rather
// than fetched, matching how this page's other rows already hardcode
// their own vocabulary (e.g. ACTIVE_USERS_CHART_PERIOD_OPTIONS below).
const PLAYER_STATS_ROUNDS_WINDOW_MIN = 1;
const PLAYER_STATS_ROUNDS_WINDOW_MAX = 200;

const ACTIVE_USERS_CHART_PERIOD_OPTIONS: { value: ActiveUsersChartPeriod; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function activeUsersChartPeriodLabel(value: ActiveUsersChartPeriod): string {
  return ACTIVE_USERS_CHART_PERIOD_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

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

interface ChartPeriodSettingRowProps {
  label: string;
  description: string;
  value: ActiveUsersChartPeriod;
  isLoading: boolean;
  onChange: (next: ActiveUsersChartPeriod) => void;
}

// ghs#195: the settings vocabulary's first non-boolean value -- a
// segmented ToggleGroup (same primitive UserTrendsWidget's own period
// selector already uses), not a Checkbox, laid out as its own row shape
// rather than forcing SettingRow's checkbox-specific layout to also fit
// a three-way choice.
function ChartPeriodSettingRow({ label, description, value, isLoading, onChange }: ChartPeriodSettingRowProps) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span>
        <span className="block text-sm font-medium text-text">{label}</span>
        <span className="block text-sm text-text-muted">{description}</span>
      </span>
      <ToggleGroup
        name="active-users-chart-period"
        options={ACTIVE_USERS_CHART_PERIOD_OPTIONS}
        value={value}
        disabled={isLoading}
        onChange={(next) => onChange(next as ActiveUsersChartPeriod)}
        className="shrink-0"
      />
    </div>
  );
}

interface NumberSettingRowProps {
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  isLoading: boolean;
  onSave: (next: number) => void;
}

// ghs#209: this settings vocabulary's first free-form numeric value --
// unlike SettingRow/ChartPeriodSettingRow above, a number needs local
// draft state to hold what's been typed so far (an "on change" commit,
// fine for a single click/keypress toggle, would try to save on every
// keystroke of a multi-digit number). Resyncs to the server's confirmed
// value whenever it changes -- e.g. after a successful save's
// invalidate/refetch -- same "no manual revert, the query cache is the
// single source of truth" philosophy as the rest of this page, just
// applied to a draft that can legitimately differ from it while typing.
//
// Resetting `draft` when `value` changes during render (React's own
// documented "adjusting state when a prop changes" pattern), not a
// useEffect -- setState synchronously inside an effect just to mirror a
// prop is a real anti-pattern (a whole extra render pass for something
// this render can do itself), flagged directly by the
// react-hooks/set-state-in-effect lint rule.
function NumberSettingRow({ label, description, value, min, max, isLoading, onSave }: NumberSettingRowProps) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  const parsed = Number(draft);
  const isValid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max;
  const isDirty = draft !== String(value);

  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span>
        <span className="block text-sm font-medium text-text">{label}</span>
        <span className="block text-sm text-text-muted">{description}</span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {/* aria-label, not FormField -- the row's own visible label/
            description above already serves as this input's label,
            same bare-Input-with-aria-label convention as
            TeeConfigurationForm's compact per-hole number inputs. */}
        <Input
          type="number"
          inputMode="numeric"
          aria-label={label}
          min={min}
          max={max}
          step={1}
          value={draft}
          disabled={isLoading}
          invalid={!isValid}
          onChange={(event) => setDraft(event.target.value)}
          className="w-20"
        />
        <Button size="sm" variant="secondary" disabled={!isDirty || !isValid || isLoading} onClick={() => onSave(parsed)}>
          Save
        </Button>
      </div>
    </div>
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

  const activeUsersChartPeriodMutation = useMutation({
    mutationFn: setActiveUsersChartPeriod,
    onSuccess: async (_data, value) => {
      await invalidate();
      show({ variant: "success", message: `Active Right Now chart period set to ${activeUsersChartPeriodLabel(value)}.`, duration: 2500 });
    },
    onError: (error) => show({ variant: "error", message: describeError(error, "Couldn't update the chart period. Try again.") }),
  });

  const playerStatsRoundsWindowMutation = useMutation({
    mutationFn: setPlayerStatsRoundsWindow,
    onSuccess: async (_data, value) => {
      await invalidate();
      show({ variant: "success", message: `Player stats rounds window set to ${value}.`, duration: 2500 });
    },
    onError: (error) => show({ variant: "error", message: describeError(error, "Couldn't update the rounds window. Try again.") }),
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
      <BackButton onClick={() => navigate("/")} />
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
              <ChartPeriodSettingRow
                label="Active Right Now chart period"
                description="Comparison period for the Admin Dashboard's Active Right Now sparkline -- the current period plotted against the one immediately before it."
                value={settingsQuery.data.activeUsersChartPeriod}
                isLoading={activeUsersChartPeriodMutation.isPending}
                onChange={(value) => activeUsersChartPeriodMutation.mutate(value)}
              />
              <NumberSettingRow
                label="Player stats rounds window"
                description="How many of a player's most recent approved rounds the Dashboard's GIR/Fairways/Putting/Sand/Penalties widgets are based on."
                value={settingsQuery.data.playerStatsRoundsWindow}
                min={PLAYER_STATS_ROUNDS_WINDOW_MIN}
                max={PLAYER_STATS_ROUNDS_WINDOW_MAX}
                isLoading={playerStatsRoundsWindowMutation.isPending}
                onSave={(value) => playerStatsRoundsWindowMutation.mutate(value)}
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
