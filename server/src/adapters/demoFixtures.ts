// Deterministic seeded sample data for Demo Simulation Mode. Everything produced from here is tagged
// status: "simulated" / mode: "simulated" and must never be presented as live.
import type { DisruptionEvent, LL, Place } from '../../../shared/types';
import { haversineM, llToPoint } from '../../../shared/geo';
import { nodeLL } from '../grid';

export const SIM_SOURCE = 'ParadePilot demo fixtures';

/** Seeded to look like a parade-morning pattern around Midtown. Speeds in km/h, times in seconds. */
const TRAFFIC_SEEDS: { id: string; name: string; at: LL; free: number; cur: number; freeT: number; curT: number }[] = [
  { id: 'sim-t-10th-34', name: '10th Ave near W 34th St', at: nodeLL('tenth', 34), free: 40, cur: 12, freeT: 40, curT: 135 },
  { id: 'sim-t-9th-42', name: '9th Ave near W 42nd St', at: nodeLL('ninth', 42), free: 38, cur: 9, freeT: 38, curT: 160 },
  { id: 'sim-t-8th-30', name: '8th Ave near W 30th St', at: nodeLL('eighth', 30), free: 36, cur: 14, freeT: 40, curT: 115 },
  { id: 'sim-t-8th-45', name: '8th Ave near W 45th St', at: nodeLL('eighth', 45), free: 35, cur: 8, freeT: 40, curT: 190 },
  { id: 'sim-t-5th-28', name: '5th Ave near E 28th St', at: nodeLL('fifth', 28), free: 34, cur: 24, freeT: 30, curT: 42 },
  { id: 'sim-t-madison-45', name: 'Madison Ave near E 45th St', at: nodeLL('madison', 45), free: 33, cur: 28, freeT: 30, curT: 36 },
  { id: 'sim-t-park-40', name: 'Park Ave near E 40th St', at: nodeLL('park', 40), free: 40, cur: 31, freeT: 35, curT: 45 },
  { id: 'sim-t-lex-33', name: 'Lexington Ave near E 33rd St', at: nodeLL('lex', 33), free: 32, cur: 29, freeT: 30, curT: 33 },
  { id: 'sim-t-11th-30', name: '11th Ave near W 30th St', at: nodeLL('eleventh', 30), free: 45, cur: 30, freeT: 40, curT: 58 },
  { id: 'sim-t-col-66', name: 'Columbus Ave near W 66th St', at: nodeLL('col', 66), free: 34, cur: 13, freeT: 30, curT: 80 },
  { id: 'sim-t-ams-72', name: 'Amsterdam Ave near W 72nd St', at: nodeLL('ams', 72), free: 34, cur: 26, freeT: 30, curT: 38 },
  { id: 'sim-t-7th-25', name: '7th Ave near W 25th St', at: nodeLL('seventh', 25), free: 36, cur: 15, freeT: 40, curT: 100 },
  { id: 'sim-t-6th-18', name: '6th Ave near W 18th St', at: nodeLL('sixth', 18), free: 36, cur: 20, freeT: 40, curT: 75 },
];

export const SIM_VENUE_BUSYNESS: Record<string, number> = {
  'macys-herald-square': 92,
  'bryant-park': 78,
  'times-square': 88,
  'rockefeller-center': 71,
  'grand-central': 55,
  'columbus-circle': 69,
  'penn-station': 60,
};

export function severityFromRatio(ratio: number | null, roadClosure = false): DisruptionEvent['severity'] {
  if (roadClosure) return 'high';
  if (ratio === null || !Number.isFinite(ratio)) return 'unknown';
  if (ratio < 0.4) return 'high';
  if (ratio < 0.7) return 'medium';
  return 'low';
}

