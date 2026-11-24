// Browser-safe application engine. The Express server wraps these functions as HTTP endpoints;
// the static (GitHub Pages) build calls them directly in the browser. No Node-only APIs here.
import { z } from 'zod';
import type { DisruptionEvent, ParadeInfo, Place as PlaceT, StatusResponse, TripPlan, TripStatus } from '../../shared/types';
import { geometryToLines, inBbox } from '../../shared/geo';
import { config } from './config';
import { getOfficialNotices, paradeCorridorEvent } from './adapters/officialNotices';
import { getVenueBusyness } from './adapters/besttimeCrowds';
import { getTraffic } from './adapters/tomtomTraffic';
import { geocode, googleRoutingAvailable } from './adapters/googleRoutes';
import { PRESET_PLACES } from './adapters/demoFixtures';
import { makeSimulatedEvent, planTrip, type PlanDeps } from './planner';
import { evaluateRoute } from './evaluate';
import { getTrip, newTripId, saveTrip } from './trips';
import { loadViewing } from './viewing';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const Place = z.object({
  label: z.string().min(1).max(200),
  location: z.object({ lat: z.number().min(40.4).max(41.0), lng: z.number().min(-74.4).max(-73.5) }),
  source: z.enum(['preset', 'google_geocoding', 'coordinates']),
});
export const PlanBody = z.object({
  origin: Place,
  destination: Place,
  arriveBy: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'arriveBy must be ISO-8601'),
  mode: z.enum(['WALK', 'DRIVE', 'TRANSIT']),
  priority: z.enum(['fastest', 'less_crowd', 'less_walking']),
  areasToVisit: z.array(z.string().max(60)).max(8).default([]),
});

