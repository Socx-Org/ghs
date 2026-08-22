# GHS Frontend Architecture

GHS-specific frontend conventions, established by the component library / design system foundation (`ghs#78`, revised and substantially extended by `ghs#82`: emerald rebrand, light/dark theme, logo, iconography, skeleton loading, Toast, ToggleGroup), extended into the API/auth layer by `ghs#63`, and into real routing and the first product screen by `ghs#64` (Login/MFA). This is a local, application-level convention document, not a `socx-platform` ADR -- if these conventions prove out across multiple SOCX applications, the relevant subset can be promoted to a Platform ADR later. Not required to re-litigate this document; it records decisions already approved, and should be kept in sync as the frontend evolves.

## Routing & the first real screen (`ghs#64`)

**`react-router-dom` introduced here, not earlier.** `#63` deliberately deferred this decision ("whichever issue first needs real multi-screen navigation") rather than guessing ahead of a concrete need -- a real login screen needing somewhere to redirect *to* on success and *from* when unauthenticated is that concrete need. `AppRoutes.tsx` is kept separate from `App.tsx` specifically so tests can drive it inside a `MemoryRouter` (controlling the initial route directly) instead of the real `BrowserRouter`, which reads from `window.location`.

**Two route guards, two different jobs.** `components/domain/RequireRole.tsx` (from `#63`) stayed router-agnostic -- it gates *rendering*, not navigation, and still doesn't import `react-router-dom`. `routes/RequireAuth.tsx` and `routes/RedirectIfAuthenticated.tsx` are the actual navigation guards this issue adds, both thin (`useAuth()` + `<Navigate>`/`<Outlet>`), living in their own `routes/` directory since they're tied to the router in a way `RequireRole` deliberately isn't.

