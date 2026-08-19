# Claude Prompt — GHS Frontend Design System & Application Shell

## Context

This is the GHS frontend UI proper.

Before implementing product screens, establish a **robust, reusable design system and application shell** that defines the visual language of the entire application.

The objective is not merely to make the components page look attractive. It should establish the actual UI primitives, tokens, layout conventions, interaction patterns, responsive behaviour, accessibility conventions, and visual identity that subsequent screens will consume.

Treat the design system as a product foundation. Avoid one-off styling that will later need to be rewritten.

The intended visual language is:

> **Modern SaaS structure + premium golf/club visual character**

The application should feel professional, contemporary, polished and trustworthy, while retaining subtle cues associated with golf clubs, competition, governance and premium sporting environments.

Do not make it look like a generic sports app, an overly corporate enterprise dashboard, or a copy of RMS.

---

# 1. Primary Objective

Build and document the GHS frontend design system and application shell before implementing the product UI.

The work should establish:

1. Design tokens and colour system
2. Light and dark themes
3. Typography hierarchy
4. Spacing and sizing conventions
5. Buttons and interactive controls
6. Pills/tags/status treatments
7. Form controls
8. Alerts and feedback
9. Cards and surfaces
10. Tables and responsive lists
11. Loading/skeleton states
12. Empty/error states
13. Modals/dialogues
14. Icons
15. Application logo/branding
16. Application shell/layout
17. Responsive navigation
18. Profile/account menu
19. Fixed footer
20. Components catalogue/style-guide page
21. Accessibility conventions
22. Documentation of the resulting UI standards

The catalogue must use the **actual production components**, not separate mock components created only for demonstration.

---

# 2. Existing Technical Context

Confirmed existing GHS frontend:

- React 19.2
- TypeScript strict
- Vite
- Tailwind CSS v4
- CSS-first Tailwind configuration
- Vitest
- React Testing Library

The frontend currently has essentially no established component library, making this a clean opportunity to establish the correct architecture from the beginning.

Do not introduce unnecessary dependencies.

Prefer simple, transparent TypeScript/React implementations over abstraction for abstraction's sake.

---

# 3. Visual Identity

## 3.1 Primary Brand Colour — Emerald

The primary UI colour must be **emerald**, replacing the previously proposed blue primary.

The emerald palette should communicate:

- premium golf/club character
- confidence
- quality
- nature without becoming "green sports app"
- trust and professionalism

Use a carefully selected emerald scale rather than arbitrary greens throughout the application.

Recommended semantic palette:

### Light theme

```text
primary-50    #ECFDF5
primary-100   #D1FAE5
primary-200   #A7F3D0
primary-300   #6EE7B7
primary-400   #34D399
primary-500   #10B981
primary-600   #059669
primary-700   #047857
primary-800   #065F46
primary-900   #064E3B
```

Recommended usage:

- Primary actions: emerald-600
- Primary hover: emerald-700
- Focus ring: emerald-500/600
- Selected/active controls: emerald-600
- Light selected backgrounds: emerald-50/100
- Strong brand surfaces: emerald-700/800

Do not use emerald indiscriminately for success semantics.

**Important:** Primary brand colour and semantic success colour are related but distinct concepts.

For example:

- Primary action → emerald
- Approved/success → a separate success treatment, still visually compatible with emerald
- Warning → amber
- Error/danger → red
- Informational → blue
- Neutral → slate

This prevents every green element from being interpreted as "success".

---

# 4. Light and Dark Themes

The application must support both:

- Light theme
- Dark theme

Theme switching must be a first-class design-system capability rather than something implemented screen-by-screen.

Use semantic tokens rather than hardcoding colours into individual components.

For example:

```text
background
surface
surface-elevated
surface-muted
border
text-primary
text-secondary
text-muted
text-disabled
primary
primary-hover
primary-active
focus
success
warning
danger
info
```

The components should consume semantic tokens.

Do not scatter raw colour classes throughout the component library where a semantic token is appropriate.

