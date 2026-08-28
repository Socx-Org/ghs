# Claude Prompt — Phase 6b Frontend Development Requirements

## Context

We are now shaping and implementing **Phase 6b — GHS Frontend Development**.

The objective is to build the frontend as a coherent, production-quality application rather than implementing isolated screens independently.

The existing approved frontend architecture and design-system work should be treated as the foundation. The requirements below refine the **development scope, implementation order, UX behavior, and product functionality** for Phase 6b.

Before implementing anything:

1. Inspect the current GHS frontend, backend API, existing design-system/components catalogue, routing, authentication foundation, and relevant backend endpoints.
2. Do not assume an endpoint exists simply because a feature is requested. Identify what already exists and what backend work is required.
3. Respect the existing project conventions, ADRs, standards, and CLAUDE.md instructions.
4. Work in small, logically scoped issues.
5. Document work in the GitHub Project before implementation, following the established project/issue workflow.
6. Do not implement speculative functionality that is not required by the approved scope.

---

# 1. Iconography

Icons should be used **sparingly, consistently, and purposefully**.

Use icons where they improve recognition or navigation, including:

- Primary and secondary navigation items.
- Page titles where an icon adds useful visual context.
- Action buttons where an icon reinforces the action.
- Status or contextual indicators where appropriate.
- Empty/error/success states where an icon improves comprehension.

Avoid decorative icon overload.

## Rules

- Icons must have a consistent visual style and icon library.
- Do not mix icon libraries or visual styles.
- Icons must not replace meaningful text where the text is important for accessibility or clarity.
- Icon-only buttons must have accessible labels.
- Icons should generally appear before button text.
- Navigation icons should be visually consistent in size and alignment.
- Use semantic icons consistently throughout the application; the same action should use the same icon everywhere.
- Do not introduce an icon merely because there is available space for one.

The design system should establish standard icon size, stroke weight, alignment, and spacing.

---

# 2. Graceful Application Failure

The application must fail gracefully when something unexpected happens.

A generic browser error, blank screen, or broken component is not acceptable as the user-facing experience.

## Global Error Boundary

Implement an application-level error boundary.

When an unexpected rendering/runtime error occurs, show a dedicated error page/state containing:

- A clear but non-technical explanation that something went wrong.
- A reassuring, professional message.
- An appropriate icon/illustration.
- A **Retry** action.
- A **Back** action where meaningful.
- A **Go to Dashboard** action as the safe fallback destination.
- No stack traces or implementation details to normal users.

Where technically possible, Retry should attempt to recover the current application state before forcing the user elsewhere.

Do not expose sensitive technical information.

---

# 3. 404 / Page Not Found

If a user navigates to a route that does not exist, show a dedicated **404 Not Found** page.

It should contain:

- Clear "Page not found" messaging.
- Appropriate icon/visual treatment.
- A concise explanation.
- **Go Back** action.
- **Go to Dashboard** action.

The page must use the application's established layout, typography, spacing, iconography, theme, and design-system components.

It must work correctly on desktop and mobile.

---

# 4. General Frontend Development Approach

Frontend development should proceed in a **logical, modular, dependency-aware order**.

Do not build the application as a collection of unrelated pages.

Features should be implemented as coherent modules with:

- Reusable components.
- Reusable API/query/mutation patterns.
- Consistent loading, empty, error, and success states.
- Consistent form behavior.
- Consistent validation and feedback.
- Consistent list/detail/create/edit/delete patterns.
- Appropriate responsive behavior.
- Appropriate authorization behavior.

Preferred high-level order:

> **Accounts → Courses & Tees → Rounds → Dashboard / remaining functionality**

The reason is that round creation and management depend on foundational entities such as users/players, courses, and tee configurations.

Before beginning each module:

1. Inspect existing backend capabilities.
2. Identify missing API functionality.
3. Raise backend work where necessary rather than implementing frontend assumptions.
4. Establish the module's navigation and screen structure.
5. Reuse the design system rather than creating one-off UI components.

---

# 5. Accounts Module

Use the referenced Material Dashboard contacts page only as **visual/information-architecture inspiration**:

https://themewagon.github.io/material-dashboard-shadcn-vue/contacts

**Do not copy it verbatim.**

## 5.1 Create Account — Admin

An administrator should be able to create a user account.

