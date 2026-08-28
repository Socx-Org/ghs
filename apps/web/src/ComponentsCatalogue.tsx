import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Flag,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  Save,
  Check,
  X,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  LayoutGrid,
  Table2,
} from "lucide-react";
import {
  Alert,
  AppHeader,
  Avatar,
  BackButton,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  EmptyState,
  FormField,
  Input,
  List,
  ListItem,
  ListView,
  Logo,
  Modal,
  NavItem,
  RadioGroup,
  RecentRoundsWidget,
  RoleBadge,
  RoundStatusBadge,
  Select,
  Skeleton,
  Spinner,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
  ThemeToggle,
  ToggleGroup,
  Tooltip,
  Widget,
} from "./components";
import type { WidgetStatus } from "./components";
import { useToast } from "./components/useToast";
import { ROUND_STATUS_OPTIONS } from "./lib/domain-labels";
import type { PlayerRoundListItem, RoundStatus, UserRole } from "./types/domain";

// ghs#78/#82: the living visual reference for GHS. Every component
// rendered here is the actual component apps/web/src/components exports
// -- nothing on this page is a one-off styled to look similar; subsequent
// screens (starting with Login/MFA, #64) import from the same
// components/ module. Dev-only -- see App.tsx's `MODE === "development"`
// gate (not import.meta.env.DEV, which is also true under Vitest's test mode).

const ROUND_STATUSES: RoundStatus[] = ["draft", "pending", "approved", "rejected", "amending"];
const ROLES: UserRole[] = ["player", "admin", "super_admin"];

type ApiHealth = "checking" | "ok" | "error";

const SAMPLE_ROUNDS: Array<{
  id: string;
  course: string;
  tee: string;
  playedAt: string;
  status: RoundStatus;
  differential: number | null;
}> = [
  { id: "1", course: "Sunningdale (Old)", tee: "Yellow", playedAt: "2026-08-10", status: "approved", differential: 14.2 },
  { id: "2", course: "St Andrews (Old)", tee: "White", playedAt: "2026-08-14", status: "pending", differential: null },
  { id: "3", course: "Wentworth (West)", tee: "Yellow", playedAt: "2026-08-16", status: "rejected", differential: null },
  { id: "4", course: "Sunningdale (New)", tee: "Red", playedAt: "2026-08-17", status: "amending", differential: null },
  { id: "5", course: "Wentworth (East)", tee: "Yellow", playedAt: "2026-08-18", status: "draft", differential: null },
];

// ghs#116: PlayerRoundListItem-shaped (courseName/teeConfigurationName
// enriched, ghs#147), distinct from SAMPLE_ROUNDS above -- the exact
// shape RecentRoundsWidget's real caller (PlayerDashboardPage) passes.
const SAMPLE_PLAYER_ROUNDS: PlayerRoundListItem[] = [
  { id: "1", playerId: "p1", courseId: "c1", courseName: "Sunningdale (Old)", teeConfigurationId: "t1", teeConfigurationName: "Yellow", playedAt: "2026-08-17T09:00:00.000Z", status: "draft" },
  { id: "2", playerId: "p1", courseId: "c2", courseName: "St Andrews (Old)", teeConfigurationId: "t2", teeConfigurationName: "White", playedAt: "2026-08-14T09:00:00.000Z", status: "pending" },
  { id: "3", playerId: "p1", courseId: "c1", courseName: "Sunningdale (Old)", teeConfigurationId: "t1", teeConfigurationName: "Yellow", playedAt: "2026-08-10T09:00:00.000Z", status: "approved" },
];

const REJECTED_ROUND_REASON =
  "9th hole score exceeds the net double bogey cap for your course handicap -- please recheck the strokes entered for that hole.";

const SAMPLE_MEMBERS: Array<{ name: string; role: UserRole }> = [
  { name: "Alice Whitfield", role: "player" },
  { name: "Ben Okafor", role: "admin" },
  { name: "Carys Newton", role: "super_admin" },
];

