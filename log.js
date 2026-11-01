// The watering log: small pure helpers shared by the page and the daily alert job.
// An entry looks like { id: 1730000000000, date: "2026-10-26", inches: 0.5 }.

export function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isEntry(e) {
  return !!e && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) && Number.isFinite(e.inches)
    && e.inches > 0 && e.inches <= 10 && (typeof e.id === "number" || typeof e.id === "string");
}

/** Keeps valid entries from the last two weeks (the log stays tiny). */
export function cleanEntries(list, today) {
  const oldest = shiftDate(today, -13);
  return (Array.isArray(list) ? list : []).filter((e) => isEntry(e) && e.date >= oldest);
}

/** Combines two lists, keeping one copy of each id. */
export function mergeEntries(a, b) {
  const seen = new Map();
  for (const e of [...a, ...b]) if (isEntry(e) && !seen.has(String(e.id))) seen.set(String(e.id), e);
  return [...seen.values()];
}

/** Inches watered in the 7 days ending today (today and the 6 days before). */
export function wateredIn7Days(entries, today) {
  const since = shiftDate(today, -6);
  return cleanEntries(entries, today)
    .filter((e) => e.date >= since)
    .reduce((sum, e) => sum + e.inches, 0);
}