Clearly distinguish:

- Required information.
- Optional information.
- Account role.
- Activation state/process.

Creating an account should follow the established backend account-activation protocol.

## 5.2 Self Registration

If self-registration is enabled by application configuration/business rules:

- A user can register themselves.
- Registration follows the existing backend rules.
- The user receives appropriate feedback.
- Account activation follows the activation protocol.

Do not expose self-registration if disabled.

## 5.3 Account Activation

Account creation should support an activation workflow:

1. Account is created but is not immediately active where the protocol requires activation.
2. An activation email is sent.
3. The user clicks the activation link.
4. The account becomes activated.
5. The user receives clear feedback confirming the result.

Handle successful, expired, invalid, and already-used activation links gracefully.

## 5.4 Forgot Password / Password Reset

The login screen must provide:

> **Forgot my password**

The workflow should allow the user to:

1. Enter their email address.
2. Request password recovery.
3. Receive the recovery email.
4. Follow the password reset link.
5. Set a new password.
6. Receive clear confirmation.

Handle invalid/expired reset links gracefully.

Follow backend security rules rather than inventing weaker frontend rules.

## 5.5 Profile

The authenticated user's profile should be accessible from the **Account/Profile menu in the top-right application header**.

The profile screen should display relevant account information and provide an option to:

- Change password.

Do not expose fields users should not be able to modify.

## 5.6 List Accounts — Admin

Administrators should have an account list supporting:

- Table view.
- Grid/card view.

Use the standard application list pattern with appropriate loading, empty, error, responsive, and authorization states.

Do not invent filtering/pagination capabilities without first verifying backend support or raising the required backend work.

## 5.7 Enable / Disable Account — Admin

Administrators should be able to enable or disable accounts where supported.

The UI should:

- Clearly communicate current state.
- Require confirmation where appropriate.
- Provide clear success/error feedback.
- Update displayed state without unnecessary full-page reloads.

## 5.8 Delete Account — Admin

Administrators should be able to delete accounts where permitted.

Deletion must:

- Use explicit confirmation.
- Clearly identify the account.
- Explain that the operation may be destructive.
- Provide success/error feedback.

Do not use `window.confirm()` where the design system provides a proper modal/confirmation pattern.

---

# 6. Courses and Tee Configurations Module

Courses and tee configurations should be implemented **before Round creation** because rounds depend on them.

## 6.1 List Courses

Provide a course list supporting:

- Table view.
- Grid/card view.

## 6.2 Create Course — Admin

Administrators should be able to create courses using the established form components and validation conventions.

## 6.3 Tee Configurations

Each course should expose its tee configurations.

Administrators should be able to:

- List tee configurations.
- Create a tee configuration.
- Update a tee configuration.
- Delete a tee configuration.

Tee configuration UI should clearly present information relevant to handicap calculation and course setup.

Do not duplicate tee configuration UI patterns across unrelated screens.

## 6.4 Update Course

Administrators should be able to update course details.

## 6.5 Delete Course

Administrators should be able to delete courses where permitted.

Use the standard confirmation and feedback pattern.

If the backend prevents deletion because the course is referenced by existing rounds, present a clear user-facing explanation rather than a raw database/API error.

---

# 7. Standard List Presentation

This is a **global application convention**.

All significant list-based screens should provide a way to switch between:

### Table View

Optimised for:

- Desktop.
- Dense information.
- Administrative workflows.
- Sorting/columns where supported.

### Grid / Card View

Optimised for:

- Visual scanning.
- Smaller screens.
- Mobile-friendly interaction.
- Entity-oriented presentation.

Use a consistent toggle control for switching between the two representations.

The same underlying data/query should power both views.

Do not create separate data-fetching implementations for table and grid views.

The list-view toggle should be reusable and part of the shared UI patterns.

---

# 8. Rounds Module

Rounds are the core domain workflow.

Implement round functionality after Accounts and Courses/Tees foundations are available.

## 8.1 List Rounds

Respect authenticated-user role.

### Admin

Admins can see all relevant rounds.

### Player

Players can see only their own rounds.

The list should support:

- Table view.
- Grid/card view.
- Status presentation using the established round-status design system.
- Filtering/sorting only where supported by the backend.

## 8.2 Create Round

Both admins and players can create rounds with different permissions.

### Player

A player can create a round only for themselves.