### Light theme character

- Warm/neutral white or very light slate surfaces
- Strong but restrained emerald accents
- Clear hierarchy
- Premium, clean appearance
- Subtle borders and shadows

### Dark theme character

- Deep charcoal/slate rather than pure black
- Emerald accents should remain vivid but controlled
- Avoid excessive glowing/neon effects
- Maintain clear text contrast
- Preserve the premium club/technology aesthetic

Theme switching should be available from the application UI.

Persist the user's preference.

Respect the system preference on first visit where appropriate.

Avoid theme flicker during initial rendering.

---

# 5. Socx Logo / Brand Treatment

Create a polished application logo based on this concept:

> **Socx**, with the "S" represented in white inside a black circular mark, followed by "ocx".

The basic concept should remain intact, but it should be refined into a professional SaaS/golf-club visual identity.

Explore a treatment along these lines:

```text
   ●
  S   ocx
```

Where:

- "S" is white
- "S" sits inside a black circular mark
- "ocx" follows naturally
- typography is clean and modern
- proportions work at both desktop and mobile sizes
- the mark remains recognisable when used alone
- the wordmark does not look like generic system text

The logo must work in:

1. Full application header/sidebar
2. Compact/mobile navigation
3. Dark theme
4. Light theme
5. Small icon/mark-only contexts

Prefer creating the logo as an SVG/React component so it remains crisp and scalable.

Do not introduce a complicated illustration.

The identity should be understated and premium.

---

# 6. Overall Visual Language

The design should combine:

### Modern SaaS

- clean dashboard structure
- strong information hierarchy
- generous but controlled whitespace
- clear navigation
- restrained shadows
- responsive layouts
- consistent controls
- professional data presentation

### Premium Golf / Club Character

Use subtle visual cues rather than literal golf imagery.

The character should come from:

- emerald palette
- refined typography
- restrained contrast
- elegant spacing
- premium surfaces
- subtle borders
- confident status treatments
- polished navigation
- disciplined visual hierarchy

Avoid:

- golf-ball graphics everywhere
- cartoon golf illustrations
- excessive grass imagery
- overly sporty typography
- "sports app" visual clichés
- excessive gradients
- neon effects

---

# 7. Application Shell / Layout

The application layout must be changed from the earlier simple page layout.

Use a structure inspired by modern dashboard applications such as:

https://themewagon.github.io/material-dashboard-shadcn-vue/dashboard

Do not copy the design or branding. Use it only as a structural reference.

## Required layout

The application should have:

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌───────────────┐  ┌────────────────────────────────────┐ │
│  │               │  │ Header / top bar                    │ │
│  │               │  │                              Profile │ │
│  │               │  ├────────────────────────────────────┤ │
│  │   Vertical    │  │                                    │ │
│  │   Navigation  │  │        Main Page Content            │ │
│  │               │  │                                    │ │
│  │               │  │        Scrollable                   │ │
│  │               │  │                                    │ │
│  │               │  ├────────────────────────────────────┤ │
│  │               │  │ Fixed Footer                       │ │
│  └───────────────┘  └────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Desktop

### Left navigation

A persistent vertical navigation bar should sit on the left.

It should contain:

- Socx logo
- application identity/name where appropriate
- navigation groups/items
- icons for every navigation item
- active-state treatment
- clear hover/focus treatment
- role-aware navigation where appropriate

The navigation should be visually refined rather than heavy.

Use the emerald brand colour as an accent for active navigation.

Do not overuse emerald backgrounds.

### Top header

The top-right area should contain a Profile/Account control.

It should provide access to:

- user's name
- role where useful
- account/profile
- theme preference
- logout

The account menu should be a proper accessible dropdown/menu.

Do not use hover-only menus.

### Main content

The main content region must be independently scrollable.

The page should not scroll underneath a fixed header/footer structure unnecessarily.

Conceptually:

```css
height: 100vh;
display: flex;
flex-direction: column;
```

with the application shell arranged so that:

