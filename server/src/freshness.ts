export type Freshness = 'fresh' | 'stale' | 'unknown';
/** Classify a timestamp against a staleness threshold. Missing/invalid timestamps are "unknown", never "fresh". */
export function freshness(timestamp: string | null | undefined, maxAgeMs: number, now = Date.now()): Freshness {
  if (!timestamp) return 'unknown';
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return 'unknown';
  return now - t > maxAgeMs ? 'stale' : 'fresh';
}
export const ageMinutes = (timestamp: string | null, now = Date.now()) =>
  timestamp && !Number.isNaN(Date.parse(timestamp)) ? Math.round((now - Date.parse(timestamp)) / 60000) : null;
