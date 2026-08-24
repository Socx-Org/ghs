// ghs#155/#160: shared by every CSV-import parser (course-csv.ts,
// round-hole-csv.ts) -- mirrors react-hook-form's own
// register(..., { valueAsNumber: true }) behaviour (a real
// <input type="number">'s .valueAsNumber is a number or NaN, never a
// string), so a raw CSV cell (always a string) converts the same way
// the DOM does ahead of zod, for whichever schema each parser reuses
// from its own manual-entry form. Blank -> undefined (a genuinely
// missing value); non-blank -> Number() (NaN for non-numeric garbage,
// which those schemas already turn into the same "Enter a ..." message
// an empty manual field gets).
export function csvNumberOrUndefined(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}