const SEMANTIC_SWATCHES: Array<{ name: string; swatch: string; note: string }> = [
  { name: "Primary (emerald-700 / dark: emerald-500)", swatch: "bg-primary", note: "Buttons, links, focus rings, active nav -- measured 5.36:1 as text/button fill (light), 7.21:1 (dark)" },
  { name: "Success (green-700 / dark: green-400)", swatch: "bg-success", note: "Approved rounds, success banners -- distinct hue from primary (~14deg), not just a darker emerald" },
  { name: "Warning (amber-700 / dark: amber-400)", swatch: "bg-warning", note: "Pending rounds, warning banners" },
  { name: "Danger (red-600 / dark: red-400)", swatch: "bg-danger", note: "Rejected rounds, destructive actions, errors" },
  { name: "Info (blue-700 / dark: blue-400)", swatch: "bg-info", note: "Informational banners" },
  { name: "Amending (violet-600 / dark: violet-400)", swatch: "bg-amending", note: "Round sent back for player resubmission -- distinct from warning/pending" },
];

function SectionHeading({ headingId, title, description }: { headingId: string; title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h2 id={headingId} className="text-2xl font-semibold text-text scroll-mt-20">
        {title}
      </h2>
      {description && <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p>}
    </div>
  );
}

function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      {children}
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  // The nav's #id anchors and aria-labelledby must both resolve to
  // exactly one element -- id lives on the <section> (the real
  // scroll/anchor target), the <h2> gets its own distinct id (found as a
  // duplicate-id bug via real browser verification, ghs#78).
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="border-b border-border py-12 first:pt-0 last:border-b-0">
      <SectionHeading headingId={headingId} title={title} description={description} />
      <div className="flex flex-col gap-8">{children}</div>
    </section>
  );
}

function ToastDemo() {
  const { show } = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button size="sm" variant="secondary" onClick={() => show({ variant: "success", message: "Round saved." })}>
        Show success
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => show({ variant: "error", title: "Failed to submit", message: "Strokes must be a positive number." })}
      >
        Show error
      </Button>
      <Button size="sm" variant="secondary" onClick={() => show({ variant: "warning", message: "Your session will expire in 5 minutes." })}>
        Show warning
      </Button>
      <Button size="sm" variant="secondary" onClick={() => show({ variant: "info", message: "Admin review can take up to 48 hours." })}>
        Show info
      </Button>
    </div>
  );
}

