import { describe, expect, it } from 'vitest';
import { freshness } from '../src/freshness';
import { normalizeTomTom, getTraffic } from '../src/adapters/tomtomTraffic';
import { normalizeBestTime, getVenueBusyness, parseVenueIds } from '../src/adapters/besttimeCrowds';
import { parseRoutesResponse, googleMapsUrl } from '../src/adapters/googleRoutes';
import { createEngine } from '../src/engine';
import { PRESET_PLACES } from '../src/adapters/demoFixtures';
import { evaluateRoute } from '../src/evaluate';
import { paradeCorridorEvent } from '../src/adapters/officialNotices';
import { planOnGrid, blockedNodes, nodeLL } from '../src/grid';

const NOW = Date.parse('2026-11-26T14:00:00Z');

describe('stale-data handling', () => {
  it('classifies fresh, stale and unknown timestamps', () => {
    expect(freshness('2026-11-26T13:55:00Z', 15 * 60_000, NOW)).toBe('fresh');
    expect(freshness('2026-11-26T12:00:00Z', 15 * 60_000, NOW)).toBe('stale');
    expect(freshness(null, 15 * 60_000, NOW)).toBe('unknown');
    expect(freshness('not-a-date', 15 * 60_000, NOW)).toBe('unknown');
  });
  it('turns stale sources into a route warning', () => {
    const p: [number, number][] = [nodeLL('seventh', 20), nodeLL('fifth', 20)];
    const r = evaluateRoute(
      { path: p, streetLines: [p], durationS: 600, mode: 'WALK' },
      { now: NOW, arriveBy: NOW + 3600_000, closures: [], traffic: [], venues: [], parade: paradeCorridorEvent('x'),
        sources: [{ id: 'traffic', label: 'Vehicle traffic', provider: 'TomTom', mode: 'live', lastFetchedAt: null, dataAsOf: null, freshness: 'stale', note: '', sourceUrl: null }] },
    );
    expect(r.rules.find((x) => x.id === 'freshness')?.outcome).toBe('warn');
    expect(r.flags.some((f) => f.includes('Stale'))).toBe(true);
  });
});

describe('data normalization', () => {
  it('maps TomTom flow to a vehicle_traffic event without inventing an observation time', () => {
    const ev = normalizeTomTom({ flowSegmentData: { currentSpeed: 8, freeFlowSpeed: 30, currentTravelTime: 120, freeFlowTravelTime: 30, confidence: 0.9, roadClosure: false } }, [40.75, -73.99], 'f')!;
    expect(ev.category).toBe('vehicle_traffic');
    expect(ev.severity).toBe('high');
    expect(ev.observedAt).toBeNull();
    expect(ev.affectedModes).toEqual(['DRIVE']);
    expect(normalizeTomTom({}, [0, 0], 'f')).toBeNull();
  });
  it('keeps BestTime busyness unknown (null) when live data is unavailable', () => {
    const v = { slug: 's', name: 'V', lat: 40.75, lng: -73.99 };
    const none = normalizeBestTime({ analysis: { venue_live_busyness_available: false } }, v, 'f');
    expect(none.status).toBe('unknown');
    expect(none.metrics?.busynessPct).toBeNull();
    const live = normalizeBestTime({ analysis: { venue_live_busyness_available: true, venue_live_busyness: 88 } }, v, 'f');
    expect(live.status).toBe('observed');
    expect(live.severity).toBe('high');
    expect(live.geometry.type).toBe('Point');
  });
  it('parses venue id mapping and Google Routes responses', () => {
    expect(parseVenueIds('a:ven_1, b:ven_2')).toEqual({ a: 'ven_1', b: 'ven_2' });
    const routes = parseRoutesResponse({ routes: [{ duration: '600s', distanceMeters: 800, polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }, legs: [{ steps: [{ navigationInstruction: { instructions: 'Head north' }, distanceMeters: 800, staticDuration: '600s', travelMode: 'WALK', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } }] }] }] }, 'WALK');
    expect(routes[0].durationS).toBe(600);
    expect(routes[0].steps[0].instruction).toBe('Head north');
    expect(googleMapsUrl({ lat: 40.7, lng: -74 }, { lat: 40.8, lng: -73.9 }, 'WALK')).toContain('travelmode=walking');
  });
});

