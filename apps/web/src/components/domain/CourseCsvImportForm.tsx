import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Alert } from "../Alert";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { FormField } from "../FormField";
import { Input } from "../Input";
import { List, ListItem } from "../List";
import { CourseCsvParseError, parseCourseCsv } from "../../lib/course-csv";
import type { ParsedCourseCsv } from "../../lib/course-csv";
import type { TeeConfigurationInput } from "../../types/domain";

export interface CourseCsvImportSubmitValue {
  name: string;
  city?: string;
  country?: string;
  teeConfigurations: TeeConfigurationInput[];
}

export interface CourseCsvImportFormProps {
  onSubmit: (value: CourseCsvImportSubmitValue) => Promise<void>;
}

// ghs#155: the CSV-upload alternative to CreateCoursePage's manual form.
// Parsing/grouping/validation itself lives in lib/course-csv.ts (framework-
// free, directly unit-tested against the two real sample files this issue
// was filed with) -- this component is just the read-file -> show-preview
// -> submit flow around it. The preview is shown before any submit
// happens (this issue's own explicit requirement) -- an admin sees every
// tee configuration found and whether each will import or be skipped
// (and why) before committing to anything.
export function CourseCsvImportForm({ onSubmit }: CourseCsvImportFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedCourseCsv | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setParsed(null);
    setParseError(null);
    setSubmitError(null);
    if (!file) return;
    try {
      const text = await file.text();
      setParsed(parseCourseCsv(text));
    } catch (error) {
      setParseError(error instanceof CourseCsvParseError ? error.message : "Couldn't read this file. Try again.");
    }
  }

  function reset() {
    setParsed(null);
    setParseError(null);
    setSubmitError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit() {
    if (!parsed) return;
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        name: parsed.name,
        city: parsed.city,
        country: parsed.country,
        // Only the valid outcomes' own already-converted input -- a
        // skipped tee configuration is never silently included just
        // because the course-level submit went ahead.
        teeConfigurations: parsed.teeConfigurations.filter((tc) => tc.valid).map((tc) => tc.input!),
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const validCount = parsed?.teeConfigurations.filter((tc) => tc.valid).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <FormField label="CSV file" helpText="One row per hole. See the design system docs for the expected column format.">
        <Input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} />
      </FormField>

      {parseError && <Alert variant="error">{parseError}</Alert>}

      {parsed && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-text">{parsed.name}</p>
            <p className="text-sm text-text-muted">{[parsed.city, parsed.country].filter(Boolean).join(", ") || "No location given"}</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-text">
              Tee configurations found ({validCount} of {parsed.teeConfigurations.length} will import)
            </h3>
            <List>
              {parsed.teeConfigurations.map((tc) => (
                <ListItem key={tc.configurationId} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-text">{tc.name}</span>
                    <Badge variant={tc.valid ? "success" : "warning"}>{tc.valid ? "Will import" : "Skipped"}</Badge>
                  </div>
                  {!tc.valid && <p className="text-xs text-text-muted">{tc.reason}</p>}
                </ListItem>
              ))}
            </List>
          </div>

          {submitError && <Alert variant="error">{submitError}</Alert>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={reset}>
              Choose a different file
            </Button>
            <Button type="button" isLoading={isSubmitting} onClick={handleSubmit}>
              Create course
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