export default function ComponentsCatalogue() {
  const [apiHealth, setApiHealth] = useState<ApiHealth>("checking");
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [roundType, setRoundType] = useState("18");
  const [nineHole, setNineHole] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [infoModalOpen, setInfoModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState("list");
  const [tableGridMode, setTableGridMode] = useState("table");
  const [activeNav, setActiveNav] = useState("dashboard");
  const [showSkeletons, setShowSkeletons] = useState(true);
  const [widgetStatus, setWidgetStatus] = useState<WidgetStatus>("ready");

  useEffect(() => {
    let cancelled = false;
    fetch("/healthz")
      .then((res) => {
        if (!cancelled) setApiHealth(res.ok ? "ok" : "error");
      })
      .catch(() => {
        if (!cancelled) setApiHealth("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nameError = formSubmitted && playerName.trim() === "" ? "Player name is required." : undefined;

  return (
    <div className="min-h-screen bg-bg-page text-text">
      <AppHeader
        brand={<Logo />}
        nav={
          <>
            <NavItem icon={<LayoutDashboard className="h-4 w-4" />} active={activeNav === "dashboard"} onClick={() => setActiveNav("dashboard")}>
              Dashboard
            </NavItem>
            <NavItem icon={<Flag className="h-4 w-4" />} active={activeNav === "rounds"} onClick={() => setActiveNav("rounds")}>
              Rounds
            </NavItem>
            <NavItem icon={<ShieldCheck className="h-4 w-4" />} active={activeNav === "admin"} onClick={() => setActiveNav("admin")}>
              Admin
            </NavItem>
          </>
        }
        actions={
          <>
            <Badge variant={apiHealth === "ok" ? "success" : apiHealth === "error" ? "danger" : "neutral"}>API: {apiHealth}</Badge>
            <ThemeToggle />
          </>
        }
      />

      {/* In-page section nav -- dogfoods NavItem/Button styling rather than one-off link classes. */}
      <div className="border-b border-border bg-surface">
        <nav aria-label="Catalogue sections" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
          {[
            ["foundations", "Foundations"],
            ["actions", "Actions"],
            ["forms", "Forms"],
            ["feedback", "Feedback"],
            ["data-display", "Data/Display"],
            ["widgets", "Dashboard Widgets"],
            ["overlays", "Overlays"],
            ["navigation", "Navigation"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-text-muted hover:bg-text/5 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
            >
              {label}
            </a>
          ))}
        </nav>
      </div>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Section
          id="foundations"
          title="Foundations"
          description="Brand, colour, type, spacing, radius, elevation, focus and iconography. Everything below is built from these, not invented per component."
        >
          <Example label="Brand mark -- Logo, full and mark-only variants">
            <div className="flex flex-wrap items-center gap-8">
              <Logo variant="full" />
              <Logo variant="mark" className="h-10 w-10" />
            </div>
            <p className="text-sm text-text-muted">
              Circle = text colour, S = surface colour -- automatically inverts with theme (black circle/white S in light, white
              circle/black S in dark) without a separate dark-mode-specific asset. Minimum rendered size 24px.
            </p>
          </Example>

          <Example label="Semantic colour system (validated WCAG contrast, not assumed -- see frontend-architecture.md)">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {SEMANTIC_SWATCHES.map((s) => (
                <div key={s.name} className="flex flex-col gap-2">
                  <div className={`h-12 w-full rounded-md ${s.swatch}`} aria-hidden="true" />
                  <p className="text-sm font-medium text-text">{s.name}</p>
                  <p className="text-xs text-text-muted">{s.note}</p>
                </div>
              ))}
            </div>
          </Example>

          <Example label="Typography hierarchy">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-semibold text-text">Page heading -- text-3xl font-semibold</h1>
              <h2 className="text-lg font-semibold text-text">Section heading -- text-lg font-semibold</h2>
              <p className="text-base text-text">Body text -- text-base, default paragraph copy.</p>
              <p className="text-sm text-text-muted">Muted / help text -- text-sm text-text-muted, used for hints and captions.</p>
              <p className="text-2xl font-semibold tabular-nums text-text">14.2 -- numeric/stat values use tabular-nums</p>
              <a href="#foundations" className="text-sm font-medium text-primary hover:underline">
                Link -- text-primary, underline on hover
              </a>
            </div>
          </Example>

          <Example label="Spacing scale (Tailwind default, no arbitrary values)">
            <div className="flex flex-wrap items-end gap-4">
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <div key={n} className="flex flex-col items-center gap-1">
                  <div className="w-8 bg-primary/20" style={{ height: `${n * 4}px` }} aria-hidden="true" />
                  <span className="text-xs text-text-muted">{n * 4}px</span>
                </div>
              ))}
            </div>
          </Example>

          <Example label="Radius -- rounded-full (pills) / rounded-md (controls) / rounded-lg (surfaces)">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full border border-border bg-surface" />
              <div className="h-16 w-24 rounded-md border border-border bg-surface" />
              <div className="h-16 w-24 rounded-lg border border-border bg-surface" />
            </div>
          </Example>

          <Example label="Elevation -- shadow-sm (default) vs shadow-lg (modals only); dark theme uses lightness steps, not shadow">
            <div className="flex gap-6">
              <div className="h-16 w-24 rounded-lg bg-surface shadow-sm" />
              <div className="h-16 w-24 rounded-lg bg-surface shadow-lg" />
              <div className="h-16 w-24 rounded-lg bg-surface-raised" />
            </div>
          </Example>

          <Example label="Focus behaviour -- Tab through these to see the emerald ring">
            <div className="flex flex-wrap gap-3">
              <Button size="sm">First</Button>
              <Button size="sm" variant="secondary">
                Second
              </Button>
              <a
                href="#foundations"
                className="rounded-md px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
              >
                Third (link)
              </a>
            </div>
          </Example>

          <Example label="Iconography -- lucide-react, one consistent stroke-width line-icon set">
            <div className="flex flex-wrap items-center gap-4 text-text-muted">
              {[Plus, Pencil, Trash2, Save, Check, X, Search, Filter].map((Icon, i) => (
                <Icon key={i} aria-hidden="true" className="h-5 w-5" />
              ))}
            </div>
          </Example>
        </Section>

        <Section id="actions" title="Actions" description="One Button primitive: variant, size, loading and icon-only are all props, not separate components.">
          <Example label="Variants">
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="ghost">Ghost</Button>
            </div>
          </Example>

          <Example label="Sizes (md is the default and meets the 44px touch-target minimum)">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
          </Example>

          <Example label="States">
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled>Disabled</Button>
              <Button isLoading>Saving</Button>
              <Button variant="destructive" isLoading>
                Rejecting
              </Button>
            </div>
          </Example>

          <Example label="Icon + text (icon prop, ghs#134) -- caller sizes and aria-hides its own icon; Button doesn't wrap or resize it">
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={<Plus aria-hidden="true" className="h-4 w-4" />}>Create course</Button>
              <Button variant="secondary" icon={<Pencil aria-hidden="true" className="h-4 w-4" />}>
                Edit
              </Button>
              <Button variant="destructive" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}>
                Delete
              </Button>
              <BackButton />
              <p className="text-sm text-text-muted">
                BackButton wraps this same icon prop with a fixed ArrowLeft + ghost/sm styling -- used for every "back to the previous
                screen" link across the app instead of each page hand-rolling its own.
              </p>
            </div>
          </Example>

          <Example label="Icon-only (requires aria-label -- no visible text)">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" aria-label="Close">
                <X aria-hidden="true" className="h-5 w-5" />
              </Button>
              <p className="text-sm text-text-muted">Compact affordances (e.g. remove a hole-score row) get an accessible name via aria-label, not visible text.</p>
            </div>
          </Example>

          <Example label="Icon-only via the icon prop (ghs#134) -- ListView row actions (Edit/Delete/Disable) use this form, so the icon prop gets Button's own square icon-button sizing">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} aria-label="Edit round at Pebble Beach Golf Links" />
              <Button variant="destructive" size="sm" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} aria-label="Delete round at Pebble Beach Golf Links" />
              <p className="text-sm text-text-muted">
                A row-action's aria-label names the row it acts on explicitly (e.g. "Delete round at ...") rather than leaving several
                identically-named icon buttons on the same page for assistive tech.
              </p>
            </div>
          </Example>

          <Example label="Tooltip (ghs#166) -- liquid glass: a blurred, translucent panel, not an opaque one. Hover (after a brief delay), Tab to focus, or tap on touch -- never hover-only.">
            {/* pt-10, not the usual py-4 -- a "top"-placed Tooltip needs
                real clearance above the button, or it overlaps this
                Example's own (possibly wrapped) label text above it. */}
            <div className="flex flex-wrap items-center gap-6 pt-10 pb-4">
              <Tooltip content="Edit round at Pebble Beach Golf Links">
                <Button variant="secondary" size="sm" icon={<Pencil aria-hidden="true" className="h-4 w-4" />} aria-label="Edit round at Pebble Beach Golf Links" />
              </Tooltip>
              <Tooltip content="Delete round at Pebble Beach Golf Links">
                <Button variant="destructive" size="sm" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />} aria-label="Delete round at Pebble Beach Golf Links" />
              </Tooltip>
              {/* Illustrative only -- no real button in the app today has
                  a labelled Tooltip; the audit found every visible button
                  label already says enough on its own (see
                  frontend-architecture.md). Shown here so the pattern is
                  demonstrated even though it's currently unused for a
                  labelled button. */}
              <Tooltip content="Deleting removes it permanently -- this can't be undone" placement="bottom">
                <Button variant="destructive" size="sm">
                  Delete
                </Button>
              </Tooltip>
              <p className="text-sm text-text-muted">
                For an icon-only button (the first two above), the tooltip content mirrors its own aria-label -- one source of truth,
                not a second copy that can drift. A labelled button (the third) only gets one when it adds something the visible text
                doesn't already say.
              </p>
            </div>
          </Example>

          <Example label="ToggleGroup -- mutually exclusive choices, native radios styled as segmented buttons (arrow-key nav is free)">
            <ToggleGroup
              name="view-mode"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "list", label: "List" },
                { value: "table", label: "Table" },
              ]}
            />
          </Example>

          <Example label="ToggleGroup -- iconOnly (ghs#134), e.g. ListView's own Table/Grid view switch. The label stays as each option's accessible name -- sr-only, not removed.">
            <ToggleGroup
              name="table-grid-mode"
              value={tableGridMode}
              onChange={setTableGridMode}
              iconOnly
              options={[
                { value: "table", label: "Table", icon: <Table2 aria-hidden="true" className="h-4 w-4" /> },
                { value: "grid", label: "Grid", icon: <LayoutGrid aria-hidden="true" className="h-4 w-4" /> },
              ]}
            />
          </Example>
        </Section>

        <Section id="forms" title="Forms" description="FormField wires label, help/error text and ARIA linkage automatically. Try submitting the demo below empty.">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-text">Demo: new round -- try Save with the name field empty</h3>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <FormField label="Player name" required error={nameError}>
                  <Input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="e.g. Alice Whitfield" />
                </FormField>

                <FormField label="Password" helpText="Only shown here as an Input type example -- not part of round entry.">
                  <Input type="password" autoComplete="new-password" />
                </FormField>

                <FormField label="Strokes (hole 1)" helpText="Numeric keypad on mobile via inputMode.">
                  <Input type="number" inputMode="numeric" min={1} max={20} placeholder="4" />
                </FormField>

                <FormField label="Course">
                  <Select defaultValue="">
                    <option value="" disabled>
                      Select a course
                    </option>
                    <option>Sunningdale (Old)</option>
                    <option>St Andrews (Old)</option>
                    <option>Wentworth (West)</option>
                  </Select>
                </FormField>

                <FormField label="Round type">
                  <RadioGroup
                    name="round-type"
                    value={roundType}
                    onChange={setRoundType}
                    options={[
                      { value: "18", label: "18 holes" },
                      { value: "9", label: "9 holes" },
                    ]}
                  />
                </FormField>

                <FormField label="Preferences">
                  <label className="flex min-h-11 items-center gap-2 py-2 text-sm text-text">
                    <Checkbox checked={nineHole} onChange={(e) => setNineHole(e.target.checked)} />
                    This is a tournament round
                  </label>
                </FormField>

                <FormField label="Notes" helpText="Textarea, e.g. a round's rejection reason (ghs#67).">
                  <Textarea placeholder="Enter a reason…" />
                </FormField>
              </div>
            </CardBody>
            <CardFooter>
              <Button variant="ghost">Cancel</Button>
              <Button onClick={() => setFormSubmitted(true)}>Save</Button>
            </CardFooter>
          </Card>

          <Example label="Disabled state">
            <Input disabled value="Read-only value" readOnly className="max-w-sm" />
          </Example>
        </Section>

        <Section id="feedback" title="Feedback" description="Alert, Toast, Spinner, Skeleton and EmptyState. Toast auto-dismisses (pauses on hover) and announces via role=alert/status.">
          <Example label="Live example -- real /healthz result, rendered through Alert">
            {apiHealth === "checking" && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Spinner size="sm" />
                Checking API status…
              </div>
            )}
            {apiHealth === "ok" && <Alert variant="success">Connected to the GHS API.</Alert>}
            {apiHealth === "error" && <Alert variant="error">Could not reach the GHS API. This is a real request to /healthz, not a mock.</Alert>}
          </Example>

          <Example label="Alert variants">
            <div className="flex flex-col gap-3">
              <Alert variant="success">Round saved.</Alert>
              <Alert variant="error">Failed to submit round: strokes must be a positive number.</Alert>
              <Alert variant="warning">Your session will expire in 5 minutes.</Alert>
              <Alert variant="info">Admin review can take up to 48 hours.</Alert>
            </div>
          </Example>

          <Example label="Toast -- click to trigger a real toast (bottom-centre, auto-dismisses after 5s)">
            <ToastDemo />
          </Example>

          <Example label="Spinner sizes -- reserved for button-loading/indeterminate operations">
            <div className="flex items-center gap-4">
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" />
            </div>
          </Example>

          <Example label="Skeleton -- one primitive, composed to match each layout it stands in for">
            <div className="flex items-center gap-3">
              <Button size="sm" variant="secondary" onClick={() => setShowSkeletons((v) => !v)}>
                {showSkeletons ? "Show loaded content" : "Show skeletons"}
              </Button>
              <p className="text-sm text-text-muted">Respects prefers-reduced-motion (static block instead of a pulse).</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Avatar + text</p>
                </CardHeader>
                <CardBody className="flex items-center gap-3">
                  {showSkeletons ? (
                    <>
                      <Skeleton variant="circle" width={40} height={40} />
                      <div className="flex flex-col gap-2">
                        <Skeleton variant="text" width={120} />
                        <Skeleton variant="text" width={80} />
                      </div>
                    </>
                  ) : (
                    <>
                      <Avatar name="Alice Whitfield" />
                      <div>
                        <p className="text-sm text-text">Alice Whitfield</p>
                        <RoleBadge role="player" />
                      </div>
                    </>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader>
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Card content</p>
                </CardHeader>
                <CardBody className="flex flex-col gap-2">
                  {showSkeletons ? (
                    <>
                      <Skeleton variant="text" width="70%" />
                      <Skeleton variant="text" width="90%" />
                      <Skeleton variant="rect" height={60} />
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-text">Sunningdale (Old)</p>
                      <p className="text-sm text-text-muted">Played 10 Aug 2026</p>
                      <Stat label="Differential" value="14.2" />
                    </>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader>
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Stat</p>
                </CardHeader>
                <CardBody>
                  {showSkeletons ? (
                    <div className="flex flex-col gap-2">
                      <Skeleton variant="text" width={100} height={14} />
                      <Skeleton variant="text" width={60} height={28} />
                    </div>
                  ) : (
                    <Stat label="Handicap Index" value="14.2" />
                  )}
                </CardBody>
              </Card>
            </div>
          </Example>

          <Example label="Empty state -- no round history">
            <EmptyState
              title="No rounds yet"
              description="Rounds you submit for handicap purposes will appear here."
              action={<Button size="sm">Enter a round</Button>}
            />
          </Example>
        </Section>

        <Section id="data-display" title="Data / Display">
          <Example label="Card">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text">Sunningdale (Old)</span>
                  <RoundStatusBadge status="approved" />
                </CardHeader>
                <CardBody className="flex gap-6">
                  <Stat label="Differential" value="14.2" />
                  <Stat label="Played" value="10 Aug 2026" />
                </CardBody>
              </Card>
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text">Wentworth (West)</span>
                  <RoundStatusBadge status="rejected" />
                </CardHeader>
                <CardBody>
                  <Alert variant="error">{REJECTED_ROUND_REASON}</Alert>
                </CardBody>
                <CardFooter>
                  <Button size="sm" variant="secondary">
                    Edit &amp; resubmit
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </Example>

          <Example label="Badge -- generic variants, and a removable pill">
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">Neutral</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="danger">Danger</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="amending">Amending</Badge>
              <Badge variant="info" onRemove={() => {}}>
                Removable
              </Badge>
            </div>
          </Example>

          <Example label="RoundStatusBadge -- every RoundStatus">
            <div className="flex flex-wrap gap-2">
              {ROUND_STATUSES.map((s) => (
                <RoundStatusBadge key={s} status={s} />
              ))}
            </div>
          </Example>

          <Example label="RoleBadge -- every UserRole">
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <RoleBadge key={r} role={r} />
              ))}
            </div>
          </Example>

          <Example label="Handicap statistics (with icon)">
            <div className="flex gap-8">
              <Stat icon={<Flag className="h-4 w-4" />} label="Handicap Index" value="14.2" />
              <Stat label="Low HI" value="12.9" hint="Lowest in the last 12 months" />
            </div>
          </Example>

          <Example label="Table -- desktop-dense round history (horizontal scroll on narrow widths)">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Course</TableHeaderCell>
                  <TableHeaderCell>Tee</TableHeaderCell>
                  <TableHeaderCell>Played</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Differential</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {SAMPLE_ROUNDS.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.course}</TableCell>
                    <TableCell>{r.tee}</TableCell>
                    <TableCell>{r.playedAt}</TableCell>
                    <TableCell>
                      <RoundStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>{r.differential ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Example>

          <Example label="List -- the same data, mobile-friendly">
            <List className="max-w-md">
              {SAMPLE_ROUNDS.map((r) => (
                <ListItem key={r.id} interactive className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text">{r.course}</p>
                    <p className="text-xs text-text-muted">{r.playedAt}</p>
                  </div>
                  <RoundStatusBadge status={r.status} />
                </ListItem>
              ))}
            </List>
          </Example>

          <Example label="ListView -- one data source, table/grid toggle, search + filter + pagination (ghs#103, ghs#137, ghs#138)">
            <ListView
              id="catalogue-rounds"
              items={SAMPLE_ROUNDS}
              getKey={(r) => r.id}
              searchPlaceholder="Search by course…"
              getSearchText={(r) => r.course}
              filters={[{ id: "status", label: "Status", getValue: (r) => r.status, options: ROUND_STATUS_OPTIONS }]}
              // ghs#138: a small pageSize override (real screens use the
              // default of 10) so this catalogue example -- only 5 rows,
              // kept small for readability -- still visibly demonstrates
              // the real Previous/Next control rather than staying
              // permanently inert.
              pageSize={2}
              tableHead={
                <>
                  <TableHeaderCell>Course</TableHeaderCell>
                  <TableHeaderCell>Played</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </>
              }
              renderTableRow={(r) => (
                <>
                  <TableCell>{r.course}</TableCell>
                  <TableCell>{r.playedAt}</TableCell>
                  <TableCell>
                    <RoundStatusBadge status={r.status} />
                  </TableCell>
                </>
              )}
              renderCard={(r) => (
                <Card>
                  <CardBody className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-text">{r.course}</p>
                      <p className="text-xs text-text-muted">{r.playedAt}</p>
                    </div>
                    <RoundStatusBadge status={r.status} />
                  </CardBody>
                </Card>
              )}
              emptyState={<EmptyState title="No rounds yet" />}
            />
          </Example>

          <Example label="Avatar">
            <div className="flex items-center gap-4">
              {SAMPLE_MEMBERS.map((m) => (
                <div key={m.name} className="flex items-center gap-2">
                  <Avatar name={m.name} />
                  <div>
                    <p className="text-sm text-text">{m.name}</p>
                    <RoleBadge role={m.role} />
                  </div>
                </div>
              ))}
            </div>
          </Example>

          <Example label="Disabled action because of permissions">
            <div className="flex items-center gap-3">
              <Button disabled>Approve round</Button>
              <p className="text-sm text-text-muted">
                Only committee members can approve rounds. Inline text, not a tooltip -- always visible without hovering/focusing/tapping
                first, even though Tooltip (ghs#166) exists elsewhere now. See frontend-architecture.md.
              </p>
            </div>
          </Example>

          <Example label="Status feedback icons -- sparingly, never decoration-only">
            <div className="flex flex-wrap items-center gap-6">
              <span className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Approved
              </span>
              <span className="flex items-center gap-1.5 text-sm text-warning">
                <AlertTriangle aria-hidden="true" className="h-4 w-4" /> Pending
              </span>
              <span className="flex items-center gap-1.5 text-sm text-danger">
                <AlertCircle aria-hidden="true" className="h-4 w-4" /> Rejected
              </span>
              <span className="flex items-center gap-1.5 text-sm text-info">
                <Info aria-hidden="true" className="h-4 w-4" /> Info
              </span>
            </div>
          </Example>
        </Section>

        <Section
          id="widgets"
          title="Dashboard Widgets"
          description="ghs#116: the shared Widget shell (title/icon/description/secondary metric/actions, plus loading/error/empty/ready states) -- built from Card/Skeleton/Alert/EmptyState above, not a new visual system. Deliberately not one rigid template: a widget's ready content is just its own children, so a stat-shaped widget and a list-shaped widget can look genuinely different while sharing the same chrome."
        >
          <Example label="Widget primitive -- toggle its state; content is a plain Stat here, but could be anything">
            <div className="flex flex-col gap-4">
              <ToggleGroup
                name="widget-status"
                value={widgetStatus}
                onChange={(value) => setWidgetStatus(value as WidgetStatus)}
                options={[
                  { value: "loading", label: "Loading" },
                  { value: "error", label: "Error" },
                  { value: "empty", label: "Empty" },
                  { value: "ready", label: "Ready" },
                ]}
              />
              <div className="max-w-sm">
                <Widget
                  title="Handicap Index"
                  icon={Flag}
                  description="Your current index"
                  secondaryMetric="Low HI 12.9"
                  status={widgetStatus}
                  errorMessage="Couldn't load your handicap index."
                  emptyState={<EmptyState title="Not yet established" description="Submit at least 3 rounds to get your first handicap index." />}
                >
                  <Stat label="Handicap Index" value="14.2" />
                </Widget>
              </div>
            </div>
          </Example>

          <Example label="RecentRoundsWidget -- a real, shipped widget built on the primitive above; shows the 3 most recent rounds (design doc 9.1), capped even though 3 are given here">
            <div className="max-w-sm">
              <RecentRoundsWidget
                isLoading={false}
                isError={false}
                rounds={SAMPLE_PLAYER_ROUNDS}
                onContinue={() => {}}
                actions={
                  <Button size="sm" icon={<Plus aria-hidden="true" className="h-4 w-4" />}>
                    New round
                  </Button>
                }
              />
            </div>
          </Example>

          <Example label="RecentRoundsWidget -- empty state">
            <div className="max-w-sm">
              <RecentRoundsWidget isLoading={false} isError={false} rounds={[]} onContinue={() => {}} />
            </div>
          </Example>
        </Section>

        <Section id="overlays" title="Overlays" description="One Modal, built on native <dialog>. Bottom sheet on mobile widths, centred dialog on desktop.">
          <Example label="Basic modal">
            {/* self-start: a lone Button as a flex-col child otherwise
                stretches edge-to-edge (Example's flex-col default cross-axis
                stretch, not Button's own behaviour) -- found by real browser
                verification. */}
            <Button className="self-start" onClick={() => setInfoModalOpen(true)}>
              Open modal
            </Button>
            <Modal open={infoModalOpen} onClose={() => setInfoModalOpen(false)} title="Round details">
              <p className="text-sm text-text">Sunningdale (Old), played 10 Aug 2026. Approved, differential 14.2.</p>
            </Modal>
          </Example>

          <Example label="Confirmation dialog pattern">
            <Button className="self-start" variant="destructive" onClick={() => setConfirmOpen(true)}>
              Reject round
            </Button>
            <Modal
              open={confirmOpen}
              onClose={() => setConfirmOpen(false)}
              title="Reject this round?"
              footer={
                <>
                  <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="destructive" onClick={() => setConfirmOpen(false)}>
                    Reject
                  </Button>
                </>
              }
            >
              <p className="text-sm text-text">
                The player will be notified and asked to amend and resubmit. This is a composition of Modal with a footer, not a
                separate ConfirmDialog component.
              </p>
            </Modal>
          </Example>
        </Section>

        <Section
          id="navigation"
          title="Navigation"
          description="AppHeader + NavItem + Logo only -- Sidebar/Breadcrumb/Tabs deferred until the admin/player information architecture is decided."
        >
          <p className="text-sm text-text-muted">
            This page's own header above is a live example: <code className="rounded bg-border px-1 py-0.5 text-xs">Logo</code> as the
            brand slot, <code className="rounded bg-border px-1 py-0.5 text-xs">NavItem</code> for each link (icon + label + active
            state), an actions slot (live API status badge), and <code className="rounded bg-border px-1 py-0.5 text-xs">ThemeToggle</code>.
          </p>
        </Section>
      </main>
    </div>
  );
}