### Admin

An admin can select a player account and create a round on their behalf.

The workflow should include:

- Player selection where required.
- Course selection.
- Tee selection.
- Round/date information.
- Hole-by-hole score entry.
- Clear progress indication.
- Save/error feedback.
- Explicit submission/approval behavior.

### Approval / Handicap Rules

The UI must accurately represent the backend workflow.

A player-created round requires admin approval before it counts towards handicap.

When an admin creates a round, the approved business rule is:

- The round is auto-approved.
- The system determines whether it can count towards handicap.
- The handicap is updated if applicable.

Do not duplicate handicap-calculation logic in the frontend. The backend remains authoritative.

The frontend should display resulting status and handicap information returned by the API.

## 8.3 Edit Round

When a player edits a round:

- Changes require admin approval.
- The UI clearly communicates that edited data is awaiting approval.
- The player can understand whether changes have been saved and whether approval is pending.

Reuse established round-entry components rather than creating a second scoring UI.

## 8.4 Delete Round

Delete is **admin-only**.

Use the standard destructive-action confirmation pattern.

## 8.5 Approve Round

Approve is **admin-only**.

When an admin approves a round:

- Clearly communicate approval.
- The backend performs the authoritative handicap update.
- Display the resulting state returned by the API.

Do not calculate or update handicap values independently in React.

---

# 9. Dashboard

The dashboard should be composed from reusable **widgets/cards**, not one large page component.

The dashboard must provide the following.

## 9.1 Recent Rounds Widget

Display the **three most recent rounds** using a compact table where appropriate.

Provide an appropriate empty state if the user has no rounds.

## 9.2 Handicap Trend Widget

Provide a responsive line chart showing handicap trend over time.

The chart should:

- Work in light and dark themes.
- Have accessible labels/alternative information.
- Avoid unnecessary visual decoration.
- Clearly communicate the trend.

Do not introduce a chart library until existing project dependencies and requirements have been inspected. Prefer a lightweight, well-supported solution.

If the backend does not expose the required historical handicap data, identify and raise the required backend/API work instead of fabricating data.

## 9.3 Performance Statistics Widgets

Create reusable statistic widgets for:

- GIR.
- FIR.
- Driving Accuracy.
- Sand per round.
- Putts per round.
- 1-putts per round.
- 3+ putts per round.
- Penalties.

### GIR

Display the percentage of greens hit in regulation per round.

### FIR

Display the percentage of fairways hit in regulation per round.

### Driving Accuracy

Display a donut chart representing:

- Hits.
- Left miss.
- Right miss.

### Sand per Round

Display the average number of sand shots/bunker interactions per round according to the backend's authoritative definition.

### Putts per Round

Display average putts per round.

### 1-Putts per Round

Display the average/frequency of one-putt holes according to available backend data.

### 3+ Putts per Round

Display the average/frequency of holes with three or more putts according to available backend data.

### Penalties

Display an appropriate penalty statistic based on available backend data.

Do not invent definitions where the backend domain model has not established them.

If required data is unavailable, explicitly identify the missing backend capability before implementation.

---

# 10. Dashboard Widget Design

Widgets should share a common visual language.

Each widget should support, where appropriate:

- Title.
- Optional icon.
- Optional contextual description.
- Primary value/content.
- Optional secondary metric.
- Loading state.
- Empty state.
- Error state.

Avoid making every widget visually identical. Use a small number of deliberate widget variants.

Charts should never be used simply for decoration.

---

# 11. Loading States

The application should use **skeleton loaders as the default loading experience for page content and widgets**.

Do not rely exclusively on a centered spinner for normal page loading.

Examples:

- Table skeleton.
- Grid/card skeleton.
- Stat-card skeleton.
- Chart skeleton.
- Page-header skeleton where appropriate.
- Form loading state where appropriate.

Skeletons should:

- Match the approximate shape of the content being loaded.
- Avoid excessive animation.
- Respect reduced-motion preferences.
- Work in both light and dark themes.
- Be reusable.

A spinner may still be appropriate for:

- Button submission state.
- Very short inline operations.
- Small local actions.
- Indeterminate operations where a skeleton would not make sense.

---

# 12. Responsive Design

The application must remain fully responsive.

Support:

- Desktop admin workflows.
- Tablet layouts.
- Mobile player workflows.