export function createEngine(deps: PlanDeps = {}) {
  const trip = (id: string) => {
    const t = getTrip(id);
    if (!t) throw new HttpError(404, 'Unknown trip');
    return t;
  };

  return {
    async status(): Promise<StatusResponse> {
      const now = Date.now();
      const { status: n } = getOfficialNotices(now);
      const [v, t] = await Promise.all([getVenueBusyness({ now }), getTraffic([], { now })]);
      const g = googleRoutingAvailable();
      const sources = [
        { id: 'routing', label: 'Routing', provider: g ? 'Google Routes API' : 'Demo street-grid router', mode: g ? 'live' : 'simulated', lastFetchedAt: null, dataAsOf: null, freshness: 'unknown', note: g ? 'Google Maps key present.' : 'No Google Maps key — demo grid router.', sourceUrl: null },
        t.status, v.status, n,
      ] as StatusResponse['sources'];
      return {
        appMode: sources.some((s) => s.mode === 'live') ? 'live' : 'demo', sources,
        mapsBrowserKey: config.forceDemo ? null : config.googleBrowserKey || null,
        pollIntervalMs: config.pollIntervalMs, minPollIntervalMs: config.minPollIntervalMs,
        now: new Date(now).toISOString(), eventDate: config.eventDate, demoEndpointsEnabled: config.demoEndpoints,
      };
    },

    async places(q: string): Promise<{ places: PlaceT[]; note: string | null }> {
      return q ? geocode(q.slice(0, 120)) : { places: PRESET_PLACES, note: null };
    },

    async disruptions(bbox: [number, number, number, number]) {
      const now = Date.now();
      const notices = getOfficialNotices(now);
      const pts: [number, number][] = [[(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2]];
      const [traffic, venues] = await Promise.all([getTraffic(pts, { now }), getVenueBusyness({ now })]);
      const all: DisruptionEvent[] = [...notices.events, paradeCorridorEvent(new Date(now).toISOString()), ...traffic.events, ...venues.events];
      return {
        events: all.filter((e) => geometryToLines(e.geometry).some((l) => l.some((p) => inBbox(p, bbox)))),
        sources: [notices.status, traffic.status, venues.status],
      };
    },

    async venues(bbox: [number, number, number, number] | null) {
      const v = await getVenueBusyness({ now: Date.now() });
      return { events: bbox ? v.events.filter((e) => geometryToLines(e.geometry).some((l) => l.some((p) => inBbox(p, bbox)))) : v.events, source: v.status };
    },

    parade(): ParadeInfo {
      const now = Date.now();
      const { file } = getOfficialNotices(now);
      const view = loadViewing();
      return {
        corridor: paradeCorridorEvent(new Date(now).toISOString()),
        scheduleNote: 'Scheduled/estimated corridor from the NYC notice; typical timing 9am–noon. There is no verified live parade position feed.',
        viewingAreas: view.areas,
        officialLinks: view.officialLinks,
        closureSummary: file.notices.map((n) => ({ title: `${n.street}${n.boundaries ? ` (${n.boundaries})` : ''}`, startsAt: n.startsAt, endsAt: n.endsAt })),
      };
    },

    async plan(body: unknown): Promise<TripPlan> {
      const request = PlanBody.parse(body);
      const id = newTripId();
      const plan = await planTrip({ tripId: id, version: 1, request, deps });
      saveTrip({ id, request, version: 1, plan, pending: null, sims: [], stopId: null, lastTouched: Date.now() });
      return plan;
    },

    /** A replan is only a proposal: it never replaces the user's current route until select() is called. */
    async replan(id: string, viaViewingAreaId?: string | null): Promise<TripPlan> {
      const t = trip(id);
      const stop = viaViewingAreaId ? loadViewing().areas.find((a) => a.id === viaViewingAreaId) : null;
      if (viaViewingAreaId && !stop) throw new HttpError(400, 'Unknown viewing area');
      const plan = await planTrip({ tripId: t.id, version: t.version + 1, request: t.request, extraEvents: t.sims, stop, deps });
      t.pending = plan;
      t.stopId = stop?.id ?? null;
      saveTrip(t);
      return plan;
    },

    select(id: string, routeId: string, fromPending = false): TripPlan {
      const t = trip(id);
      const source = fromPending && t.pending ? t.pending : t.plan;
      if (!source.candidates.some((c) => c.id === routeId)) throw new HttpError(400, 'Unknown route for this plan');
      if (fromPending && t.pending) { t.plan = t.pending; t.pending = null; t.version = t.plan.version; }
      t.plan = { ...t.plan, selectedRouteId: routeId };
      saveTrip(t);
      return t.plan;
    },

    async tripStatus(id: string): Promise<TripStatus> {
      const t = trip(id);
      const now = Date.now();
      const sel = t.plan.candidates.find((c) => c.id === t.plan.selectedRouteId);
      if (!sel) throw new HttpError(400, 'No selected route');
      const notices = getOfficialNotices(now);
      const venues = await getVenueBusyness({ now });
      const traffic = await getTraffic(sel.path.filter((_, i) => i % 6 === 0), { now });
      const closures = [...notices.events, ...t.sims];
      const ev = evaluateRoute(
        { path: sel.path, streetLines: [sel.path], durationS: sel.durationS, mode: sel.mode },
        { now, arriveBy: Date.parse(t.request.arriveBy), closures, traffic: traffic.events, venues: venues.events, parade: paradeCorridorEvent(new Date(now).toISOString()), sources: [traffic.status, venues.status, notices.status] },
      );
      const status: TripStatus = {
        tripId: t.id, state: 'on_track', checkedAt: new Date(now).toISOString(), nextCheckAfterMs: config.pollIntervalMs,
        etaChangeMin: null, message: 'No new disruption affects your selected route.', alert: null, pendingPlan: null, alternativeRouteId: null,
      };
      if (ev.conflicts.length > 0) {
        const c = ev.conflicts[0];
        const event = closures.find((e) => e.id === c.eventId)!;
        const pending = await planTrip({ tripId: t.id, version: t.version + 1, request: t.request, extraEvents: t.sims, stop: null, deps });
        const alt = pending.candidates.find((x) => x.status !== 'blocked' && x.recommended) ?? null;
        t.pending = pending;
        saveTrip(t);
        status.state = 'action_needed';
        status.message = c.simulated ? 'A (simulated) disruption now overlaps your selected route.' : 'An official closure overlaps your selected route.';
        status.pendingPlan = pending;
        status.alternativeRouteId = alt?.id ?? null;
        const delta = alt ? Math.round((alt.durationS - sel.durationS) / 60) : null;
        status.alert = {
          title: c.simulated ? 'SIMULATED: street closed on your route' : 'Closure on your route',
          impact: `Your selected route runs into "${c.title.replace('SIMULATED incident: ', '')}". ${alt ? `A closure-free alternative is available (${Math.round(alt.durationS / 60)} min).` : 'No closure-free alternative was found — check official guidance.'}`,
          confidence: event.status === 'simulated' ? 'Simulated event — for demonstration only.' : event.status === 'official_confirmed' ? 'High: official notice. Map geometry is approximate.' : 'Lower: not officially confirmed.',
          sources: [{ name: event.sourceName, url: event.sourceUrl, status: event.status, observedAt: event.observedAt }],
          estimatedDelayMin: delta,
          lastKnown: `Last-known route: ${Math.round(sel.durationS / 60)} min, planned at ${t.plan.createdAt}.`,
          simulated: c.simulated,
        };
        status.etaChangeMin = delta;
      } else if (ev.status === 'caution' && ev.rules.some((r) => r.id === 'traffic' && r.outcome === 'warn')) {
        status.state = 'potential_delay';
        status.message = 'Vehicle traffic along your route is heavier than free-flow. No closures affect it.';
        if (ev.trafficDelayS !== null) status.etaChangeMin = Math.round(ev.trafficDelayS / 60);
      }
      return status;
    },

    simulateDisruption(id: string): { event: DisruptionEvent } {
      if (!config.demoEndpoints) throw new HttpError(403, 'Demo endpoints are disabled.');
      const t = trip(id);
      const sel = t.plan.candidates.find((c) => c.id === t.plan.selectedRouteId);
      if (!sel) throw new HttpError(400, 'No selected route to disrupt');
      const event = makeSimulatedEvent(sel.path, Date.parse(t.request.arriveBy), Date.now(), t.sims.length + 1);
      t.sims.push(event);
      saveTrip(t);
      return { event };
    },

    clearSimulation(id: string) {
      if (!config.demoEndpoints) throw new HttpError(403, 'Demo endpoints are disabled.');
      const t = trip(id);
      t.sims = [];
      t.pending = null;
      saveTrip(t);
      return { ok: true };
    },
  };
}
export type Engine = ReturnType<typeof createEngine>;
