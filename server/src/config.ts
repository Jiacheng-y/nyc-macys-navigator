
const env: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? (process.env as Record<string, string | undefined>) : {};
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(v.toLowerCase()));
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  /** true when running inside the static web build (no Node server). */
  browser: typeof window !== 'undefined',
  port: num(env.PORT, 8787),
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
  /** Force every adapter to use seeded simulation data, even when keys exist. */
  forceDemo: bool(env.DEMO_MODE, false),
  googleServerKey: env.GOOGLE_MAPS_SERVER_KEY || '',
  googleBrowserKey: env.GOOGLE_MAPS_BROWSER_KEY || '',
  tomtomKey: env.TOMTOM_API_KEY || '',
  besttimeKey: env.BESTTIME_API_KEY_PRIVATE || '',
  /** "slug:ven_xxx,slug2:ven_yyy" — see server/src/data/venues.json for slugs. */
  besttimeVenueIds: env.BESTTIME_VENUE_IDS || '',
  adminToken: env.ADMIN_TOKEN || '',
  demoEndpoints: bool(env.ENABLE_DEMO_ENDPOINTS, true),
  eventDate: '2026-11-26',
  // Cache TTLs (ms)
  ttlTraffic: num(env.TTL_TRAFFIC_MS, 60_000),
  ttlVenues: num(env.TTL_VENUES_MS, 300_000),
  ttlRoutes: num(env.TTL_ROUTES_MS, 120_000),
  // Freshness thresholds (ms)
  staleTraffic: num(env.STALE_TRAFFIC_MS, 15 * 60_000),
  staleVenues: num(env.STALE_VENUES_MS, 30 * 60_000),
  staleNotices: num(env.STALE_NOTICES_MS, 72 * 3_600_000),
  // Client polling
  pollIntervalMs: Math.max(15_000, num(env.POLL_INTERVAL_MS, 30_000)),
  minPollIntervalMs: 15_000,
  rateLimitPerMin: num(env.RATE_LIMIT_PER_MIN, 120),
};
export type Config = typeof config;
/** Browser build: inject keys/flags at startup. */
export function configure(p: Partial<Config>) { Object.assign(config, p); }