Do not treat mobile as merely a reduced desktop layout.

Pay particular attention to:

- Round score entry.
- Navigation.
- Tables.
- Grid/list switching.
- Forms.
- Modals.
- Dashboard widgets.
- Action buttons.

Maintain the existing 44px minimum touch-target principle.

Avoid hover-dependent interactions.

---

# 13. Navigation and Application Structure

Use the established application shell:

- Vertical navigation on the left.
- Application header.
- Profile/account menu in the top-right.
- Main content area.
- Fixed footer.
- Main page content scrolls independently between header and footer.

Navigation should use icons sparingly and consistently.

The navigation structure should evolve with actual approved modules rather than inventing speculative sections.

At minimum, the application information architecture will need to accommodate:

- Dashboard.
- Accounts.
- Courses.
- Rounds.
- Profile/account actions.

Role-based visibility must be respected.

---

# 14. Error, Empty and Success States

Every real data-driven screen should explicitly consider:

1. Loading.
2. Loaded with data.
3. Loaded with no data.
4. API failure.
5. Authorization failure.
6. Mutation success.
7. Mutation failure.
8. Unexpected application failure.

Do not leave these states to browser defaults.

Use shared design-system components and patterns.

---

# 15. Backend/API Reality Check

Before implementing each requested feature, inspect the backend.

For every requested UI capability:

- Identify the existing API endpoint.
- Identify request/response shape.
- Identify authorization rules.
- Identify validation rules.
- Identify missing functionality.

If the backend does not support the required capability:

1. Do not mock it as production functionality.
2. Do not invent an API contract without documenting it.
3. Create/raise the required backend issue.
4. Link the frontend issue to the backend issue.
5. Implement the frontend only to the extent justified by the agreed contract.

The backend remains authoritative for:

- Authorization.
- Handicap calculations.
- Round status.
- Approval.
- Account state.
- Business rules.

---

# 16. Component and Design-System Reuse

Use the existing component catalogue/design system as the source of truth.

Prefer shared:

- Buttons.
- Badges.
- Form fields.
- Inputs/selects.
- Alerts.
- Modals.
- Cards.
- Tables/lists.
- Statistics.
- Loading/skeleton components.
- Layout primitives.
- Icon conventions.
- Error/empty-state patterns.

Do not create page-specific versions of existing primitives.

If a genuinely reusable pattern is missing, consider extending the design system rather than solving the problem with a one-off component.

---

# 17. Implementation Discipline

Work incrementally.

For each module:

1. Confirm requirements.
2. Inspect backend/API support.
3. Identify dependencies.
4. Create/update the appropriate GitHub issue(s).
5. Implement shared primitives first where necessary.
6. Implement the feature.
7. Add tests.
8. Verify responsive behavior.
9. Verify light/dark themes.
10. Verify loading/empty/error/success states.
11. Verify authorization behavior.
12. Run appropriate test/build/lint checks.
13. Deploy where appropriate.
14. Verify real deployed behavior.
15. Update the GitHub issue and project status.

Do not bundle unrelated modules into one large implementation.

---

# 18. Product Principle

The application should feel like a **coherent premium SaaS product for golf/club administration**, not a collection of CRUD screens.

The overall experience should be:

- Modern.
- Professional.
- Clean.
- Trustworthy.
- Calm rather than visually noisy.
- Responsive.
- Consistent.
- Appropriate for official handicap/governance workflows.
- Efficient for administrators.
- Extremely usable on mobile for players.

Maintain the established visual/design-system decisions, including the emerald-led brand palette, polished Socx logo treatment, light/dark themes, restrained iconography, semantic status colors, responsive application shell, and reusable component architecture.

Use external reference pages only as inspiration for information architecture and interaction patterns. **Do not copy their design verbatim.**

---

# 19. First Step

Before writing feature code for this phase:

1. Review the current GHS frontend and backend state.
2. Review the existing components catalogue/design system and frontend architecture documentation.
3. Compare the requested Accounts → Courses/Tees → Rounds → Dashboard sequence against actual backend dependencies.
4. Identify backend gaps.
5. Produce a proposed Phase 6b implementation/backlog sequence with dependencies.
6. Identify which existing issues need to be updated and which new issues should be created.
7. Do not begin implementation until the backlog/dependency plan is presented for review and approved.
