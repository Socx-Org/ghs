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

// ghs#169: the missing other half of the round-trip above -- pre-filling
// an <input type="date"> from an existing playedAt ISO string (e.g. to
// edit it). Reads the parsed Date's LOCAL year/month/day, not
// `.toISOString().slice(0, 10)`'s UTC ones -- the stored value is always
// local noon converted to UTC (via playedAtToIsoString above), so a
// UTC-based slice would reintroduce the exact class of off-by-one-day
// bug PR #95 fixed for the write direction, just for the read direction
// instead.
export function isoStringToDateInputValue(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ghs#168 review fix: `new Date().toISOString().slice(0, 10)` reads UTC
// date parts, not local ones -- for a negative-UTC-offset caller, this
// silently defaults an <input type="date"> to tomorrow whenever "now" has
// already crossed local midnight but not UTC midnight yet. Same
// local-parts fix as isoStringToDateInputValue above, applied to `new
// Date()` (already local) instead of a parsed ISO string.
export function today(): string {
  return isoStringToDateInputValue(new Date().toISOString());
}