**The dev-catalogue/production-placeholder split in `App.tsx` is retired, not extended.** `ghs#78`'s own comment already named this moment: "once real application routing is introduced, the catalogue can become a development-only `/components` route." It's now `/dev/components`, gated the same way the old split was (`MODE === "development"`, not `import.meta.env.DEV` -- still true under Vitest's test mode, confirmed directly in the original scaffold). The old scaffold's live `/healthz` check is retired along with it, not carried forward into the new placeholder -- a real, working login is a stronger end-to-end proof that the frontend can reach the backend than a liveness ping ever was.

**`DashboardPlaceholder` is deliberately real, not a stub.** Player Dashboard is its own later issue (`#65`), but `RequireAuth` needs a genuine authenticated destination to send the user to, and logout needs something real to exercise -- both matter for this issue's own acceptance criteria (real end-to-end login), so the placeholder does real work (`useAuth()`, a working sign-out button) rather than rendering static text.

### Split-screen login layout

Structurally adapted from Tailwind UI's "Split screen" sign-in block (approved direction: match its layout, not its content) -- a form panel plus a full-height visual panel. Several elements from that reference were deliberately dropped, because none of them are real for GHS yet:

- **"Or continue with Google/GitHub"** -- no OAuth provider exists anywhere in the backend (verified directly against `apps/api/src/interface/http/routes/auth.ts`). Fake buttons for a login method that doesn't exist would be exactly the kind of fabricated UI this project avoids.
- **"Forgot password?"** -- no password-reset UI exists; it's explicit Wave 2 (`#64`'s own non-scope), not built yet. A link to a route that doesn't exist isn't better than no link.
- **"Remember me"** -- the refresh token already persists the session for 30 days regardless of any checkbox (`apps/api/src/config.ts`'s `jwtRefreshExpiresInSeconds`); there's no backend concept of a shorter "non-remembered" session to opt out of. A checkbox with no real effect would be decorative, not functional.
- **The marketing "Start a free trial" copy** -- GHS has no such flow.

**The right-hand panel is a solid brand-colour gradient with a short tagline, not a stock photo.** No photography asset exists anywhere in this app, and sourcing an external image for this one placement would be a real licensing/provenance question worth raising explicitly rather than quietly deciding by embedding a random web image. The `Logo` mark itself isn't repeated on this panel -- its circle/S colours are token-driven (`fill-text`/`fill-surface`) for correct contrast against `surface`/`bg-page`, not tuned for an arbitrary solid brand-colour background, and duplicating it there wasn't worth extending the component's API for a single decorative placement.

**A real bug found in this issue's own visual verification, worth recording:** the login page's outer container had no explicit background class. In light theme this was invisible (white text container against the browser's own default white), but in dark theme it left the panel white while the theme-aware text inside correctly switched to light colours -- rendering the entire left panel illegible. Caught by actually toggling dark mode and looking at a screenshot, not by trusting the component tokens to "just work" without checking. Fixed with an explicit `bg-surface` on the page's root container.

### Real end-to-end verification, including MFA

Login was verified against the real running API with real test users seeded directly into the database (`argon2.hash()`, matching `apps/api/src/lib/password.ts` exactly) -- not just mocked. The MFA path was verified with a genuinely MFA-enrolled user: real enrollment via the actual `/auth/mfa/enroll` and `/auth/mfa/enroll/confirm` endpoints, using `otplib`'s real TOTP generation (the same library the backend itself uses) to produce a real, currently-valid 6-digit code at verification time -- not a hardcoded fixture code, which would have gone stale immediately (TOTP codes are time-windowed, ~30s).

## Admin account creation (`ghs#86`)

**Pulled forward ahead of Player Dashboard (`#65`)** -- until this existed, the only way to create a real account was hand-crafted SQL or raw HTTP calls, not a workflow a real club administrator has access to. Self-registration, account-activation UI, and password-recovery UI remain genuine Wave 2, unchanged.

**A second, router-specific role guard: `routes/RequireAdmin.tsx`.** Deliberately nested *inside* `RequireAuth` (`<Route element={<RequireAuth />}><Route path="/" .../><Route element={<RequireAdmin />}><Route path="/admin/users/new" .../></Route></Route>`), not a standalone combined auth+role guard -- by the time it runs, `RequireAuth` has already guaranteed the user is authenticated, so `RequireAdmin` only adds the role check on top instead of duplicating the auth check. A non-admin authenticated user is sent to `/`, not `/login` -- they have a valid session, they just can't see this particular screen, which is a different case from `RequireAuth`'s "you have no session at all."

**Role elevation is restricted client-side too, not just left to the server's 403.** Only a `super_admin` caller sees the Role field at all; a plain `admin` has exactly one legal choice (`player`, verified against `apps/api/src/interface/http/routes/admin-users.ts`'s own restriction), so a disabled dropdown showing that single option would be noise, not real affordance. The submitted `role` is still forced to `"player"` in code for a non-elevating caller regardless of form state, as defence in depth -- the server's own 403 remains the actual authority.

**`createUser()` (`lib/api.ts`) is routed through `api`, not `bootstrapClient`.** Unlike login/verifyMfa/refresh/logout (the auth bootstrap flow itself, `#63`), this is an ordinary authenticated feature call: it needs the bearer token `api`'s request interceptor attaches, and its response interceptor already normalises any failure into an `ApiError` (including a 401 -> refresh-and-retry). No extra try/catch wrapping needed at the call site, unlike `login`/`verifyMfa`, which use the unauthenticated `bootstrapClient` and must do that wrapping themselves.

**Another real dark-mode bug found via visual verification, same pattern as `#64`'s login-page bug:** the page's root container had no explicit background class -- invisible in light theme, but left the page white with illegible dark-on-white text once dark mode was toggled and actually screenshotted. Fixed with an explicit `bg-bg-page` on the root container (matching `DashboardPlaceholder`, the other authenticated-area screen, rather than `LoginPage`'s `bg-surface` -- this page has no split visual panel to contrast against).

**Verified end-to-end against the real running API and database**, not just mocked: a real `super_admin` and a real plain `admin` seeded directly into Postgres (`argon2.hash()`, matching the backend exactly), driven through the actual browser login -> Admin nav -> create-account flow twice -- once as `super_admin` creating a `player` with activation deferred (confirmed `status = pending_verification`), once as plain `admin` with "Activate immediately" checked (confirmed `status = active`, `email_verified_at` set, and the Role field absent from the form entirely for this caller).

## Player dashboard (`ghs#65`) and `GET /players/me` (`ghs#89`)

**A real backend gap found while scoping this issue, fixed first.** A logged-in player had no way to discover their own player id -- every player-scoped endpoint requires one in the URL, and the JWT carries no `playerId` claim. `GET /players/me` (`#89`, its own small `apps/api` PR ahead of this one) resolves it via the route authorizer's existing internal `findByUserId` lookup, newly exposed over HTTP. Deliberately not solved by adding `playerId` to the JWT or login response instead -- that would couple the auth layer to player-profile data (`IAM-020` keeps `users`/`players` strictly separated) and go stale across a token refresh if a player's linkage ever changed.

**First real use of TanStack Query, per the issue's own approved choice** -- not `useEffect`+`useState`. One `QueryClient` at the app root (`App.tsx`, wrapping everything, same level as `ToastProvider`/`BrowserRouter`), not per-screen, so a query started on one screen stays cached across navigation. Real server state (`GET /players/me`, `GET /players/:playerId/rounds`) is exactly what it's for, distinct from local UI state (`useState`, still used everywhere else in this app).

**`/` now dispatches on role, not a single fixed screen.** `AppRoutes.tsx`'s `HomeRoute` renders `PlayerDashboardPage` for `role === "player"` and falls back to the existing `DashboardPlaceholder` for `admin`/`super_admin` -- there's no real admin dashboard yet (future scope, not invented here), and `DashboardPlaceholder`'s own Admin-nav entry point is still all an admin needs today.

**The null-handicap-index empty state is a real acceptance criterion** (`#65`: "an eligibility-appropriate empty/insufficient-holes state when `handicapIndex` is null"), not a generic "no data" placeholder -- the copy names the real WHS minimum (3 rounds / 54 holes, `apps/api`'s own eligibility rule) rather than a vague "check back later."

**Verified end-to-end against the real running API and database**: a real player seeded directly into Postgres (no rounds yet), driven through the actual browser login -> dashboard flow -- confirmed the real `null`/empty states render correctly from genuine `GET /players/me`/`GET /players/:playerId/rounds` responses, in both light and dark theme. The "recent rounds with real statuses" rendering path (badges, date formatting) is covered by `PlayerDashboardPage.test.tsx` against exact-shape mocked data instead of a second live round -- creating a real approved round requires a full club/course/tee-configuration chain this issue has no other reason to seed.

## Round creation & incremental hole entry (`ghs#94`)

**Two new player-facing routes, `/rounds/new` and `/rounds/:id`.** The first creates the round (`POST /rounds`, always lands in `draft`) and hands off; the second is both the incremental hole-entry screen *and* the resume-an-in-progress-round screen -- same route, same data, since a `draft`/`rejected`/`amending` round and a freshly-created one are the identical case from this screen's point of view. `pending`/`approved` rounds get a minimal read-only state instead of the entry form -- viewing a submitted round's actual result is a later epic item, not invented here.

**One hole, one independent `react-hook-form` instance (`components/domain/HoleEntryCard.tsx`), not one giant form for the whole round.** This is the epic's own acceptance criterion made literal -- "incremental... explicit save states, not atomic save-everything-at-the-end." Each card always represents the hole's *complete* current state (seeded from its existing score when one exists), so every save sends every field; there's no partial-field tracking to manage client-side. A blank optional field on save means "no value in this form," which the real API (`#92`/`#93`) treats as "leave whatever's already recorded alone" -- the backend has no explicit-clear capability for these fields, so this UI doesn't pretend to offer one either.

**First real use of TanStack Query *mutations* in this app** (queries only so far, `#65`/`#89`) -- per-hole save and round submit both invalidate the round query on success rather than hand-rolling optimistic local state, so the UI is always showing what the server actually persisted, not a client-side guess. Demonstrated concretely by the correction flow: saving hole 1 with `strokes=6, putts=3, gir=true`, then re-saving with only `strokes=4` (details collapsed, not re-touched), survives a real page reload with `putts`/`gir` intact -- exercising `#93`'s upsert-preserve fix through the actual UI, not just its own backend tests.

**`useWatch`, not the `watch()` returned from `useForm()`, for the two fields (`courseId` in `NewRoundPage`, `fairwayResult` in `HoleEntryCard`) whose current value drives other UI.** `watch()` is flagged by this project's React Compiler lint config as an "incompatible library" API (returns a function that can't be memoized safely); `useWatch({control, name})` is react-hook-form's own dedicated hook for exactly this and doesn't trigger the warning. First real use of either in this app -- no prior form here needed to react to its own field values while rendering.

**A real TypeScript gap `tsc --noEmit` didn't catch but `npm run build`'s `tsc -b` did**, twice: (1) `RoundEntryPage.tsx` destructured `roundQuery.data`/`teeQuery.data` into plain `const`s ahead of the loading/error branches -- TS can't correlate a query object's `isPending`/`isError` with a separately-bound variable's definedness the way it can with the query object's own fields directly, so an explicit `!round || !teeConfiguration` guard was needed purely for narrowing (a real branch, but unreachable in practice -- every real state is already covered above it). (2) `HoleEntryCard`'s zod schema uses `z.preprocess` (turning a blank/NaN numeric input into a clean "Enter a stroke count" message instead of zod's generic NaN-rejection text) for `strokes`/`putts`/`penalties`, which makes the schema's input type diverge from its output type -- `useForm` needed its full three-generic form (`useForm<z.input<typeof schema>, unknown, HoleFormValues>`) to satisfy both `register`'s raw-value side and `handleSubmit`'s validated-value side. **Lesson: `npm run build` is part of this project's real verification sequence, not `tsc --noEmit` alone** -- confirmed here, not assumed.

**Verified end-to-end against the real running API and database**: a real course (2 real holes, not the degenerate `holes: []` fixture some backend tests use) and a real player, driven through the actual browser -- create round -> enter hole 1 (strokes, putts, GIR) -> save -> reload -> correct strokes only -> reload again -> confirm putts/GIR survived -> complete hole 2 -> submit -> land back on the dashboard showing the round as `Pending` with no `Continue` action -- cross-checked directly against Postgres (`rounds.status = 'pending'`, `hole_scores` rows matching exactly) at the end, not just the UI's own claim.

**`DashboardPlaceholder` gained a real `AppHeader`**, with an "Admin" nav item that was a genuine destination (`navigate("/admin/users/new")`) rather than the non-functional stub the catalogue demo shows -- rendered only for `admin`/`super_admin` users, mirroring the same role check `RequireAdmin` enforces at the route level. Superseded by `ghs#96` directly below, which replaced this page-level header with the shared `AppShell`/`Sidebar` -- `DashboardPlaceholder` itself carries no header or nav item of any kind any more (see its own comment). The `/admin/users/new` destination the Sidebar took over remained a standalone "Create Account" nav entry until `ghs#142` later removed it too, once `AdminAccountsPage` grew its own "Create account" button to the same route.

## Application shell (`ghs#96`)

**One `AppShell` applied once at the route tree, not per-page chrome.** `AppRoutes.tsx` nests every authenticated route (`/`, `/rounds/new`, `/rounds/:id`, `/admin/users/new`) inside a single `<Route element={<AppShell />}>` layout. `PlayerDashboardPage`, `DashboardPlaceholder`, `AdminCreateUserPage`, `NewRoundPage`, and `RoundEntryPage` each lost their own duplicated header/logo/sign-out code as a direct result -- that chrome now exists exactly once. `LoginPage` deliberately stays outside the shell; it has its own unauthenticated split-panel layout with nothing in common with the authenticated shell. The dev-only `/dev/components` catalogue also stays outside the shell -- it already renders its own live `AppHeader` as one of its demo sections, so wrapping it in `AppShell` too would stack two header bars rather than have it meaningfully "use" the real shell (an initial attempt to nest it was caught and reverted in PR review, `ghs#97`).

**Outer wrapper is `h-screen overflow-hidden`; only `<main className="flex-1 overflow-y-auto">` scrolls.** Proved with real computed styles via the browser-automation skill, not just visual inspection: `document.body.scrollHeight === document.documentElement.clientHeight` (the body itself never scrolls) while `main`'s `overflow-y` computes to `"auto"` and the footer's `getBoundingClientRect()` stays pinned to the viewport bottom regardless of content length -- an exact match to the design doc's (`GHS-frontend-design-system-and-layout-Claude-prompt.md` §7) literal CSS sketch.

**`MobileNav` is its own native-`<dialog>` implementation, not a reuse of `Modal.tsx`.** It mirrors `Modal`'s open/close mechanics (`showModal()`/`close()`, a `closingProgrammaticallyRef` guard so a parent-driven close and a user-driven close -- Escape, backdrop click, selecting a nav link -- don't both fire `onClose`) but ships its own left-edge-drawer CSS (`fixed inset-y-0 left-0 ... w-72`) rather than overriding `Modal`'s hardcoded bottom-sheet/centered-dialog classNames. A left-edge drawer and a centered/bottom-sheet modal are a genuinely different visual shape, not a className away from each other -- forcing reuse would have meant fighting Tailwind specificity for no real sharing.