describe('simulation fallback', () => {
  it('uses simulated traffic and venues when no keys are present', async () => {
    const t = await getTraffic([nodeLL('eighth', 45)], { key: '', forceDemo: false, now: NOW });
    expect(t.status.mode).toBe('simulated');
    expect(t.events.every((e) => e.status === 'simulated')).toBe(true);
    const v = await getVenueBusyness({ key: '', now: NOW });
    expect(v.status.mode).toBe('simulated');
    expect(v.events.every((e) => e.status === 'simulated')).toBe(true);
  });
  it('falls back to simulation (with an explanatory note) when the live API fails', async () => {
    const t = await getTraffic([nodeLL('eighth', 45)], { key: 'k', now: NOW, useCache: false, fetcher: async () => { throw new Error('HTTP 403 for key=k'); } });
    expect(t.status.mode).toBe('simulated');
    expect(t.status.note).toContain('falling back');
    expect(t.status.note).not.toContain('key=k');
  });
  it('uses live data when the API answers', async () => {
    const t = await getTraffic([nodeLL('eighth', 45)], { key: 'k', now: NOW, useCache: false, fetcher: async () => ({ flowSegmentData: { currentSpeed: 20, freeFlowSpeed: 30, currentTravelTime: 40, freeFlowTravelTime: 30 } }) });
    expect(t.status.mode).toBe('live');
    expect(t.events[0].status).toBe('observed');
  });
});

describe('demo planning end to end', () => {
  it('routes around closures and never recommends a blocked route', async () => {
    const eng = createEngine({ useGoogle: false });
    const plan = await eng.plan({ origin: PRESET_PLACES[0], destination: PRESET_PLACES[1], arriveBy: '2026-11-26T11:00:00-05:00', mode: 'WALK', priority: 'fastest', areasToVisit: [] });
    const rec = plan.candidates.find((c) => c.recommended)!;
    expect(rec.status).not.toBe('blocked');
    expect(rec.conflicts).toHaveLength(0);
    expect(plan.candidates.some((c) => c.status === 'blocked')).toBe(true);
    expect(plan.sources.find((s) => s.id === 'routing')?.mode).toBe('simulated');
  });
  it('reports transit as unsupported in demo mode with a link-out instead of fabricating a route', async () => {
    const eng = createEngine({ useGoogle: false });
    const plan = await eng.plan({ origin: PRESET_PLACES[0], destination: PRESET_PLACES[1], arriveBy: '2026-11-26T11:00:00-05:00', mode: 'TRANSIT', priority: 'fastest', areasToVisit: [] });
    expect(plan.candidates).toHaveLength(0);
    expect(plan.fallbackLink).toContain('travelmode=transit');
    expect(plan.briefing.verdict).toBe('no_valid_route');
  });
  it('detects a simulated disruption, proposes an alternative, and does not switch silently', async () => {
    const eng = createEngine({ useGoogle: false });
    const plan = await eng.plan({ origin: PRESET_PLACES[0], destination: PRESET_PLACES[1], arriveBy: '2026-11-26T11:00:00-05:00', mode: 'WALK', priority: 'fastest', areasToVisit: [] });
    expect((await eng.tripStatus(plan.tripId)).state).toBe('on_track');
    eng.simulateDisruption(plan.tripId);
    const st = await eng.tripStatus(plan.tripId);
    expect(st.state).toBe('action_needed');
    expect(st.alert?.simulated).toBe(true);
    expect(st.alternativeRouteId).toBeTruthy();
    // selected route unchanged until the user switches
    expect(eng.select(plan.tripId, plan.selectedRouteId!).selectedRouteId).toBe(plan.selectedRouteId);
    const switched = eng.select(plan.tripId, st.alternativeRouteId!, true);
    expect(switched.selectedRouteId).toBe(st.alternativeRouteId);
  });
  it('grid router treats nodes on closures as impassable', () => {
    const blocked = blockedNodes({ closures: [[nodeLL('sixth', 23), nodeLL('sixth', 42)]] });
    expect(blocked.has('sixth:30')).toBe(true);
    const r = planOnGrid({ start: nodeLL('seventh', 30), end: nodeLL('fifth', 30), mode: 'WALK', closures: [[nodeLL('sixth', 23), nodeLL('sixth', 42)]] })!;
    expect(r.nodes.some((n) => n.startsWith('sixth:') && Number(n.split(':')[1]) >= 23 && Number(n.split(':')[1]) <= 42)).toBe(false);
  });
});