export function simulatedTraffic(samplePoints: LL[], fetchedAt: string, radiusM = 350): DisruptionEvent[] {
  const out: DisruptionEvent[] = [];
  for (const s of TRAFFIC_SEEDS) {
    if (samplePoints.length && !samplePoints.some((p) => haversineM(p, s.at) < radiusM)) continue;
    const ratio = s.cur / s.free;
    out.push({
      id: s.id,
      category: 'vehicle_traffic',
      title: `Vehicle traffic: ${s.name}`,
      geometry: llToPoint(s.at),
      geometryBasis: 'illustrative',
      severity: severityFromRatio(ratio),
      status: 'simulated',
      startsAt: null,
      endsAt: null,
      observedAt: null,
      fetchedAt,
      sourceName: `${SIM_SOURCE} (stand-in for TomTom Traffic Flow)`,
      sourceUrl: null,
      confidenceExplanation: 'Simulated vehicle-flow sample. Vehicle congestion only — not pedestrian density.',
      affectedModes: ['DRIVE'],
      metrics: {
        currentSpeedKmh: s.cur, freeFlowSpeedKmh: s.free, currentTravelTimeS: s.curT,
        freeFlowTravelTimeS: s.freeT, roadClosure: false, ratio: Number(ratio.toFixed(2)),
      },
    });
  }
  return out;
}

export interface VenueDef { slug: string; name: string; lat: number; lng: number }

export function simulatedVenues(venues: VenueDef[], fetchedAt: string): DisruptionEvent[] {
  return venues.map((v) => {
    const val = SIM_VENUE_BUSYNESS[v.slug] ?? null;
    return {
      id: `sim-venue-${v.slug}`,
      category: 'venue_busyness' as const,
      title: `Venue busyness (proxy): ${v.name}`,
      geometry: llToPoint([v.lat, v.lng]),
      geometryBasis: 'source' as const,
      severity: val === null ? ('unknown' as const) : val >= 85 ? ('high' as const) : val >= 60 ? ('medium' as const) : ('low' as const),
      status: 'simulated' as const,
      startsAt: null,
      endsAt: null,
      observedAt: null,
      fetchedAt,
      sourceName: `${SIM_SOURCE} (stand-in for BestTime Live Foot Traffic)`,
      sourceUrl: null,
      confidenceExplanation: 'Simulated venue-level busyness. Not a sidewalk or street-segment crowd measurement.',
      affectedModes: ['WALK', 'TRANSIT'] as ('WALK' | 'TRANSIT')[],
      metrics: { busynessPct: val, venueSlug: v.slug },
    };
  });
}

/** Presets so the demo works without Places/Geocoding keys. Coordinates are approximate landmarks. */
export const PRESET_PLACES: Place[] = [
  { label: 'Hudson Yards (11th Ave & W 33rd St)', location: { lat: 40.7539, lng: -74.0021 }, source: 'preset' },
  { label: 'Koreatown (5th Ave & W 32nd St)', location: { lat: 40.7476, lng: -73.9853 }, source: 'preset' },
  { label: 'Penn Station (8th Ave & W 33rd St)', location: { lat: 40.7506, lng: -73.9935 }, source: 'preset' },
  { label: 'Port Authority (8th Ave & W 41st St)', location: { lat: 40.7569, lng: -73.9902 }, source: 'preset' },
  { label: 'Grand Central Terminal (E 42nd St)', location: { lat: 40.7527, lng: -73.9772 }, source: 'preset' },
  { label: 'Bryant Park (W 42nd St & 6th Ave)', location: { lat: 40.7536, lng: -73.9832 }, source: 'preset' },
  { label: 'Rockefeller Center (5th Ave & W 50th St)', location: { lat: 40.7587, lng: -73.9787 }, source: 'preset' },
  { label: "Hell's Kitchen (9th Ave & W 46th St)", location: { lat: 40.7607, lng: -73.9915 }, source: 'preset' },
  { label: 'Madison Square Park (5th Ave & E 23rd St)', location: { lat: 40.7425, lng: -73.988 }, source: 'preset' },
  { label: 'Chelsea Market (9th Ave & W 16th St)', location: { lat: 40.7424, lng: -74.0061 }, source: 'preset' },
  { label: 'Union Square (14th St & Broadway)', location: { lat: 40.7359, lng: -73.9911 }, source: 'preset' },
  { label: 'Lincoln Center (Columbus Ave & W 65th St)', location: { lat: 40.7725, lng: -73.9835 }, source: 'preset' },
  { label: 'Columbus Circle (59th St & 8th Ave)', location: { lat: 40.7681, lng: -73.9819 }, source: 'preset' },
  { label: 'American Museum of Natural History (W 79th St)', location: { lat: 40.7813, lng: -73.974 }, source: 'preset' },
  { label: 'Metropolitan Museum of Art (5th Ave & E 82nd St)', location: { lat: 40.7794, lng: -73.9632 }, source: 'preset' },
];