- navigation occupies the viewport height
- header remains stable
- footer remains fixed/stable
- main content uses the remaining available height
- main content scrolls independently

Avoid layouts where the footer disappears below a long page.

### Footer

The footer must remain fixed/stable within the application shell.

It should be visually understated.

Potential content:

- copyright
- application version
- environment where appropriate
- support/help link if later required

Do not make the footer visually compete with the page.

---

# 8. Responsive Behaviour

The shell must be genuinely responsive.

Do not simply shrink the desktop layout.

## Desktop

- Persistent left navigation
- Header
- Main content
- Footer

## Tablet

The navigation may collapse to a narrower/compact form.

## Mobile

The left navigation should become an appropriate mobile navigation mechanism.

Preferred behaviour:

- compact top/header presentation
- menu trigger
- navigation presented as a drawer/sheet
- accessible keyboard/focus behaviour
- navigation closes after selection where appropriate

The application must remain usable for the mobile-first round-entry experience.

Do not create a separate mobile application shell.

Use one responsive shell.

---

# 9. Navigation Icons

Icons must be used consistently for:

- navigation items
- action buttons where appropriate
- page titles
- status/action affordances where useful

Icons must improve recognition, not become decoration.

Do not put icons beside every piece of text merely because the system supports icons.

Use a consistent icon library rather than manually sourced SVGs scattered throughout the application.

Choose an appropriate lightweight icon library only if a dependency is genuinely justified.

Icons must:

- have consistent visual weight
- have accessible labels when standalone
- not be the sole indication of destructive/important meaning
- work correctly in light and dark themes

---

# 10. Page Titles

Page titles should use an icon + title treatment consistently.

Example:

```text
[icon] Dashboard
```

The hierarchy should clearly distinguish:

- application identity
- page title
- section heading
- supporting description

Page titles should not become oversized marketing headlines.

Use the established typography scale.

---

# 11. Toggle Buttons and Pills

Options and states should not always be represented using conventional buttons or dropdowns.

Introduce reusable patterns for:

### Toggle buttons

Use for mutually exclusive or small sets of selectable options where immediate visual selection is useful.

Examples:

- view modes
- time periods
- display preferences
- filters
- theme selection

Requirements:

- clear selected state
- keyboard accessibility
- focus state
- sufficient contrast
- accessible selected state (`aria-pressed` or appropriate semantics)
- responsive wrapping

### Pills

Use pills for:

- status
- filters
- compact metadata
- role indicators
- selected options
- categories

Do not use pills simply because they look attractive.

Define clear rules for when a pill is appropriate versus a button, badge, or text label.

---

# 12. Buttons

Use one reusable Button primitive.

Variants:

```text
primary
secondary
destructive
ghost
```

Sizes:

```text
sm
md
lg
```

Requirements:

- default `md` target should meet approximately 44px touch-target guidance
- loading state
- disabled state
- icon support
- icon-only mode
- keyboard/focus states
- light/dark support

Avoid creating separate Button components for every context.

---

# 13. Forms

Establish:

- Input
- Select
- Checkbox
- RadioGroup
- FormField

`FormField` should centralise:

- label
- required indication
- help text
- error text
- `htmlFor`
- `id`
- `aria-describedby`
- error accessibility

Use these components as the foundation for all product screens.

---

# 14. Feedback and Status

Establish:

- Alert
- Badge/Pill
- Toast
- EmptyState
- ErrorState
- LoadingState

Use semantic status colours:

```text
Success → green
Warning → amber
Danger → red
Info → blue
Neutral → slate
```

Domain status mappings should remain separate from generic UI primitives.

For example:

```text
draft     → neutral/slate
pending   → warning/amber
approved  → success/green
rejected  → danger/red
amending  → violet
```

`RoundStatusBadge` should own this mapping rather than duplicating it throughout pages.

---

# 15. Loading States — Skeletons

**Use skeleton loaders as the standard loading treatment for page and content data.**

Do not rely primarily on a centred spinner for normal page loading.

