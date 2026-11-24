import venuesJson from '../data/venues.json';
import type { DisruptionEvent, SourceStatus } from '../../../shared/types';
import { llToPoint } from '../../../shared/geo';
import { fetchJson, TtlCache } from '../cache';
import { config } from '../config';
import { freshness } from '../freshness';
import { simulatedVenues, type VenueDef } from './demoFixtures';

export const BESTTIME_DOCS = 'https://documentation.besttime.app/';

export function loadVenues(): VenueDef[] {
  return venuesJson.venues as VenueDef[];
}

export function parseVenueIds(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [slug, id] = part.split(':').map((s) => s?.trim());
    if (slug && id) out[slug] = id;
  }
  return out;
}

interface NowResponse {
  status?: string;
  analysis?: { venue_live_busyness?: number; venue_live_busyness_available?: boolean; venue_forecasted_busyness?: number };
}

/** Normalize a BestTime "forecasts/now" response. Live value is null (status unknown) when unavailable. */
export function normalizeBestTime(raw: NowResponse, venue: VenueDef, fetchedAt: string): DisruptionEvent {
  const a = raw.analysis;
  const liveOk = !!a?.venue_live_busyness_available && typeof a?.venue_live_busyness === 'number';
  const live = liveOk ? (a!.venue_live_busyness as number) : null;
  return {
    id: `besttime-${venue.slug}`,
    category: 'venue_busyness',
    title: `Venue busyness (proxy): ${venue.name}`,
    geometry: llToPoint([venue.lat, venue.lng]),
    geometryBasis: 'source',
    severity: live === null ? 'unknown' : live >= 85 ? 'high' : live >= 60 ? 'medium' : 'low',
    status: live === null ? 'unknown' : 'observed',
    startsAt: null,
    endsAt: null,
    observedAt: live === null ? null : fetchedAt, // BestTime "now" is live at request time
    fetchedAt,
    sourceName: 'BestTime Live Foot Traffic',
    sourceUrl: BESTTIME_DOCS,
    confidenceExplanation: live === null
      ? 'BestTime returned no live busyness for this venue. Unknown — not zero. Venue-level proxy only.'
      : 'Venue-level busyness proxy at this point only. It is not a sidewalk/street crowd sensor and is never used to declare a street blocked.',
    affectedModes: ['WALK', 'TRANSIT'],
    metrics: { busynessPct: live, forecastedPct: a?.venue_forecasted_busyness ?? null, venueSlug: venue.slug },
  };
}

const cache = new TtlCache<DisruptionEvent>(config.ttlVenues);
type Fetcher = (url: string, init: RequestInit) => Promise<any>;
export interface VenueResult { events: DisruptionEvent[]; status: SourceStatus }

export async function getVenueBusyness(
  opts: { now?: number; key?: string; ids?: string; forceDemo?: boolean; fetcher?: Fetcher; venues?: VenueDef[]; useCache?: boolean } = {},
): Promise<VenueResult> {
  const now = opts.now ?? Date.now();
  const key = opts.key ?? config.besttimeKey;
  const ids = parseVenueIds(opts.ids ?? config.besttimeVenueIds);
  const forceDemo = opts.forceDemo ?? config.forceDemo;
  const venues = opts.venues ?? loadVenues();
  const fetchedAt = new Date(now).toISOString();
  const fetcher: Fetcher = opts.fetcher ?? ((u, i) => fetchJson(u, i));
  const base = { id: 'venueBusyness' as const, label: 'Venue activity (proxy)', provider: 'BestTime Live Foot Traffic', sourceUrl: BESTTIME_DOCS };
  const simulate = (note: string): VenueResult => ({
    events: simulatedVenues(venues, fetchedAt),
    status: { ...base, mode: 'simulated', lastFetchedAt: fetchedAt, dataAsOf: null, freshness: 'unknown', note },
  });
  if (forceDemo) return simulate('Demo Simulation Mode is forced (DEMO_MODE=true). Simulated venue busyness.');
  if (!key) return simulate('No BESTTIME_API_KEY_PRIVATE configured — showing simulated venue busyness.');
  if (Object.keys(ids).length === 0) {
    return simulate('BestTime key set but no BESTTIME_VENUE_IDS mapped — showing simulated venue busyness. See README to register venues.');
  }
  const errors: string[] = [];
  const events: DisruptionEvent[] = [];
  await Promise.all(venues.map(async (v) => {
    const id = ids[v.slug];
    if (!id) {
      events.push({ ...normalizeBestTime({}, v, fetchedAt), confidenceExplanation: 'No BestTime venue ID configured for this venue. Unknown / no coverage.' });
      return;
    }
    const cached = opts.useCache === false ? undefined : cache.get(v.slug, now);
    if (cached) { events.push(cached); return; }
    try {
      const url = `https://besttime.app/api/v1/forecasts/now?api_key_private=${encodeURIComponent(key)}&venue_id=${encodeURIComponent(id)}`;
      const ev = normalizeBestTime(await fetcher(url, { method: 'POST' }), v, fetchedAt);
      cache.set(v.slug, ev, now);
      events.push(ev);
    } catch (e) {
      errors.push(String((e as Error).message).split(key).join('***'));
      events.push({ ...normalizeBestTime({}, v, fetchedAt), confidenceExplanation: 'BestTime request failed for this venue. Unknown.' });
    }
  }));
  const live = events.filter((e) => e.status === 'observed').length;
  const configured = venues.filter((v) => ids[v.slug]).length;
  if (live === 0 && errors.length > 0 && errors.length === configured) {
    return simulate(`BestTime requests failed (${errors[0].slice(0, 80)}) — falling back to simulated venue busyness.`);
  }
  return {
    events,
    status: {
      ...base, mode: 'live', lastFetchedAt: fetchedAt, dataAsOf: null,
      freshness: freshness(fetchedAt, config.staleVenues, now),
      note: `${live} of ${venues.length} venues have live busyness; the rest are unknown (no venue ID, no live data, or request failed). Venue-level proxy only.`,
    },
  };
}
