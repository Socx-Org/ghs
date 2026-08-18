import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Alert,
  AppHeader,
  Avatar,
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
  Modal,
  RadioGroup,
  RoleBadge,
  RoundStatusBadge,
  Select,
  Spinner,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./components";
import type { BadgeVariant } from "./components";
import type { RoundStatus, UserRole } from "./types/domain";

// ghs#78: the living visual reference for GHS. Every component rendered
// here is the actual component apps/web/src/components exports -- nothing
// on this page is a one-off styled to look similar; subsequent screens
// (starting with Login/MFA, #64) import from the same components/ module.
// Dev-only -- see App.tsx's `MODE === "development"` gate (not
// import.meta.env.DEV, which is also true under Vitest's own test mode).

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

const REJECTED_ROUND_REASON =
  "9th hole score exceeds the net double bogey cap for your course handicap -- please recheck the strokes entered for that hole.";

const SAMPLE_MEMBERS: Array<{ name: string; role: UserRole }> = [
  { name: "Alice Whitfield", role: "player" },
  { name: "Ben Okafor", role: "admin" },
  { name: "Carys Newton", role: "super_admin" },
];

const SEMANTIC_SWATCHES: Array<{ name: string; variant: BadgeVariant; swatch: string; note: string }> = [
  { name: "Primary", variant: "info", swatch: "bg-primary", note: "Buttons, links, focus rings, active nav" },
  { name: "Success", variant: "success", swatch: "bg-success", note: "Approved rounds, success banners" },
  { name: "Warning", variant: "warning", swatch: "bg-warning", note: "Pending rounds, warning banners" },
  { name: "Danger", variant: "danger", swatch: "bg-danger", note: "Rejected rounds, destructive actions, errors" },
  { name: "Amending", variant: "amending", swatch: "bg-amending", note: "Round sent back for player resubmission" },
  { name: "Neutral", variant: "neutral", swatch: "bg-slate-500", note: "Draft, disabled, muted text" },
];

