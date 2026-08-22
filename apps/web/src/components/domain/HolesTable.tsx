import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "../Table";
import type { FairwayResult, HoleScore } from "../../types/domain";

// ghs#147: extracted from AdminRoundReviewPage (#67) -- the second real
// consumer (RoundDetailsPage, the player's own round-detail view) is
// exactly the same hole-by-hole presentation, not worth a third
// duplication.

function fairwayLabel(result: FairwayResult | null): string {
  if (result === "hit") return "Hit";
  if (result === "missed_left") return "Missed L";
  if (result === "missed_right") return "Missed R";
  return "—";
}

export interface HolesTableProps {
  holes: { id: string; holeNumber: number; par: number }[];
  holeScores: HoleScore[];
}

export function HolesTable({ holes, holeScores }: HolesTableProps) {
  // Review finding, PR #148: pre-indexed once, not a linear .find()
  // re-scanning holeScores on every row -- O(holes + scores) instead of
  // O(holes × scores).
  const scoresByHoleNumber = new Map(holeScores.map((score) => [score.holeNumber, score]));

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Hole</TableHeaderCell>
          <TableHeaderCell>Par</TableHeaderCell>
          <TableHeaderCell>Strokes</TableHeaderCell>
          <TableHeaderCell>Putts</TableHeaderCell>
          <TableHeaderCell>GIR</TableHeaderCell>
          <TableHeaderCell>Fairway</TableHeaderCell>
          <TableHeaderCell>Sand</TableHeaderCell>
          <TableHeaderCell>Penalties</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {holes.map((hole) => {
          const score = scoresByHoleNumber.get(hole.holeNumber);
          return (
            <TableRow key={hole.id}>
              <TableCell className="font-medium">{hole.holeNumber}</TableCell>
              <TableCell>{hole.par}</TableCell>
              <TableCell>{score?.strokes ?? "—"}</TableCell>
              <TableCell>{score?.putts ?? "—"}</TableCell>
              <TableCell>{score ? (score.gir ? "Yes" : "No") : "—"}</TableCell>
              <TableCell>{score ? fairwayLabel(score.fairwayResult) : "—"}</TableCell>
              <TableCell>{score ? (score.inSand ? "Yes" : "No") : "—"}</TableCell>
              <TableCell>{score?.penalties ?? "—"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