**`AccountMenu` is hand-rolled, not a headless-UI/Radix dependency, and is a disclosure popover, not an ARIA `menu`.** `aria-expanded` + `aria-controls` on the trigger, click-outside via a `mousedown` listener checking `containerRef.current.contains()`, Escape both closes the panel and returns focus to the trigger. It carries a stable `aria-label="Account menu"` independent of the dynamic email text it also displays -- added specifically after the shell migration broke several existing tests that had used the visible "Sign out" button (now hidden inside the closed-by-default panel) as their post-login proof of navigation; those tests now assert on the always-present, role-agnostic trigger instead. One dropdown consumer isn't enough to justify a generic reusable `Menu` primitive. Originally shipped as `role="menu"`/`role="menuitem"` (PR #97's first revision); caught in review as a real ARIA pattern mismatch -- the panel mixes static text (email/role) with a single action button, and a true `menu` role requires every child to be a `menuitem` with roving-tabindex arrow-key navigation, neither of which this panel had. Fixed by dropping both roles and relying on normal tab order instead of building out the full ARIA menu keyboard model for a panel that doesn't need menu semantics.

**`ThemeToggle` lives in the header, immediately to the left of `AccountMenu`, not inside its dropdown.** It's a single always-visible action (one click, one binary state), unlike Sign out or the email/role display, which belong behind a disclosure because they're either destructive or secondary information -- putting it in the trigger row keeps the most-used action reachable without opening anything.

**Nav items are existence-only, not speculative.** `useNavEntries()` (`components/navigation/nav-entries.ts`) lists exactly the routes that exist today -- Dashboard for everyone, My Rounds for `player`, Accounts/Pending Rounds/All Rounds for `admin`/`super_admin` -- per the design doc's own instruction (§9) against building navigation for screens that haven't been approved yet. (`ghs#142` later removed the standalone "Create Account" entry once `AdminAccountsPage` grew its own button to the same route; `ghs#146` likewise removed "New Round" once `PlayerDashboardPage` grew its own button.) Active-state styling reuses the existing "soft accent, not filled background" pattern (`bg-primary-soft text-primary`) already established by `AppHeader`'s own `NavItem`, per the design doc's explicit guidance not to overuse emerald backgrounds.

