# GHS Frontend Architecture

GHS-specific frontend conventions, established by the component library / design system foundation (`ghs#78`). This is a local, application-level convention document, not a `socx-platform` ADR -- if these conventions prove out across multiple SOCX applications, the relevant subset can be promoted to a Platform ADR later. Not required to re-litigate this document; it records decisions already approved, and should be kept in sync as the frontend evolves.

## Visual design direction

Clean, professional, governance/clubhouse-oriented -- GHS produces official handicap indices, so the UI should read closer to "committee" than "sports app." Deliberately distinct from RMS's own frontend (indigo primary, no design tokens, one shared component across 14 pages) rather than a visual reskin of it -- see "Component layering" and "RMS precedent" below.

## Semantic colour system

Tailwind's stock palette, aliased to intent via a `@theme` block (`apps/web/src/styles/theme.css`) rather than new colours:

| Token | Colour | Used for |
|---|---|---|
| `primary` | `blue-600`/`700` | Buttons, links, focus rings, active nav |
| `success` | `green-600` | Approved rounds, success banners |
| `warning` | `amber-600` | Pending rounds, warning banners |
| `danger` | `red-600`/`700` | Rejected rounds, destructive actions, errors |
| `info` | `blue-500` | Informational banners (shares the primary family deliberately -- both read as neutral/non-alarming) |
| `amending` | `violet-600` | Round sent back for player resubmission |
| neutral | `slate` | Draft, disabled, muted text/borders (no alias -- slate's own scale is used directly) |

**Why primary (blue) and success (green) are kept distinct**: green is reserved unambiguously for "Approved"/success semantics, a governance-critical, frequently-shown state. Reusing it as the primary action colour would compete with that meaning. Blue also differs enough from RMS's indigo that the two sibling SOCX apps don't read as reskins of each other.

**RoundStatus colour semantics** (`components/domain/RoundStatusBadge.tsx`):

- `draft` -> neutral/slate (not yet submitted)
- `pending` -> warning/amber (awaiting committee review)
- `approved` -> success/green
- `rejected` -> danger/red
- `amending` -> **violet**, deliberately distinct from `pending`. Different urgency and different owner: `pending` means waiting on the committee; `amending` means waiting on the player to resubmit. Reusing amber for both would blur that distinction on a player's own round list.

## Typography

System font stack (`font-sans`) -- no webfont, no licensing/perf cost, appropriate for a utility application. Tailwind's stock type scale, used as-is (no invented sizes):

- Page heading: `text-3xl font-semibold` (also `text-2xl` for tighter contexts, e.g. the catalogue's own section headings)
- Section heading: `text-lg font-semibold`
- Body: `text-sm`/`text-base`
- Muted/help text: `text-sm text-slate-500`
- Form label: `text-sm font-medium`

## Spacing

Tailwind's default 4px scale throughout -- no arbitrary values. Standard container: `max-w-7xl px-4 sm:px-6 lg:px-8` (reused from RMS's own convention here, which is fine as-is).

## Radius / elevation

Two-tier radius, not one: `rounded-md` for interactive controls (buttons, inputs, selects), `rounded-lg` for surfaces/containers (cards, modals, tables). Elevation is minimal by design: `shadow-sm` for cards/dropdowns, `shadow-lg`/`shadow-xl` reserved for modals only. Separation is mostly via `border-slate-200`, not heavy shadows -- consistent rather than visually elaborate.

## Focus conventions

One convention everywhere, not styled per component:

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600
```

## Touch targets

44px minimum on default-size interactive controls (`Button`'s `md` size is `h-11`, the default; `Input`/`Select` are `h-11`). `Button`'s `sm` size (`h-9`, 36px) is intentionally smaller and reserved for dense desktop-only contexts (e.g. inline table row actions) -- never the only way to reach a primary action on a mobile flow.

Checkbox/radio glyphs stay a normal visual size (20px, `h-5 w-5`) rather than being forced to look like oversized 44px dots -- WCAG 2.5.5 allows the *tappable target* to include adjacent label text, so `Checkbox`/`RadioGroup` usage wraps the control and its label in a `min-h-11` row instead of enlarging the glyph itself.

## Component layering

Two layers, kept deliberately separate:

- **Generic primitives** (`apps/web/src/components/*.tsx`): zero GHS domain knowledge. `Badge` just renders a variant; it has no idea what "amending" means.
- **Domain compositions** (`apps/web/src/components/domain/*.tsx`): thin wrappers carrying GHS-specific mapping -- `RoundStatusBadge` (status -> label/variant), `RoleBadge` (role -> label/variant). These consume the generic layer rather than duplicating its styling.

This separation exists so the generic layer stays reusable if GHS's domain vocabulary changes, and so a reviewer can tell at a glance whether a given component encodes business rules or not.

## Mobile-first / desktop-dense

- `Table` wraps in a horizontal-scroll container by default -- a fixed multi-column table is unusable on a phone otherwise. Prefer `List` for the same data at narrow widths (round history), reserving `Table` for the data-dense desktop admin case.
- `Modal` is one component, responsive by breakpoint: bottom-anchored, full-width sheet below `sm:`, centred dialog at `sm:` and above. No separate mobile/desktop modal implementations.
- Admin density comes from responsive Tailwind breakpoints (more columns/tighter padding at `lg:`), not a JS-driven "density mode" -- avoids a second prop-driven state system for what breakpoints already solve.
- No interaction anywhere depends on hover (this is why Tooltip is excluded -- see below) -- directly serves round entry on a phone.

## Accessibility expectations (part of the component contract, not a later pass)

- Labels are associated with controls via `FormField`'s automatic `htmlFor`/`id` wiring, not ad hoc per screen.
- Help/error text is linked via `aria-describedby`; error text uses `role="alert"`.
- Required fields are communicated via sr-only text ("(required)"), not colour/symbol alone -- the visible `*` is `aria-hidden`.
- Icon-only buttons require `aria-label` (`Button` logs a dev-time console error if one renders with neither visible children nor an `aria-label`).
- `Alert` variants are announced textually (an sr-only "Success:"/"Error:"/etc. prefix), not communicated by colour alone.
- Disabled-because-of-permissions actions get adjacent static help text, not a tooltip (tooltips are hover-dependent, which fails on touch -- see "Deferred: Tooltip" below).

## The native `<dialog>` decision

`Modal` is built on the native HTML `<dialog>` element via `showModal()`, not a headless-UI dependency (Radix, Headless UI). `showModal()` gives, for free, in every evergreen browser: a real focus trap, Escape-to-close, an inert background (verified directly: clicking behind an open dialog does not activate it), and focus restored to the trigger on close. This was the entire justification for reaching for a dependency here, so none was added.

**A real gotcha found during implementation, worth recording**: Chromium's UA stylesheet sets `inset: 0` on `dialog:modal`. `Modal`'s mobile styling only overrides `left`/`right` (`inset-x-0`) and `bottom` (`bottom-0`) -- without an explicit `top-auto`, the inherited `top: 0` combines with `bottom: 0` and `height: auto` to anchor the dialog to the *top* of the viewport instead of the bottom. Found by real browser measurement (`getComputedStyle`), not assumed from the class list. Fixed by adding `top-auto` explicitly alongside `bottom-0`.

jsdom does not implement `<dialog>`'s `showModal()`/`close()` at all (confirmed directly, not assumed) -- `src/test-setup.ts` polyfills just enough (`open` attribute toggling, a `close` event) for Vitest/RTL tests to exercise `Modal`'s own wiring. It does **not** attempt to replicate real focus-trap or Escape-key dispatch; those are verified against a real running browser instead (this issue's PR notes), not asserted in the jsdom test suite.

## Deferred: Sidebar, Breadcrumb, Tabs

Not built in this issue. The admin/player information architecture (how many sections, what nests under what) hasn't been decided yet -- building nav structure ahead of real screens would be designing for a hypothetical. `AppHeader` alone covers what's needed until a real multi-section screen requires more.

## Deferred: Toast

Not built in this issue. `Alert` and the other approved feedback components cover the catalogue's demonstrated feedback states. When a real product screen establishes a concrete requirement for transient, non-blocking notification (e.g. autosave confirmation, an inline approve/reject action from a list), that becomes its own separate piece of work, deciding the implementation then -- not speculative infrastructure built ahead of a real need.

## Deferred: Tooltip

Excluded rather than built. The one clear candidate use case ("disabled action because of permissions") is served by static inline help text next to the control instead. A tooltip is inherently hover-dependent, which directly conflicts with this project's "interactions should not depend on hover" principle for mobile/touch use.

## Excluded: Skeleton loading placeholders

GHS is single-club scale with fast queries (established in earlier backend phases). A centred `Spinner` with accompanying text is sufficient for this app's realistic latency profile; a skeleton component here would be cosmetic, not solving a real problem.

## RMS precedent

**Kept**: `rounded-md` + `shadow-sm` + `ring`-based borders (proven, professional, no reason to reinvent), the page-container spacing convention, `focus-visible` discipline as a goal (RMS is inconsistent about it across pages; GHS is consistent from the start via one shared convention).

**Explicitly not carried forward**: RMS's near-total lack of componentisation (one shared component, `ApiStatusBadge`, across 14 pages -- everything else copy-pasted Tailwind-in-JSX per page). This issue exists specifically to avoid that outcome for GHS. Also not carried forward: RMS's per-page inline `STATUS_STYLES` object pattern (superseded here by `RoundStatusBadge`/`RoleBadge`), indigo as the primary colour (see rationale above), Tailwind 3 classic config / JS-not-TS (GHS is already committed to Tailwind v4 CSS-first + strict TS from the scaffold, `ghs#62`).

## Dependencies

No new runtime dependencies were introduced by this issue -- `cn()` is a ~3-line local classname-join helper (no `clsx`/`cva`/`tailwind-merge`); `Modal` uses native `<dialog>` (no Radix/Headless UI); feedback uses `Alert` only (no toast library); no `react-router-dom`, `react-hook-form`, `zod`, TanStack Query, or `axios` -- none of those have a concrete requirement yet (routing/forms/data-fetching decisions belong to the screens that actually need them, e.g. `#63`, `#64`).

`@testing-library/user-event` was added as a **devDependency only** (no production/runtime impact) -- the standard RTL companion for realistic click/keyboard interaction, needed to test `Modal`'s behaviour properly. This is a different kind of dependency from the runtime/UI libraries this issue otherwise avoided.
