// ghs#155/#229: shared by every CSV importer that needs a complete,
// non-duplicated, in-range 1..expectedCount set of hole numbers
// (course-csv.ts, tee-configuration-holes-csv.ts) -- extracted rather
// than re-implemented a second time, so the ordering this function
// encodes (range-checked, THEN duplicate-checked, THEN gap-checked)
// can't independently regress in two places.
//
// That specific order is a deliberate fix for a real bug (PR #158): an
// out-of-range hole number (e.g. 11-18 present in a supposedly 9-hole
// configuration) with no internal duplicates and no gap in 1-9
// previously passed straight through undetected, because every hole
// number was only ever checked against the OTHER rows' own numbers, not
// against the expected 1..expectedCount range itself.
//
// Returns a human-readable reason string on the first problem found, or
// null when the set is genuinely complete -- callers decide how to
// surface that (course-csv.ts marks just that tee configuration
// invalid; tee-configuration-holes-csv.ts throws, since there's only
// ever one configuration in play there).
export function checkHoleNumberCompleteness(holeNumbers: { raw: string; value: number }[], expectedCount: number): string | null {
  const seen = new Set<number>();
  for (const { raw, value } of holeNumbers) {
    if (!Number.isInteger(value) || value < 1 || value > expectedCount) {
      return `invalid hole number '${raw}' (must be an integer from 1 to ${expectedCount})`;
    }
    if (seen.has(value)) {
      return `duplicate hole number ${value}`;
    }
    seen.add(value);
  }
  const missing = Array.from({ length: expectedCount }, (_, index) => index + 1).filter((n) => !seen.has(n));
  if (missing.length > 0) {
    return `missing hole(s): ${missing.join(", ")}`;
  }
  return null;
}