**Two deliberate non-decisions, to avoid building ahead of real need:** the footer shows `© {year} Socx Organisation. All rights reserved.`, plus the environment tag outside production (`ghs#133`), with no version string -- there's no release/build-version value populated anywhere in this app yet, and a fabricated one would be worse than none. `ThemeToggle` stays the existing 2-way light/dark switch rather than gaining a 3-way Light/Dark/System option the design doc's §8 mentions only as a possibility, not a requirement.

**`useNavEntries`/`navItemClasses` live in their own `nav-entries.ts` file, not inside `Sidebar.tsx`.** Same `react-refresh/only-export-components` constraint already hit once in `#95` (`lib/dates.ts`) -- a file can't export both a component and a plain function without breaking Vite Fast Refresh, so the two entries meant to be shared between `Sidebar` and `MobileNav` were extracted rather than duplicated.

**Verified end-to-end against the real running API and dev server**, both viewports and both themes: resized to real mobile and desktop widths (`page.setViewportSize`) confirming the sidebar/hamburger swap at the intended breakpoint, opened and closed the mobile drawer for real, opened `AccountMenu` and drove a real sign-out (`/auth/logout` call, tokens cleared, redirected to `/login`), toggled dark mode and re-checked contrast on the new chrome, and loaded as both a seeded `player` and a seeded `admin` to confirm role-scoped nav items render correctly.

## Graceful failure: error boundary and 404 (`ghs#102`)

**One application-level `ErrorBoundary`, wrapping `AppRoutes` inside `BrowserRouter`** (`App.tsx`) -- not per-route. This app doesn't have enough independent route surfaces yet to justify per-page boundaries (design principle 9: no speculative abstraction ahead of real need). It's the one class component in the codebase, because `getDerivedStateFromError`/`componentDidCatch` have no hook equivalent as of React 19.

**Retry re-renders the same children rather than navigating away first.** If the underlying cause was transient, this recovers in place; if not, render throws again and the boundary re-catches immediately. Back and Go to Dashboard are the explicit escape hatches for when it isn't transient. The fallback (`ErrorFallback.tsx`) is deliberately self-contained, not rendered inside `AppShell` -- the crash that triggered it could have originated anywhere in the tree the boundary wraps, including the shell itself, so the fallback can't depend on any of that still working. Its copy originally claimed "your data is safe," a guarantee the app can't actually make for every crash scenario (e.g. a crash before a save request completes) -- caught in PR review (`#119`) and reworded to stay reassuring without the false claim.

**`AppShell` gained an optional `children` prop** (defaulting to `<Outlet/>`) specifically so the 404 route could render inside the real shell for an authenticated user without needing router nesting. The catch-all route can't simply live nested under `RequireAuth`'s `<AppShell/>` branch -- `RequireAuth` would redirect an unauthenticated visitor to `/login` before its nested `"*"` child ever got a chance to render, which is wrong for a URL that's genuinely nonexistent, not merely auth-gated. So `NotFoundRoute` sits at the top level in `AppRoutes.tsx` and dispatches on auth state itself, same pattern as the existing `HomeRoute`: authenticated gets `<AppShell><NotFoundPage/></AppShell>`, unauthenticated gets the bare page.

## Standard list presentation: `ListView` (`ghs#103`)

**One `items` array, one shared data source, two representations** -- `ListView<T>` (`components/ListView.tsx`) is the design doc's §7 "standard list presentation" convention made real: a table view (dense, desktop-oriented) and a grid/card view (visual, mobile-friendly), both driven from the same data, switched via the existing `ToggleGroup`. Any screen that browses many entities (Accounts, Courses, Rounds -- all still to come) should build on this rather than a bespoke table/grid split; a screen with a single small fixed dataset (e.g. round-entry's per-hole cards) isn't a browsable list in this sense and shouldn't reach for it.

**Grid view is plain semantic `<ul>`/`<li>` in a responsive CSS grid, not the existing `List`/`ListItem` primitives.** Those render a single-column bordered, divided stack -- the right shape for something like a settings list, but visually wrong for a multi-column card grid (`divide-y` puts a border across items that are supposed to sit side by side, not stacked). `renderCard` is expected to return a `Card`-based node; `ListView` itself stays unopinionated about what's inside each cell, exactly like `renderTableRow`.

**The chosen view persists per screen**, via a new `useListView(id, defaultView)` hook (`lib/useListView.ts`) -- same shape as `ThemeToggle`'s own `ghs-theme` persistence (lazy `useState` initializer reads `localStorage` once, a real choice writes it back), keyed `ghs-list-view:${id}` so e.g. the Accounts list and the Courses list remember their own view independently.

**Search and per-column filters are opt-in additions to `ListView` itself (`ghs#137`)**, not sorting or pagination. `getSearchText?: (item: T) => string` turns on a free-text box that matches client-side against whatever fields a screen designates as searchable (e.g. email + name for Accounts, course + tee for Rounds); `filters?: ListViewFilter<T>[]` turns on one `Select` dropdown per entry, each with its own `getValue`/`options`, opt-in per screen since only some tables have real enum-like columns (`CourseListPage` has none -- name/location are free text, so it gets search only). Both apply client-side to the same already-fetched `items` array; combining search with a filter is an AND. A screen that omits both props (none exist as of `#137`, but the shape allows it) renders exactly as before. Neither is a substitute for the backend's own default sort order, which `ListView` still doesn't touch.

**Filtering everything out is a distinct state from having nothing to show.** `items.length === 0` still renders the screen's own `emptyState` (e.g. "Courses added by an administrator will show up here"); a non-empty `items` narrowed to zero by search/filter renders a generic "No matches" `EmptyState` instead -- the first copy would be actively misleading once real data exists but is just filtered out.

**No sorting or pagination UI built into `ListView` itself** -- pagination is `#138`, a separate, still-open issue (deliberately sequenced after `#137` so it can paginate the already-filtered result, not the raw array); sorting remains genuinely out of scope, per the design doc's own "do not invent behaviour without backend support" rule for anything beyond what a consuming screen's endpoint already returns. No virtualization either -- not justified until a real screen's dataset size demands it.

## API client & auth foundation (`ghs#63`)

