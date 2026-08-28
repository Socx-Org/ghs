import type { ReactNode } from "react";
import { Flag } from "lucide-react";
import { Button } from "../Button";
import { EmptyState } from "../EmptyState";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "../Table";
import { Widget } from "../Widget";
import { RoundStatusBadge } from "./RoundStatusBadge";
import { EDITABLE_ROUND_STATUSES } from "../../types/domain";
import type { PlayerRoundListItem } from "../../types/domain";

function formatPlayedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface RecentRoundsWidgetProps {
  isLoading: boolean;
  isError: boolean;
  errorMessage?: ReactNode;
  // The caller's full round list -- this widget applies the design
  // doc's own "three most recent" cap itself (section 9.1), so callers
  // never have to remember to slice, and can't accidentally slice
  // differently in two places. Relies on the same newest-first ordering
  // GET /players/:playerId/rounds already guarantees server-side.
  rounds: PlayerRoundListItem[];
  onContinue: (roundId: string) => void;
  actions?: ReactNode;
}

// ghs#116 (design doc sections 9.1/10): the dashboard's first real
// Widget -- everything here was already on PlayerDashboardPage, just
// page-specific markup rather than a reusable shape. Deliberately a
// compact table, not a card grid -- three rows of date/status/action is
// exactly the "compact table where appropriate" the design doc asks for.
//
// isLoading/isError come straight from the caller's query (only it knows
// that), but "empty" is derived here, not passed in -- whether zero
// rounds counts as "empty" is this widget's own domain knowledge, not
// something every caller should have to recompute.
export function RecentRoundsWidget({ isLoading, isError, errorMessage, rounds, onContinue, actions }: RecentRoundsWidgetProps) {
  const recent = rounds.slice(0, 3);
  const status = isLoading ? "loading" : isError ? "error" : recent.length === 0 ? "empty" : "ready";

  return (
    <Widget
      title="Recent rounds"
      icon={Flag}
      status={status}
      errorMessage={errorMessage}
      actions={actions}
      emptyState={<EmptyState title="No rounds yet" description="Rounds you play and submit will show up here." />}
    >
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Date</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">Action</span>
            </TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {recent.map((round) => (
            <TableRow key={round.id}>
              <TableCell>{formatPlayedAt(round.playedAt)}</TableCell>
              <TableCell>
                <RoundStatusBadge status={round.status} />
              </TableCell>
              <TableCell>
                {EDITABLE_ROUND_STATUSES.has(round.status) && (
                  <Button variant="ghost" size="sm" onClick={() => onContinue(round.id)}>
                    Continue
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Widget>
  );
}
