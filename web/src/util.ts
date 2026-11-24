import type { LL, TripPlan } from '@shared/types';
export const tz = 'America/New_York';
export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—';
export const fmtDayTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : 'unknown';
export const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
export const dist = (m: number) => (m >= 1000 ? `${(m / 1609.34).toFixed(1)} mi` : `${Math.round(m * 3.28084)} ft`);
export const EVENT_DATE = '2026-11-26';
export const toIso = (hhmm: string) => `${EVENT_DATE}T${hhmm}:00-05:00`;
export const mid = (p: LL[]): LL => p[Math.floor(p.length / 2)];
export const ago = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return 'unknown';
  const m = Math.round((now - Date.parse(iso)) / 60000);
  return m <= 0 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
export function summaryText(plan: TripPlan): string {
  const c = plan.candidates.find((x) => x.id === plan.selectedRouteId);
  if (!c) return `ParadePilot — no validated route from ${plan.request.origin.label} to ${plan.request.destination.label}.`;
  return [
    `ParadePilot trip (Thanksgiving, Nov 26 2026)`,
    `From: ${plan.request.origin.label}`,
    `To: ${plan.request.destination.label}`,
    `Route: ${c.label} — ${mins(c.durationS)}, leave by ${fmtTime(c.departAt)} to arrive by ${fmtTime(c.arriveAt)}`,
    `Why: ${c.reason}`,
    `Open in Google Maps: ${c.googleMapsUrl}`,
    `Note: closures known to ParadePilot do not carry over into Google Maps. Data: ${plan.sources.map((s) => `${s.label} (${s.mode})`).join(', ')}.`,
  ].join('\n');
}
