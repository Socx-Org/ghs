import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert } from "../Alert";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { FormField } from "../FormField";
import { Input } from "../Input";
import { List, ListItem } from "../List";
import { ApiError, addHoleScore } from "../../lib/api";
import { RoundHoleCsvParseError, parseRoundHoleCsv } from "../../lib/round-hole-csv";
import type { ParsedHoleRowOutcome } from "../../lib/round-hole-csv";

export interface RoundHoleCsvImportFormProps {
  roundId: string;
  // The round's real hole count (teeConfiguration.holes.length) -- the
  // valid 1..holeCount range for hole_number, known from the already-
  // created round/tee configuration, not from the file itself.
  holeCount: number;
}

type ImportResult = { outcome: "pending" | "success" | "error"; message?: string };

// ghs#160: RoundEntryPage's CSV-import alternative to filling in each
// HoleEntryCard by hand. Parsing/validation itself lives in
// lib/round-hole-csv.ts (framework-free, directly unit-tested) -- this
// component is the read-file -> show-preview -> import flow around it.
//
// Each valid row is its own independent addHoleScore call, attempted
// sequentially (not Promise.all -- no need to risk concurrent writes to
// the same round's hole scores when a simple, correct sequential loop
// costs nothing noticeable for a 9-or-18-row file). A per-hole failure
// is reported against that specific hole and never aborts the rest --
// this issue's own explicit requirement.
export function RoundHoleCsvImportForm({ roundId, holeCount }: RoundHoleCsvImportFormProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [outcomes, setOutcomes] = useState<ParsedHoleRowOutcome[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importResults, setImportResults] = useState<Record<number, ImportResult>>({});
  const [isImporting, setIsImporting] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setOutcomes(null);
    setParseError(null);
    setImportResults({});
    if (!file) return;
    try {
      const text = await file.text();
      setOutcomes(parseRoundHoleCsv(text, holeCount).outcomes);
    } catch (error) {
      setParseError(error instanceof RoundHoleCsvParseError ? error.message : "Couldn't read this file. Try again.");
    }
  }

  function reset() {
    setOutcomes(null);
    setParseError(null);
    setImportResults({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleImport() {
    if (!outcomes) return;
    setIsImporting(true);
    const validOutcomes = outcomes.filter((outcome) => outcome.valid);
    for (const outcome of validOutcomes) {
      setImportResults((prev) => ({ ...prev, [outcome.holeNumber]: { outcome: "pending" } }));
      try {
        await addHoleScore(roundId, outcome.input!);
        setImportResults((prev) => ({ ...prev, [outcome.holeNumber]: { outcome: "success" } }));
      } catch (error) {
        setImportResults((prev) => ({
          ...prev,
          [outcome.holeNumber]: { outcome: "error", message: error instanceof ApiError ? error.message : "Couldn't save this hole." },
        }));
      }
    }
    setIsImporting(false);
    await queryClient.invalidateQueries({ queryKey: ["rounds", roundId] });
  }

  const validCount = outcomes?.filter((outcome) => outcome.valid).length ?? 0;

  function statusFor(outcome: ParsedHoleRowOutcome): { variant: "success" | "warning" | "danger" | "neutral"; label: string; detail?: string } {
    if (!outcome.valid) return { variant: "warning", label: "Skipped", detail: outcome.reason };
    const result = importResults[outcome.holeNumber];
    if (!result) return { variant: "success", label: "Will import" };
    if (result.outcome === "pending") return { variant: "neutral", label: "Importing…" };
    if (result.outcome === "success") return { variant: "success", label: "Imported" };
    return { variant: "danger", label: "Failed", detail: result.message };
  }

  return (
    <div className="flex flex-col gap-6">
      <FormField label="CSV file" helpText="One row per hole -- hole_number, strokes, putts, gir, fairway_hit, in_sand, penalties.">
        <Input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} />
      </FormField>

      {parseError && <Alert variant="error">{parseError}</Alert>}

      {outcomes && (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 text-sm font-medium text-text">
              Holes found ({validCount} of {outcomes.length} will import)
            </h3>
            <List>
              {outcomes.map((outcome) => {
                const status = statusFor(outcome);
                return (
                  <ListItem key={outcome.holeNumber} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-text">Hole {outcome.holeNumber}</span>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                    {status.detail && <p className="text-xs text-text-muted">{status.detail}</p>}
                  </ListItem>
                );
              })}
            </List>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={reset}>
              Choose a different file
            </Button>
            <Button type="button" isLoading={isImporting} disabled={validCount === 0} onClick={handleImport}>
              Import
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