**One API client, one auth/session layer** -- `apps/web/src/lib/api.ts` (the Axios client + `login`/`verifyMfa`/`logout`), `apps/web/src/lib/auth-store.ts` (token/user state), `apps/web/src/lib/jwt.ts` (payload decode), `apps/web/src/hooks/useAuth.ts`, `apps/web/src/components/domain/RequireRole.tsx`. No component calls Axios or `fetch` directly against `/api/v1/*` -- everything goes through this layer, so every subsequent feature issue (starting with Login/MFA, `#64`) builds on it rather than reinventing it.

**Two Axios instances, deliberately**: `bootstrapClient` (login, MFA verify, refresh, logout) and `api` (everything else, carrying the interceptors). Routing the auth-bootstrap flow through `api`'s own interceptors would be actively wrong, not just redundant -- the request interceptor would attach a token that doesn't exist yet (login/MFA) or is meaningless (refresh), and the response interceptor's 401-triggers-refresh logic would either loop against `/auth/refresh` itself or misread login's "invalid credentials" 401 as an expired session. `bootstrapClient` is exported (not kept module-private) specifically so tests can mock it independently of `api` -- `axios-mock-adapter` attaches per-instance.

**External store, not a Context provider, for auth state**: `auth-store.ts` is a plain module (tokens, decoded user, a `subscribe`/`getUser`/`getTokens`/`setTokens` API), not React state. `api.ts`'s interceptors need synchronous read/write access to the current tokens *outside* of any React render -- a Context can't provide that on its own, and wrapping the module in one would just be a second representation of the same state to keep in sync. `useAuth()` reads it via React's built-in `useSyncExternalStore`, no extra dependency needed. There is no `AuthProvider` to mount -- the store initializes itself from `localStorage` at module load, so the first render already has the correct persisted state with no loading flash.

**Token storage**: `localStorage`, matching `Socx-Org/rms`'s own real, already-deployed pattern (`rms/apps/web/src/hooks/useAuth.js`) rather than inventing a different strategy for GHS. `#63`'s own non-scope explicitly rules out cookies or any change to the backend's Bearer-token architecture, and an in-memory-only alternative would lose the session on every page reload with no silent-refresh-on-load mechanism to compensate -- not a real improvement for the added complexity.

