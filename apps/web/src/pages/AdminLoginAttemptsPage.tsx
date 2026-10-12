import { useQuery } from "@tanstack/react-query";
import { Alert, Card, CardBody, EmptyState, ListView, LoginOutcomeBadge, SessionStatusBadge, Skeleton, SortableTableHeaderCell, TableCell, TableHeaderCell, Tooltip } from "../components";
import { ApiError, listLoginAttempts } from "../lib/api";
import { LOGIN_OUTCOME_OPTIONS } from "../lib/domain-labels";
import { useTableSort } from "../lib/useTableSort";
import type { LoginAttemptListItem } from "../types/domain";

// ghs#233: the admin-only login/session audit log -- design doc's own
// §Design section. listLoginAttempts() relies entirely on the backend's
// own default page (same "fetch-all, narrow client-side via ListView"
// convention as listUsers/listAdminRounds, see admin-login-attempts.ts's
// own doc comment for why this endpoint shares GET /admin/users' exact
// pagination shape rather than GET /admin/rounds' unbounded one).
//
// Purely read-only -- no row actions exist for this table (an audit log
// isn't something an admin edits or deletes), unlike AdminAccountsPage/
// AdminRoundsListPage.

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// null/null/null (geo-IP not yet populated, ghs#234) renders as "--",
// same placeholder every other null-until-a-follow-up-issue field in
// this app uses (e.g. AdminAccountsPage's accountName for a non-player
// account) -- not a loading/error state to distinguish from a real one.
function locationLine(item: LoginAttemptListItem): string {
  const parts = [item.city, item.region, item.country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : "—";
}

// ghs#233 review fix: the Location column's own sort accessor -- the raw
// nullable fields, not locationLine()'s own "—" placeholder (same
// reasoning as AdminAccountsPage's accountSortName). String-comparing
// against the display placeholder was brittle (a label change or real
// data that happened to read "—" would silently break sorting) and
// recomputed locationLine() a second time for no reason.
function locationSortValue(item: LoginAttemptListItem): string | null {
  const parts = [item.city, item.region, item.country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

// ghs#236. A raw UA string ("Mozilla/5.0 (Windows NT 10.0; Win64; x64)
// AppleWebKit/537.36...") is long and not meaningfully something an
// admin sorts by -- rendered truncated with the full value in a
// Tooltip, same "truncate + Tooltip for the full value" treatment this
// app already has no other precedent for, but is the obvious fit here
// (same component AdminAccountsPage's own icon-only row actions use).
//
// Review fix: the trigger (a plain <span>/<p>, unlike every other
// Tooltip usage in this app, which wraps an already-focusable Button)
// needs its own `tabIndex={0}` -- Tooltip.tsx's own onFocus handler
// only ever fires via a real focus event, which a non-interactive
// element can never receive without one. Without this, the full value
// was reachable on hover/touch but genuinely unreachable by keyboard or
// screen-reader navigation.
const USER_AGENT_TRUNCATE_LENGTH = 40;

function truncateUserAgent(userAgent: string): string {
  return userAgent.length > USER_AGENT_TRUNCATE_LENGTH ? `${userAgent.slice(0, USER_AGENT_TRUNCATE_LENGTH)}…` : userAgent;
}

export default function AdminLoginAttemptsPage() {
  const attemptsQuery = useQuery({ queryKey: ["admin", "login-attempts"], queryFn: () => listLoginAttempts() });
  // Sorts by the raw ISO createdAt/sessionEndedAt, not their own
  // locale-formatted display strings -- same reasoning as every other
  // admin list's own Created/Played column (ghs#203).
  const attemptsSort = useTableSort(attemptsQuery.data?.items ?? [], {
    email: (item) => item.email,
    createdAt: (item) => item.createdAt,
    outcome: (item) => item.outcome,
    ipAddress: (item) => item.ipAddress,
    location: (item) => locationSortValue(item),
    sessionEndedAt: (item) => item.sessionEndedAt,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div>
        <h1 className="mt-4 text-2xl font-semibold text-text">Login Audit</h1>
        <p className="mt-2 text-sm text-text-muted">Every login attempt, successful or not, and the live status of the session it started.</p>
      </div>

      <Card className="mt-8">
        <CardBody>
          {attemptsQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          ) : attemptsQuery.isError ? (
            <Alert variant="error">{describeQueryError(attemptsQuery.error, "Couldn't load the login audit log. Try refreshing the page.")}</Alert>
          ) : (
            <ListView<LoginAttemptListItem>
              id="login-attempts"
              items={attemptsSort.sortedItems}
              getKey={(item) => item.id}
              searchPlaceholder="Search by email or IP address…"
              getSearchText={(item) => `${item.email} ${item.ipAddress}`}
              filters={[{ id: "outcome", label: "Outcome", getValue: (item) => item.outcome, options: LOGIN_OUTCOME_OPTIONS }]}
              tableHead={
                <>
                  <SortableTableHeaderCell columnId="email" sort={attemptsSort.sort} onSort={attemptsSort.toggleSort}>
                    Email
                  </SortableTableHeaderCell>
                  <SortableTableHeaderCell columnId="createdAt" sort={attemptsSort.sort} onSort={attemptsSort.toggleSort}>
                    Timestamp
                  </SortableTableHeaderCell>
                  <SortableTableHeaderCell columnId="outcome" sort={attemptsSort.sort} onSort={attemptsSort.toggleSort}>
                    Outcome
                  </SortableTableHeaderCell>
                  <SortableTableHeaderCell columnId="ipAddress" sort={attemptsSort.sort} onSort={attemptsSort.toggleSort}>
                    IP address
                  </SortableTableHeaderCell>
                  <TableHeaderCell>User agent</TableHeaderCell>
                  <SortableTableHeaderCell columnId="location" sort={attemptsSort.sort} onSort={attemptsSort.toggleSort}>
                    Location
                  </SortableTableHeaderCell>
                  <SortableTableHeaderCell columnId="sessionEndedAt" sort={attemptsSort.sort} onSort={attemptsSort.toggleSort}>
                    Session ended
                  </SortableTableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </>
              }
              renderTableRow={(item) => (
                <>
                  <TableCell>{item.email}</TableCell>
                  <TableCell>{formatTimestamp(item.createdAt)}</TableCell>
                  <TableCell>
                    <LoginOutcomeBadge outcome={item.outcome} />
                  </TableCell>
                  <TableCell>{item.ipAddress}</TableCell>
                  <TableCell>
                    {item.userAgent ? (
                      <Tooltip content={item.userAgent}>
                        <span tabIndex={0} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          {truncateUserAgent(item.userAgent)}
                        </span>
                      </Tooltip>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{locationLine(item)}</TableCell>
                  <TableCell>{item.sessionEndedAt ? formatTimestamp(item.sessionEndedAt) : "—"}</TableCell>
                  <TableCell>{item.sessionStatus ? <SessionStatusBadge status={item.sessionStatus} /> : "—"}</TableCell>
                </>
              )}
              renderCard={(item) => (
                <Card>
                  <CardBody className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-text">{item.email}</p>
                      <LoginOutcomeBadge outcome={item.outcome} />
                    </div>
                    <p className="text-xs text-text-muted">{formatTimestamp(item.createdAt)}</p>
                    <p className="text-xs text-text-muted">
                      {item.ipAddress} · {locationLine(item)}
                    </p>
                    {item.userAgent && (
                      <Tooltip content={item.userAgent}>
                        <p tabIndex={0} className="rounded text-xs text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          {truncateUserAgent(item.userAgent)}
                        </p>
                      </Tooltip>
                    )}
                    {item.sessionStatus && (
                      <div className="flex items-center gap-2">
                        <SessionStatusBadge status={item.sessionStatus} />
                        {item.sessionEndedAt && <span className="text-xs text-text-muted">{formatTimestamp(item.sessionEndedAt)}</span>}
                      </div>
                    )}
                  </CardBody>
                </Card>
              )}
              emptyState={<EmptyState title="No login attempts yet" description="Every login, successful or not, will show up here." />}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
