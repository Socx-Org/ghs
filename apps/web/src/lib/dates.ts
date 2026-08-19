// ghs#94. A bare "YYYY-MM-DD" from <input type="date"> parsed via
// `new Date(str)` is treated as UTC midnight per spec -- displayed
// back later via toLocaleDateString() in a negative-UTC-offset
// timezone (e.g. the US), that shifts to the *previous* calendar day
// (review finding, PR #95). Constructing from explicit y/m/d parts
// uses local time instead, and noon avoids any remaining edge-of-day
// drift once this round-trips through an actual UTC timestamp.
export function playedAtToIsoString(dateInput: string): string {
  const [year, month, day] = dateInput.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12).toISOString();
}