Skeletons should represent the approximate shape of the content being loaded.

Examples:

- dashboard statistics → rectangular skeleton blocks
- round list → row skeletons
- cards → card skeletons
- profile information → label/value skeletons
- tables → row/cell skeletons

A Spinner may still be appropriate for:

- inline actions
- button submission
- very short operations
- small local state transitions

Create a reusable `Skeleton` primitive and/or composed skeleton patterns.

Skeletons must work correctly in both themes.

Avoid excessive shimmer animation.

Respect `prefers-reduced-motion`.

---

# 16. Data / Display Components

Establish:

- Card
- Stat
- Badge/Pill
- Table
- List
- Avatar

Tables must have responsive behaviour.

For mobile, do not simply force users to interact with a huge desktop table.

Where appropriate:

- desktop → Table
- mobile → List/card representation

Use the same underlying data and semantics.

---

# 17. Modal / Dialog

Use a reusable Modal.

Prefer native HTML `<dialog>` unless direct implementation/testing demonstrates a concrete limitation that justifies a dependency.

Requirements:

- accessible title/description
- keyboard support
- Escape handling
- focus management
- responsive behaviour
- light/dark support

On mobile, the modal may behave visually as a bottom sheet.

On desktop, use a centred dialog.

Do not create a separate `ConfirmDialog` component. Confirmation is a usage pattern of Modal.

---

# 18. Tooltips

Do not make core interactions dependent on hover.

Avoid a Tooltip component unless a concrete use case emerges.

Disabled controls should generally have explanatory text or accessible supporting information rather than requiring hover.

---

# 19. Navigation Components

For the initial design system/application shell establish:

- AppHeader
- Sidebar / vertical navigation
- Mobile navigation/drawer
- Profile/account menu
- Navigation item

Do not prematurely build:

- complex breadcrumbs
- deeply nested navigation
- speculative tabs
- navigation structures for screens that have not yet been approved

The shell should be capable of growing without locking the application into a speculative information architecture.

---

# 20. Application Logo Component

Create a reusable:

```text
SocxLogo
```

with variants such as:

```text
full
mark
```

and appropriate sizing.

The component should support light/dark contexts.

Do not rasterise the logo.

Use SVG/React.

The catalogue must demonstrate all meaningful logo variants.

---

# 21. Component Architecture

Suggested structure:

```text
apps/web/src/
  components/
    Button.tsx
    Badge.tsx
    Input.tsx
    Select.tsx
    Checkbox.tsx
    RadioGroup.tsx
    FormField.tsx
    Alert.tsx
    Toast.tsx
    Spinner.tsx
    Skeleton.tsx
    EmptyState.tsx
    ErrorState.tsx
    Card.tsx
    Table.tsx
    List.tsx
    Avatar.tsx
    Stat.tsx
    Modal.tsx

    navigation/
      AppHeader.tsx
      Sidebar.tsx
      MobileNavigation.tsx
      NavigationItem.tsx
      AccountMenu.tsx

    branding/
      SocxLogo.tsx

    domain/
      RoundStatusBadge.tsx
      RoleBadge.tsx

    index.ts

  styles/
    theme.css

  ComponentsCatalogue.tsx
```

Adjust the exact structure if the existing repository conventions provide a clearly better approach, but preserve the architectural separation between:

1. generic reusable UI primitives
2. application-shell/navigation components
3. branding components
4. GHS domain-specific components

---

# 22. Design Tokens

Tailwind v4 is CSS-first.

Create a small, deliberate semantic token layer.

Do not create hundreds of tokens.

At minimum cover:

### Colour

```text
background
surface
surface-elevated
surface-muted
border
border-subtle

text-primary
text-secondary
text-muted
text-disabled

primary
primary-hover
primary-active

success
warning
danger
info

focus
```

### Shape

```text
radius-control
radius-surface
radius-pill
```

### Elevation

```text
shadow-surface
shadow-overlay
```

### Layout

Use Tailwind's standard spacing scale rather than inventing arbitrary values.

---