function SectionHeading({ headingId, title, description }: { headingId: string; title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h2 id={headingId} className="text-2xl font-semibold text-slate-900 scroll-mt-20">
        {title}
      </h2>
      {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
    </div>
  );
}

function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
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
    <section id={id} aria-labelledby={headingId} className="border-b border-slate-200 py-12 first:pt-0 last:border-b-0">
      <SectionHeading headingId={headingId} title={title} description={description} />
      <div className="flex flex-col gap-8">{children}</div>
    </section>
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppHeader
        title="GHS Components"
        nav={
          <>
            <a href="#foundations" className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-primary">
              Foundations
            </a>
            <a href="#actions" className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-primary">
              Actions
            </a>
            <a href="#forms" className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-primary">
              Forms
            </a>
            <a href="#feedback" className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-primary">
              Feedback
            </a>
            <a href="#data-display" className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-primary">
              Data/Display
            </a>
            <a href="#overlays" className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-primary">
              Overlays
            </a>
            <a href="#navigation" className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-primary">
              Navigation
            </a>
          </>
        }
        actions={<Badge variant={apiHealth === "ok" ? "success" : apiHealth === "error" ? "danger" : "neutral"}>API: {apiHealth}</Badge>}
      />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Section
          id="foundations"
          title="Foundations"
          description="Colour, type, spacing, radius, elevation and focus conventions. Everything below is built from these, not invented per component."
        >
          <Example label="Semantic colour system">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {SEMANTIC_SWATCHES.map((s) => (
                <div key={s.name} className="flex flex-col gap-2">
                  <div className={`h-12 w-full rounded-md ${s.swatch}`} aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-900">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.note}</p>
                </div>
              ))}
            </div>
          </Example>

          <Example label="Typography hierarchy">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-semibold text-slate-900">Page heading -- text-3xl font-semibold</h1>
              <h2 className="text-lg font-semibold text-slate-900">Section heading -- text-lg font-semibold</h2>
              <p className="text-base text-slate-700">Body text -- text-base, default paragraph copy.</p>
              <p className="text-sm text-slate-500">Muted / help text -- text-sm text-slate-500, used for hints and captions.</p>
              <a href="#foundations" className="text-sm font-medium text-primary hover:underline">
                Link -- text-primary, underline on hover
              </a>
            </div>
          </Example>

          <Example label="Spacing scale (Tailwind default, no arbitrary values)">
            <div className="flex flex-wrap items-end gap-4">
              {[1, 2, 3, 4, 6, 8].map((n) => (
                <div key={n} className="flex flex-col items-center gap-1">
                  <div className={`w-8 bg-primary/20`} style={{ height: `${n * 4}px` }} aria-hidden="true" />
                  <span className="text-xs text-slate-500">{n * 4}px</span>
                </div>
              ))}
            </div>
          </Example>

          <Example label="Radius -- rounded-md (controls) vs rounded-lg (surfaces)">
            <div className="flex gap-4">
              <div className="h-16 w-24 rounded-md border border-slate-300 bg-white" />
              <div className="h-16 w-24 rounded-lg border border-slate-300 bg-white" />
            </div>
          </Example>

          <Example label="Elevation -- shadow-sm (default) vs shadow-lg (modals only)">
            <div className="flex gap-6">
              <div className="h-16 w-24 rounded-lg bg-white shadow-sm" />
              <div className="h-16 w-24 rounded-lg bg-white shadow-lg" />
            </div>
          </Example>

          <Example label="Focus behaviour -- Tab through these to see the ring">
            <div className="flex flex-wrap gap-3">
              <Button size="sm">First</Button>
              <Button size="sm" variant="secondary">
                Second
              </Button>
              <a href="#foundations" className="rounded-md px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600">
                Third (link)
              </a>
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

          <Example label="Icon-only (requires aria-label -- no visible text)">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="ghost" aria-label="Close">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </Button>
              <p className="text-sm text-slate-500">Compact affordances (e.g. remove a hole-score row) get an accessible name via aria-label, not visible text.</p>
            </div>
          </Example>
        </Section>

        <Section id="forms" title="Forms" description="FormField wires label, help/error text and ARIA linkage automatically. Try submitting the demo below empty.">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">Demo: new round -- try Save with the name field empty</h3>
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
                  <label className="flex min-h-11 items-center gap-2 py-2 text-sm text-slate-900">
                    <Checkbox checked={nineHole} onChange={(e) => setNineHole(e.target.checked)} />
                    This is a tournament round
                  </label>
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

        <Section id="feedback" title="Feedback" description="Alert covers success/error/warning/info. No Toast in this issue -- see frontend-architecture.md for why.">
          <Example label="Live example -- real /healthz result, rendered through Alert">
            {apiHealth === "checking" && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Spinner size="sm" />
                Checking API status…
              </div>
            )}
            {apiHealth === "ok" && <Alert variant="success">Connected to the GHS API.</Alert>}
            {apiHealth === "error" && <Alert variant="error">Could not reach the GHS API. This is a real request to /healthz, not a mock.</Alert>}
          </Example>

          <Example label="Variants">
            <div className="flex flex-col gap-3">
              <Alert variant="success">Round saved.</Alert>
              <Alert variant="error">Failed to submit round: strokes must be a positive number.</Alert>
              <Alert variant="warning">Your session will expire in 5 minutes.</Alert>
              <Alert variant="info">Admin review can take up to 48 hours.</Alert>
            </div>
          </Example>

          <Example label="Spinner sizes">
            <div className="flex items-center gap-4">
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" />
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
                  <span className="text-sm font-semibold text-slate-900">Sunningdale (Old)</span>
                  <RoundStatusBadge status="approved" />
                </CardHeader>
                <CardBody className="flex gap-6">
                  <Stat label="Differential" value="14.2" />
                  <Stat label="Played" value="10 Aug 2026" />
                </CardBody>
              </Card>
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">Wentworth (West)</span>
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

          <Example label="Badge -- generic variants">
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">Neutral</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="danger">Danger</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="amending">Amending</Badge>
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

          <Example label="Handicap statistics">
            <div className="flex gap-8">
              <Stat label="Handicap Index" value="14.2" />
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
                    <p className="text-sm font-medium text-slate-900">{r.course}</p>
                    <p className="text-xs text-slate-500">{r.playedAt}</p>
                  </div>
                  <RoundStatusBadge status={r.status} />
                </ListItem>
              ))}
            </List>
          </Example>

          <Example label="Avatar">
            <div className="flex items-center gap-4">
              {SAMPLE_MEMBERS.map((m) => (
                <div key={m.name} className="flex items-center gap-2">
                  <Avatar name={m.name} />
                  <div>
                    <p className="text-sm text-slate-900">{m.name}</p>
                    <RoleBadge role={m.role} />
                  </div>
                </div>
              ))}
            </div>
          </Example>

          <Example label="Disabled action because of permissions">
            <div className="flex items-center gap-3">
              <Button disabled>Approve round</Button>
              <p className="text-sm text-slate-500">Only committee members can approve rounds. Inline text, not a hover-only tooltip -- see frontend-architecture.md.</p>
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
              <p className="text-sm text-slate-700">
                Sunningdale (Old), played 10 Aug 2026. Approved, differential 14.2.
              </p>
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
              <p className="text-sm text-slate-700">
                The player will be notified and asked to amend and resubmit. This is a composition of Modal with a footer, not a
                separate ConfirmDialog component.
              </p>
            </Modal>
          </Example>
        </Section>

        <Section id="navigation" title="Navigation" description="AppHeader only -- Sidebar/Breadcrumb/Tabs deferred until the admin/player information architecture is decided.">
          <p className="text-sm text-slate-600">
            This page's own header above is a live <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">AppHeader</code> example:
            title, a wrapping/scrolling nav, and an actions slot (the live API status badge).
          </p>
        </Section>
      </main>
    </div>
  );
}