**Client-side JWT decode is UX-only, never an authorization boundary** -- documented in code (`jwt.ts`, `auth-store.ts`) and worth restating here: the backend verifies the real HS256 signature and is the sole authority on every actual request; the client only ever reads the *raw* JWT payload (snake_case: `sub`, `email`, `ghs_role`, `amr`, `tokenType` -- see `apps/api/src/application/auth-provider.ts`'s `AccessTokenClaims`) for immediate UI state, never the backend's own camelCase `Identity` remap (that only happens server-side). No `jwt-decode` dependency -- decoding a JWT payload is a few lines (base64url decode + `JSON.parse`), not worth a package for.

**`RequireRole` is router-agnostic on purpose.** No router exists in this repo yet -- nothing has needed real multi-screen navigation before now, consistent with every other "defer until genuinely needed" dependency decision in `ghs#78`/`ghs#82`. `RequireRole` gates *rendering* (children vs. an optional fallback), not navigation; it does not redirect anywhere. Whichever issue first needs actual multi-screen navigation (likely `#64`, Login/MFA, since a real login needs somewhere to navigate *to* on success) is where a router decision belongs -- `RequireRole` stays the reusable "does the current user's role satisfy X" primitive underneath whatever that turns out to be.

**Testing**: `axios-mock-adapter` added as a devDependency (test-only, no production impact) specifically to exercise the interceptor chain itself -- the acceptance criteria (transparent refresh, single-flight de-duplication, clean failure on a revoked/reused refresh token, logout clearing state regardless of network outcome) are all about interceptor *behaviour*, which needs real request/response cycles through the real Axios instances to verify meaningfully, not a hand-mocked `fetch`.

**Real backend contracts were verified directly against the actual route handlers** (`apps/api/src/interface/http/routes/auth.ts`, `apps/api/src/application/auth-provider.ts`), not assumed from the issue text -- and then re-verified against a real running API (exact status codes and `{error: "..."}` bodies for bad credentials, missing fields, and an invalid refresh token; confirmed logout returns `200 {"message": "Logged out."}` even for a token the backend has never seen, matching its own documented idempotent-by-design comment).

## Visual design direction

Modern SaaS structure (clean, structured, information-dense without feeling cluttered) with a subtle premium golf/clubhouse character carried through colour, restraint and the brand mark -- not through golf imagery, ornamental styling, or a second typeface. Deliberately distinct from RMS's own frontend (indigo primary, no design tokens, no dark mode, one shared component across 14 pages) rather than a visual reskin of it -- see "Component layering" and "RMS precedent" below.

## Semantic colour system

Tailwind's stock palette, aliased to intent via CSS custom properties (`apps/web/src/styles/theme.css`) rather than new colours. Two layers: `@theme` registers the semantic *names* so Tailwind generates `bg-primary`/`text-primary`/etc. utilities; plain `:root` custom properties underneath hold the actual light/dark values (`@theme` tokens are resolved once at build time, so the runtime-switchable light/dark split has to live one level below it, not inside the `@theme` block itself).

| Token | Light | Dark | Used for |
|---|---|---|---|
| `primary` | `emerald-700` | `emerald-500` | Buttons, links, focus rings, active nav |
| `success` | `green-700` | `green-400` | Approved rounds, success banners |
| `warning` | `amber-700` | `amber-400` | Pending rounds, warning banners |
| `danger` | `red-600` | `red-400` | Rejected rounds, destructive actions, errors |
| `info` | `blue-700` | `blue-400` | Informational banners |
| `amending` | `violet-600` | `violet-400` | Round sent back for player resubmission |
| `surface` / `surface-raised` | `white` / `white` | `slate-800` / `slate-700` | Cards, modals, table rows / a step lighter still, for hover-within-a-surface |
| `bg-page` | `slate-50` | `slate-900` | Page background |
| `border` / `border-strong` | `slate-200` / `slate-300` | `slate-700` / `slate-600` | Dividers, card borders / input borders needing more definition |
| `text` / `text-muted` | `slate-900` / `slate-500` | `slate-100` / `slate-400` | Body text / help, captions, secondary text |
| `text-on-primary` | `white` | `slate-900` | Text/icon colour on a solid `primary`/`danger` fill |

### Why the shade numbers aren't what you'd guess

Every pairing below was measured (canvas-rasterized real sRGB from Tailwind v4's OKLCH values, not assumed from the class name), because several intuitive choices turned out to fail WCAG AA (4.5:1 for normal text):

- **`emerald-600` fails as the primary shade.** White text on `emerald-600` is 3.65:1 (fails); `emerald-700` is 5.36:1 (passes). `emerald-600` is kept, but only for *non-text* accents (icons, borders, focus rings), where the looser 3:1 non-text/UI-component threshold applies.
- **The same pattern repeats for `success` and `warning`.** `green-600`/`amber-600` text on white measured 3.22:1/3.20:1 (fail); `green-700`/`amber-700` measured 4.95:1/5.03:1 (pass). `info`'s original `blue-500` measured 3.76:1 (fail); `blue-700` measured 6.83:1 (pass).
- **`amending` (`violet-600`) needed no correction** -- it measured 5.89:1 as text, passing at `600` already. This is a genuine per-hue finding (Tailwind's OKLCH lightness doesn't map uniformly to perceived contrast across hue families), not an inconsistency to "fix" for false symmetry.
- **`danger`'s `red-600` also needed no correction** -- 4.77:1 as both button-fill text and standalone text, passing directly.
- **Dark mode is not an inversion.** `emerald-500` against `slate-900`/`slate-950` measured 7.21:1/8.15:1 -- dark mode shifts *up* in lightness (a dark background needs a *brighter* accent to read clearly, the opposite of light mode needing a *darker* one against white). The `-400` shades used for `success`/`warning`/`info`/`amending` in dark mode all measured 5:1+ against `slate-800`/`slate-900`.
- **`text-on-primary` flips to dark text in dark mode, and this matters for `danger` too, not just `primary`.** White text on dark-mode `danger`'s `red-400` fill measured only 2.89:1 (fails badly); `slate-900` text on `red-400` measured 6.17:1 (passes). Both `Button`'s `primary` and `destructive` variants reuse the same `text-on-primary` token rather than each needing their own -- the underlying need ("bright dark-mode accent fill needs dark text, not white") is identical for both.

### Why `primary` (emerald) and `success` (green) are kept distinct

Real hue separation is ~14 degrees (`green-600` at 149deg vs `emerald-600` at 163deg in OKLCH) -- confirmed visually distinguishable side by side (a genuine teal-vs-grass difference), though not dramatic. Disambiguated primarily by **role**, not hue alone: emerald appears on solid buttons/links/focus rings; green appears only on pill-shaped status badges and alerts, always paired with a text label (never colour alone, per the accessibility section below). Emerald also differs enough from RMS's indigo that the two sibling SOCX apps don't read as reskins of each other.

**RoundStatus colour semantics** (`components/domain/RoundStatusBadge.tsx`):

- `draft` -> neutral/slate (not yet submitted)
- `pending` -> warning/amber (awaiting committee review)
- `approved` -> success/green
- `rejected` -> danger/red
- `amending` -> **violet**, deliberately distinct from `pending`. Different urgency and different owner: `pending` means waiting on the committee; `amending` means waiting on the player to resubmit. Reusing amber for both would blur that distinction on a player's own round list.

## Light / dark theme

`data-theme` attribute on `<html>` + a three-layer CSS cascade: bare `:root` holds the light-theme values (the default); `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` overrides them for users with no explicit choice; `:root[data-theme="dark"]` overrides again so an explicit `ThemeToggle` choice always wins over system preference, in either direction. No dependency -- this is a small, standard CSS pattern, not a library concern.

**No flash of the wrong theme**: a small inline script in `index.html`'s `<head>` reads `localStorage` and sets `data-theme` before React hydrates (React can't run early enough to prevent the flash on its own -- its own JS bundle hasn't loaded yet). If there's no stored preference, the script leaves the attribute absent entirely and lets the `prefers-color-scheme` media query govern, per "respect system preference as the default."

**`ThemeToggle` must not silently "lock in" system preference.** Merely mounting the component (or loading the catalogue with system dark mode active) does not write to `localStorage`/`data-theme` -- only an actual click does. Until a real choice is made, the displayed icon tracks live system-preference changes (a `matchMedia` `"change"` listener); once toggled, that listener is dropped and the explicit choice governs from then on.

**Elevation in dark mode comes from lightness steps** (`surface-raised` lighter than `surface`, lighter again than `bg-page`), not shadow -- a shadow is nearly invisible against an already-dark background, a well-established dark-UI convention (GitHub/Linear/Vercel dashboards all do this), not a stylistic flourish.

## Logo

`Logo` component (`variant: "full" | "mark"`). No SOCX logo asset existed anywhere in the workspace before this (checked directly across `ghs`, `rms`, and `socx-platform` -- confirmed absent, not assumed). The mark is a custom-drawn S-glyph SVG path (not `<text>`, which depends on whatever font happens to be available and can render inconsistently across platforms/browsers at small sizes) inside a circle.

**Colour comes from the existing `text`/`surface` tokens, not new logo-specific ones**: circle = `fill-text`, S = `fill-surface`. In light theme that resolves to exactly "white S in a near-black circle" as specified; in dark theme `text`/`surface` themselves invert (`slate-100` circle, `slate-800` S) -- the same relationship, automatically, with no separate dark-mode asset or component-level `dark:` styling needed. Approved dark-theme treatment: simple inversion, not a third colour introduced into the mark.

Minimum rendered size: 24px (the S stroke starts losing legibility below that). `variant="full"` pairs the mark with the "ocx" wordmark in the same system sans stack (`font-semibold tracking-tight`) -- deliberately not a second (serif/display) typeface, which would reintroduce the webfont cost this project has avoided since `ghs#78` and risk looking bolted-on. The "premium" character lives in the mark and in weight/spacing restraint, not in a different font family.

## Iconography

`lucide-react` -- the one new runtime dependency this issue introduces. React 19 peer-compatible (verified via `npm view`), ISC licensed (verified against `package-lock.json` directly -- an earlier draft of this doc said MIT, a real discrepancy caught in review, PR #83), tree-shakeable ESM (confirmed for real: the production bundle grew by ~60 bytes after adding ~15 icon imports, despite the package's large *unpacked* size -- per-icon imports really are tree-shaken, not a marketing claim taken on faith). One consistent stroke-width line-icon set, large enough to cover navigation/action/status icons without gaps, avoiding RMS's hand-rolled-SVG-per-page pattern (confirmed: RMS has no icon library dependency at all, just inline `<svg>` per usage site).

Icon-only buttons keep `Button`'s existing `aria-label` requirement (dev-time console error if neither visible children nor `aria-label` are present). Decorative icons are `aria-hidden`. Status/feedback icons (`CheckCircle2`, `AlertTriangle`, etc.) are used sparingly and always paired with a text label -- never as the sole indicator of state.

## Typography

System font stack (`font-sans`) -- no webfont, no licensing/perf cost, appropriate for a utility application. Tailwind's stock type scale, used as-is (no invented sizes):

- Page heading: `text-3xl font-semibold` (also `text-2xl` for tighter contexts, e.g. the catalogue's own section headings)
- Section heading: `text-lg font-semibold`
- Body: `text-sm`/`text-base`
- Muted/help text: `text-sm text-text-muted`
- Form label: `text-sm font-medium`
- Numeric/stat values (`Stat`): `tabular-nums` -- a handicap/scoring app where digits routinely sit in aligned columns benefits from monospaced-width digits; a small, disciplined touch, not decoration.

## Spacing

Tailwind's default 4px scale throughout -- no arbitrary values. Standard container: `max-w-7xl px-4 sm:px-6 lg:px-8` (reused from RMS's own convention here, which is fine as-is).

## Radius / elevation

Three tiers in practice, now formalised explicitly: `rounded-full` for compact pill-shaped controls (`Badge`, `Avatar`, `ToggleGroup`'s track), `rounded-md` for standard interactive controls (buttons, inputs, selects), `rounded-lg` for surfaces/containers (cards, modals, tables). Elevation is minimal by design: `shadow-sm` for cards/dropdowns, `shadow-lg`/`shadow-xl` reserved for modals only, separation mostly via `border` -- consistent rather than visually elaborate. See "Light / dark theme" above for how this changes (lightness steps, not shadow) in dark mode.

## Focus conventions

One convention everywhere, not styled per component -- now using the `primary` token (emerald) rather than a fixed blue, per the approved direction that focus indicators should carry the brand colour:

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary
```

## Touch targets

44px minimum on default-size interactive controls (`Button`'s `md` size is `h-11`, the default; `Input`/`Select` are `h-11`). `Button`'s `sm` size (`h-9`, 36px) is intentionally smaller and reserved for dense desktop-only contexts (e.g. inline table row actions) -- never the only way to reach a primary action on a mobile flow.

Checkbox/radio glyphs stay a normal visual size (20px, `h-5 w-5`) rather than being forced to look like oversized 44px dots -- WCAG 2.5.5 allows the *tappable target* to include adjacent label text, so `Checkbox`/`RadioGroup`/`ToggleGroup` usage wraps the control and its label in a `min-h-11` row instead of enlarging the glyph itself.

## Component layering

Two layers, kept deliberately separate:

- **Generic primitives** (`apps/web/src/components/*.tsx`): zero GHS domain knowledge. `Badge` just renders a variant; it has no idea what "amending" means.
- **Domain compositions** (`apps/web/src/components/domain/*.tsx`): thin wrappers carrying GHS-specific mapping -- `RoundStatusBadge` (status -> label/variant), `RoleBadge` (role -> label/variant). These consume the generic layer rather than duplicating its styling.

This separation exists so the generic layer stays reusable if GHS's domain vocabulary changes, and so a reviewer can tell at a glance whether a given component encodes business rules or not.

## Mobile-first / desktop-dense

- `Table` wraps in a horizontal-scroll container by default -- a fixed multi-column table is unusable on a phone otherwise. Prefer `List` for the same data at narrow widths (round history), reserving `Table` for the data-dense desktop admin case.
- `Modal` is one component, responsive by breakpoint: bottom-anchored, full-width sheet below `sm:`, centred dialog at `sm:` and above. No separate mobile/desktop modal implementations.
- `Toast` centres bottom on every viewport, rather than switching between a desktop corner and a mobile centre position -- one responsive rule instead of two positioning schemes, and it avoids edge-cutoff on narrow phones entirely.
- Admin density comes from responsive Tailwind breakpoints (more columns/tighter padding at `lg:`), not a JS-driven "density mode" -- avoids a second prop-driven state system for what breakpoints already solve.
- No interaction anywhere depends on hover (this is why Tooltip is excluded -- see below) -- directly serves round entry on a phone. `Toast`'s pause-on-hover is a progressive enhancement, not a requirement -- dismissal still happens automatically without it, so it doesn't violate this rule; it just doesn't do anything extra on touch, which is fine.

## Accessibility expectations (part of the component contract, not a later pass)

- Labels are associated with controls via `FormField`'s automatic `htmlFor`/`id` wiring, not ad hoc per screen.
- Help/error text is linked via `aria-describedby`; error text uses `role="alert"`.
- Required fields are communicated via sr-only text ("(required)"), not colour/symbol alone -- the visible `*` is `aria-hidden`.
- Icon-only buttons require `aria-label` (`Button` logs a dev-time console error if one renders with neither visible children nor an `aria-label`).
- `Alert`/`Toast` variants are announced textually (an sr-only "Success:"/"Error:"/etc. prefix), not communicated by colour alone, and use the same `role="alert"`/`role="status"` split (error/warning = alert/assertive, success/info = status/polite) so an individually-roled element is its own implicit live region -- no wrapping `aria-live` container layered on top, which would risk double-announcing in some screen readers.
- Disabled-because-of-permissions actions get adjacent static help text, not a tooltip (tooltips are hover-dependent, which fails on touch -- see "Deferred: Tooltip" below).
- `ToggleGroup` is built on real `<input type="radio">` elements (visually hidden via `sr-only`, not `display:none`, so they stay in the accessibility tree and stay label-clickable for real users) rather than a custom div/button implementation -- arrow-key navigation between options is native browser behaviour this way, not hand-rolled JS. This is the same lesson `ghs#78`'s review pass already taught once (`ListItem` needed retrofitted keyboard handling after shipping without it) -- built in this time rather than fixed after the fact.
- `Skeleton` is `aria-hidden` (a loading placeholder is not content) and respects `prefers-reduced-motion` via Tailwind's built-in `motion-reduce:animate-none` variant -- no custom JS/media-query handling needed for that.

## The native `<dialog>` decision

`Modal` is built on the native HTML `<dialog>` element via `showModal()`, not a headless-UI dependency (Radix, Headless UI). `showModal()` gives, for free, in every evergreen browser: a real focus trap, Escape-to-close, an inert background (verified directly: clicking behind an open dialog does not activate it), and focus restored to the trigger on close. This was the entire justification for reaching for a dependency here, so none was added.

**A real gotcha found during implementation, worth recording**: Chromium's UA stylesheet sets `inset: 0` on `dialog:modal`. `Modal`'s mobile styling only overrides `left`/`right` (`inset-x-0`) and `bottom` (`bottom-0`) -- without an explicit `top-auto`, the inherited `top: 0` combines with `bottom: 0` and `height: auto` to anchor the dialog to the *top* of the viewport instead of the bottom. Found by real browser measurement (`getComputedStyle`), not assumed from the class list. Fixed by adding `top-auto` explicitly alongside `bottom-0`. Re-verified after the `ghs#82` token refactor (touched `Modal`'s className list) in both themes and both viewport classes -- still bottom-anchors correctly on mobile, still centres correctly on desktop.

**A second real gotcha, found and fixed in review** (`ghs#79`): `onClose` could double-fire when the *parent* set `open` to `false` itself (its own state update, not a click on Modal's own close button) -- the resulting internal `dialog.close()` call echoes back through the native `"close"` event listener. Fixed with a ref flag that suppresses the echo specifically for the parent-driven path, covered by a regression test.

jsdom does not implement `<dialog>`'s `showModal()`/`close()` at all (confirmed directly, not assumed) -- `src/test-setup.ts` polyfills just enough (`open` attribute toggling, a `close` event) for Vitest/RTL tests to exercise `Modal`'s own wiring. It does **not** attempt to replicate real focus-trap or Escape-key dispatch; those are verified against a real running browser instead, not asserted in the jsdom test suite. jsdom is also missing `window.matchMedia` entirely (same category of gap, confirmed directly) -- polyfilled with a real `EventTarget`-based `MediaQueryList` so `ThemeToggle`'s system-preference tests can flip `.matches` and dispatch a real `"change"` event, not just a `matches: false` stub.

## Toast

Built now (`ghs#78` deferred it; `ghs#82` reverses that with a concrete design). In-repo `ToastProvider` (React context) + `useToast()` hook + `Toast` presentational component -- no toast library. `ToastContext` lives in its own file (`ToastContext.ts`), separate from `ToastProvider.tsx`, specifically so `ToastProvider.tsx` only exports components (`react-refresh/only-export-components` correctly flags a file that exports both a component and a context value; the fix is separating them, not suppressing the rule).

Default 5s auto-dismiss (`duration` overridable per call, `0` disables it), pause-on-hover (a progressive enhancement, not required for correctness -- see "Mobile-first" above), bottom-centre position on every viewport. Stacking is chronological (oldest toast nearer the top of the stack, newest appended at the bottom, closest to the screen edge) via plain array order in a `flex-col` container -- no `flex-col-reverse` trick needed.

## ToggleGroup

For mutually exclusive choices (e.g. a list/table view switch) where a segmented-button visual reads better than stacked radio dots. See "Accessibility expectations" above for why it's built on real radio inputs rather than custom keyboard handling.

## Deferred: Breadcrumb, Tabs

Still not built. The admin/player information architecture (how many sections, what nests under what) still hasn't been decided beyond what `ghs#96`'s shell now covers -- building deeper nav structure ahead of real screens needing it would be designing for a hypothetical.

**Sidebar is no longer deferred** -- see "Application shell (`ghs#96`)" above.

## Deferred: Tooltip

Excluded rather than built. The one clear candidate use case ("disabled action because of permissions") is served by static inline help text next to the control instead. A tooltip is inherently hover-dependent, which directly conflicts with this project's "interactions should not depend on hover" principle for mobile/touch use.

## Excluded: separate SkeletonAvatar/SkeletonCard/etc. components

One `Skeleton` primitive (`variant: "text" | "circle" | "rect"`), not six separate named components. Avatar/card/list/table/stat "skeletons" are documented compositions of the one primitive (see the Components Catalogue's Feedback section) matching each real layout, not a parallel component for each -- keeps the component count small per the "small but powerful" API principle.

## RMS precedent

**Kept**: `rounded-md`/`rounded-lg` + `shadow-sm` + border-based separation (proven, professional, no reason to reinvent), the page-container spacing convention, `focus-visible` discipline as a goal (RMS is inconsistent about it across pages; GHS is consistent from the start via one shared convention).

**Explicitly not carried forward**: RMS's near-total lack of componentisation (one shared component, `ApiStatusBadge`, across 14 pages -- everything else copy-pasted Tailwind-in-JSX per page); RMS's per-page inline `STATUS_STYLES` object pattern (superseded here by `RoundStatusBadge`/`RoleBadge`); indigo as the primary colour (emerald, distinct from both RMS and from semantic success -- see rationale above); Tailwind 3 classic config / JS-not-TS; hand-rolled inline SVGs per usage site with no icon library (confirmed: RMS has none); no dark mode at all (confirmed: RMS's `tailwind.config.js` has no dark-mode config, no `dark:` classes anywhere in its `src/`, no theme context of any kind).

## Dependencies

**One new runtime dependency**: `lucide-react` (icon library -- justified above). Everything else added by `ghs#82` -- Toast, Skeleton, ToggleGroup, Logo, ThemeToggle, the entire dark-mode mechanism -- is hand-built with zero new dependencies. `cn()` is still a ~3-line local classname-join helper (no `clsx`/`cva`/`tailwind-merge`); `Modal` still uses native `<dialog>` (no Radix/Headless UI); no `react-router-dom`, `react-hook-form`, `zod`, TanStack Query, or `axios` -- none of those have a concrete requirement yet (routing/forms/data-fetching decisions belong to the screens that actually need them, e.g. `#63`, `#64`).

`@testing-library/user-event` (added in `ghs#78`) remains a **devDependency only** (no production/runtime impact).

## Future platform-ADR candidates (not created now)

Two patterns from this issue are genuinely reusable beyond GHS, flagged here rather than promoted prematurely (GHS is still the only proof point):

- The three-layer dark-mode CSS-token pattern (`@theme` name registration + plain `:root` values + media-query/attribute override layering).
- "Brand colour and semantic colour must stay role-distinguishable, not just hue-distinguishable" -- the emerald/green reasoning above.

If RMS (currently zero dark-mode, zero componentisation) or a future SOCX application is ever revisited with this in mind, these are the two decisions worth lifting into a `socx-platform` ADR.