# 23. Radius and Elevation

Use a restrained system.

### Interactive controls

`rounded-md`

### Cards/surfaces

`rounded-lg`

### Pills/statuses

`rounded-full`

### Elevation

Use borders as the primary means of separation.

Use:

- subtle shadow for cards/dropdowns
- stronger shadow for overlays/modals

Avoid excessive elevation.

---

# 24. Typography

Use a modern system font stack.

No webfont should be introduced unless there is a strong design reason.

Suggested hierarchy:

```text
Page title       text-2xl / text-3xl, font-semibold
Section heading  text-lg, font-semibold
Body             text-sm / text-base
Supporting text  text-sm
Labels           text-sm, font-medium
```

Typography should remain consistent across screens.

---

# 25. Accessibility

Accessibility is part of the design system, not a later enhancement.

Establish conventions for:

- keyboard navigation
- visible focus
- colour contrast
- semantic HTML
- ARIA only where necessary
- accessible form labels
- accessible error messages
- accessible icon-only controls
- selected states
- disabled states
- modal focus management
- navigation semantics
- reduced-motion support

Do not rely solely on colour to communicate status.

---

# 26. Components Catalogue / Style Guide Page

Create a comprehensive Components Catalogue page.

This is a working style guide and visual test environment.

Sections:

```text
Brand
Foundations
Typography
Colours
Themes
Buttons
Toggle Buttons
Pills / Badges
Forms
Feedback
Loading / Skeletons
Cards / Surfaces
Data / Tables / Lists
Stats
Modal
Navigation
Application Shell
Icons
Domain Components
Responsive examples
```

Every component should demonstrate:

- variants
- sizes
- selected states
- disabled states
- loading states
- error states where relevant
- light theme
- dark theme
- mobile/responsive behaviour where relevant

Each example should have a concise explanation of intended usage.

The catalogue should dogfood the real application shell.

---

# 27. Catalogue Layout

The catalogue should itself use the new dashboard shell:

- left navigation
- top header
- account menu
- scrollable main content
- fixed footer

Use a sticky in-page section navigation if useful, but do not create an entirely separate navigation system solely for the catalogue.

The catalogue should demonstrate that the shell itself is production-ready.

---

# 28. Theme Switcher

The application shell should include a theme control.

Recommended options:

```text
Light
Dark
System
```

Use a suitable control such as a segmented/toggle option or accessible menu.

Persist the preference.

Do not make theme switching dependent on a full page reload.

---

# 29. Toast

Implement Toast only if a concrete use case can be demonstrated by the catalogue or existing approved workflows.

If implemented:

- use React context
- expose `useToast()`
- support semantic variants
- support dismissal
- respect reduced motion
- work in light/dark themes
- do not introduce a third-party toast library without justification

Examples:

```text
Success
Error
Warning
Info
```

---

# 30. Dependencies

Avoid unnecessary dependencies.

Current stack already provides most requirements.

Do not automatically add:

- clsx
- cva
- tailwind-merge
- Radix UI
- react-router-dom
- react-query
- axios
- react-hook-form
- zod

unless a concrete requirement exists and the dependency is justified.

A small local `cn()` helper is acceptable.

A lightweight icon library may be introduced if necessary to achieve consistent iconography.

If you believe any dependency is justified, explain why before introducing it.

---

# 31. Existing RMS Precedent

Use RMS only as architectural evidence, not as a visual template.

Useful precedent:

- rounded controls
- restrained shadows
- dashboard-style spacing
- practical responsive layout

Explicitly avoid inheriting:

- RMS's minimal componentisation
- repeated inline status-style maps
- indigo as the primary colour
- Tailwind 3 configuration
- JavaScript component implementation
- page-by-page duplicated UI patterns

GHS should deliberately establish a stronger design-system foundation.

---

# 32. Documentation

Document the resulting decisions in an appropriate GHS frontend architecture/design document.

At minimum document:

- colour system
- semantic tokens
- light/dark themes
- typography
- spacing
- radius
- elevation
- logo treatment
- iconography
- component conventions
- status/pill conventions
- skeleton loading standard
- responsive layout
- application shell
- navigation behaviour
- accessibility conventions
- dependency decisions
- deferred UI patterns

These are currently GHS application-level conventions unless there is an explicit decision to promote them to the SOCX platform standard.

Do not create a platform ADR merely because the design system is reusable. Only promote it to the platform level if the architecture is intentionally intended to become a cross-application SOCX standard.

---

# 33. Important Design Principles

Apply these consistently:

### 1. Reuse over duplication

If two screens need the same visual treatment, create/reuse a component.

### 2. Semantic tokens over raw colours

Prefer semantic design tokens to scattered colour literals/classes.

### 3. Mobile-first

Every component should work on a phone before being enhanced for desktop.

### 4. Accessibility by default

Do not retrofit accessibility later.

### 5. Status must be understandable without colour alone

Use text, icons and shape where appropriate.

### 6. No hover-dependent interaction

Everything important must work with touch and keyboard.

### 7. Premium restraint

Avoid visual noise.

### 8. Real components only

The catalogue must exercise the actual components used by the product.

### 9. Avoid premature abstraction

Do not build components for hypothetical future requirements.

### 10. Consistency over novelty

A small, coherent design vocabulary is better than dozens of visually different patterns.

---

# 34. Implementation Process

Before writing code:

1. Inspect the current GHS frontend.
2. Confirm the existing Tailwind v4 setup.
3. Inspect existing `App.tsx`, `main.tsx`, and `index.css`.
4. Confirm existing test configuration.
5. Review any existing frontend architecture documentation.
6. Identify anything from the previous component catalogue implementation that should be retained, changed or removed.

Then:

7. Propose the final component/token structure.
8. Implement the design tokens.
9. Implement light/dark themes.
10. Implement the Socx logo.
11. Implement the application shell.
12. Implement navigation/header/account/footer.
13. Implement foundational components.
14. Implement skeleton/loading states.
15. Implement the component catalogue.
16. Add tests for meaningful component behaviour.
17. Verify responsive behaviour.
18. Verify accessibility.
19. Run lint/test/build.
20. Document the design system.

Do not implement UI yet unless explicitly instructed.

---

# 35. Acceptance Criteria

The design-system phase is complete only when:

- The application has a polished modern SaaS dashboard shell.
- Desktop has a persistent vertical left navigation.
- Mobile has an appropriate responsive navigation mechanism.
- The top-right account/profile menu works.
- The footer remains stable/fixed within the shell.
- Main content scrolls independently between the header and footer.
- The shell is usable at mobile, tablet and desktop widths.
- Emerald is the established primary brand colour.
- Light and dark themes work correctly.
- Theme preference persists.
- System theme is respected where appropriate.
- The Socx logo exists as a reusable SVG/React component.
- Buttons, forms, pills, badges, cards, tables, lists, alerts, modals and skeletons are reusable components.
- Toggle buttons are available for appropriate option-selection patterns.
- Icons are consistently used in navigation, appropriate actions and page titles.
- Skeleton loaders are the default treatment for normal page/content loading.
- Spinners remain available for short inline operations.
- Domain status colours are centralised.
- Components are accessible by keyboard.
- Icon-only actions have accessible names.
- Focus states are consistent.
- Light/dark themes have sufficient contrast.
- The catalogue demonstrates all important states and variants.
- The catalogue uses the real production components.
- The catalogue itself runs inside the new application shell.
- Tests pass.
- Lint passes.
- Production build passes.
- No unnecessary dependency has been introduced.
- The design decisions are documented.

---

# 36. Important Constraint

Do not start implementing UI merely because the design system is complete.

The purpose of this work is to establish the visual and interaction foundation first.

Once this issue is complete, the next UI work must consume these components and conventions rather than introducing independent styling.

Before implementation, identify any genuinely ambiguous architectural or design decisions and ask rather than silently making a choice that would materially affect the system.
