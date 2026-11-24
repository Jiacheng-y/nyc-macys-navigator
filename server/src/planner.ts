import type {
  DisruptionEvent, LL, LatLng, RouteCandidate, SourceStatus, TravelMode, TripPlan, TripRequest, ViewingArea,
} from '../../shared/types';
import { haversineM, llToLineString, sampleAlong, sliceByFraction, geometryToLines } from '../../shared/geo';
import { config } from './config';
import { getOfficialNotices, paradeCorridorEvent } from './adapters/officialNotices';
import { getVenueBusyness } from './adapters/besttimeCrowds';
import { getTraffic } from './adapters/tomtomTraffic';
import { computeRoutes, googleMapsUrl, googleRoutingAvailable, ROUTES_DOCS, type RawRoute } from './adapters/googleRoutes';
import { backtrackEstimateS, planOnGrid, viaPoints, type GridRoute } from './grid';
import { evaluateRoute, type EvalContext, type EvalResult } from './evaluate';
import { buildBriefing } from './briefing';
import { windowsOverlap } from '../../shared/geo';

export interface PlanDeps {
  getNotices?: typeof getOfficialNotices;
  getVenues?: typeof getVenueBusyness;
  getTraffic?: typeof getTraffic;
  routes?: typeof computeRoutes;
  /** Override Google availability (tests). */
  useGoogle?: boolean;
}

export interface PlanInput {
  tripId: string;
  version: number;
  request: TripRequest;
  extraEvents?: DisruptionEvent[];
  stop?: ViewingArea | null;
  now?: number;
  deps?: PlanDeps;
  skipBaseline?: boolean;
}

interface Gen {
  id: string;
  label: string;
  provider: RouteCandidate['provider'];
  providerNote: string;
  raw: RawRoute;
  waypointsForUrl: LL[];
  nodes?: string[];
}

const SPEED_EST: Record<TravelMode, number> = { WALK: 1.35, DRIVE: 5, TRANSIT: 3.5 };
const ll = (l: LatLng): LL => [l.lat, l.lng];
const ts = (s: string | null) => (s ? Date.parse(s) : null);

const toRaw = (g: GridRoute, mode: TravelMode): RawRoute => ({
  path: g.path, durationS: g.durationS, distanceM: g.distanceM, walkingM: mode === 'DRIVE' ? null : g.distanceM, steps: g.steps, streetLines: [g.path],
});

function joinGrid(a: GridRoute, b: GridRoute, stopLabel: string): GridRoute {
  const steps = [...a.steps.slice(0, -1), { instruction: `Arrive at viewing area: ${stopLabel} (optional stop)`, distanceM: null, durationS: null, kind: 'other' as const, transit: null }, ...b.steps];
  return { path: [...a.path, ...b.path.slice(1)], nodes: [...a.nodes, ...b.nodes], distanceM: a.distanceM + b.distanceM, durationS: a.durationS + b.durationS, steps };
}

const stage = (s: TripPlan['stageLog'][number]['stage'], now: number) => ({ stage: s, at: new Date(now).toISOString() });

export async function planTrip(input: PlanInput): Promise<TripPlan> {
  const now = input.now ?? Date.now();
  const { request: req } = input;
  const deps = input.deps ?? {};
  const stageLog: TripPlan['stageLog'] = [stage('collecting', Date.now())];
  const arriveBy = Date.parse(req.arriveBy);
  const o = ll(req.origin.location), d = ll(req.destination.location);
  const limitations: string[] = [];
  const stop = input.stop ?? null;

  // --- 1) Collect: notices, venue busyness, early traffic — concurrently.
  const straight = sampleAlong([o, ...(stop ? [ll(stop.location)] : []), d], 700).slice(0, 10);
  const [notices, venues, trafficEarly] = await Promise.all([
    Promise.resolve((deps.getNotices ?? getOfficialNotices)(now)),
    (deps.getVenues ?? getVenueBusyness)({ now }),
    (deps.getTraffic ?? getTraffic)(straight, { now }),
  ]);
  stageLog.push(stage('relevance', Date.now()));
  const parade = paradeCorridorEvent(new Date(now).toISOString());
  const sims = (input.extraEvents ?? []).filter((e) => e.category === 'simulated');
  const closures = [...notices.events, ...sims];

  const estDur = Math.max(600, (haversineM(o, d) * 1.35) / SPEED_EST[req.mode]);
  const estWindow: [number, number] = [arriveBy - estDur * 1000, arriveBy];
  const activeLines = closures
    .filter((c) => c.affectedModes.includes(req.mode) && windowsOverlap(estWindow[0], estWindow[1], ts(c.startsAt), ts(c.endsAt)))
    .flatMap((c) => geometryToLines(c.geometry));
  const crowdLines = [geometryToLines(parade.geometry)[0], ...activeLines];
  const congestion = req.mode === 'DRIVE'
    ? trafficEarly.events.filter((e) => e.severity === 'high').map((e) => ({ at: geometryToLines(e.geometry)[0][0], factor: 1.8 }))
    : [];

  // --- 2) Candidate routes
  const useGoogle = deps.useGoogle ?? googleRoutingAvailable();
  const routesFn = deps.routes ?? computeRoutes;
  let traffic = trafficEarly;
  const gens: Gen[] = [];
  let routingStatus: SourceStatus;
  let fallbackLink: string | null = null;
  let naiveNodes: string[] | null = null;
  let googleOk = false;

  const stopLL = stop ? ll(stop.location) : null;
  const gridPlan = (opts: { ignoreClosures?: boolean; avoidCrowdLines?: boolean }) => {
    const base = { mode: req.mode, closures: activeLines, crowdLines, congestion, ...opts };
    if (!stopLL) return planOnGrid({ start: o, end: d, ...base });
    const a = planOnGrid({ start: o, end: stopLL, ...base }), b = planOnGrid({ start: stopLL, end: d, ...base });
    return a && b ? { ...joinGrid(a, b, stop!.name), startBlocked: a.startBlocked, endBlocked: b.endBlocked, startSnapM: a.startSnapM, endSnapM: b.endSnapM } : null;
  };

  const evaluateAll = (cands: Gen[], tr = traffic): { gen: Gen; ev: EvalResult }[] => {
    const ctx: EvalContext = {
      now, arriveBy, closures, traffic: tr.events, venues: venues.events, parade,
      sources: [tr.status, venues.status, notices.status],
    };
    return cands.map((gen) => ({ gen, ev: evaluateRoute({ path: gen.raw.path, streetLines: gen.raw.streetLines, durationS: gen.raw.durationS, mode: req.mode }, ctx) }));
  };

  if (useGoogle) {
    try {
      const depart = Math.max(now + 60_000, arriveBy - 30 * 60_000);
      const intermediates = stopLL ? [{ location: stop!.location, via: false }] : undefined;
      const raws = await routesFn({
        origin: req.origin.location, destination: req.destination.location, mode: req.mode,
        alternatives: !intermediates, intermediates,
        departureTime: req.mode === 'DRIVE' && arriveBy > now ? new Date(depart).toISOString() : undefined,
        arrivalTime: req.mode === 'TRANSIT' && arriveBy > now ? new Date(arriveBy).toISOString() : undefined,
      });
      raws.slice(0, 3).forEach((raw, i) => gens.push({
        id: `g${i + 1}`, label: `Google route ${i + 1}`, provider: 'google_routes',
        providerNote: 'Google Routes API. Google does not know about ParadePilot\'s curated closure list.', raw, waypointsForUrl: stopLL ? [stopLL] : [],
      }));
      googleOk = raws.length > 0;
      if (!googleOk) limitations.push('Google Routes returned no route for this request.');
    } catch (e) {
      limitations.push(`Google Routes request failed (${String((e as Error).message).slice(0, 100)}); using the demo street-grid router where possible.`);
    }
  }

  if (googleOk) {
    traffic = req.mode === 'DRIVE'
      ? await (deps.getTraffic ?? getTraffic)([...straight, ...gens.flatMap((g) => sampleAlong(g.raw.path, 800))].slice(0, 14), { now })
      : trafficEarly;
    const first = evaluateAll(gens, traffic);
    if (first.every((x) => x.ev.status === 'blocked') && req.mode !== 'TRANSIT') {
      const g = gridPlan({});
      if (g) {
        const vias = viaPoints(g.nodes, 8);
        try {
          const intermediates = [
            ...vias.map((v) => ({ location: { lat: v[0], lng: v[1] }, via: true })),
            ...(stopLL ? [{ location: stop!.location, via: false }] : []),
          ];
          // keep stop order sensible: stop goes last only if the grid path has no waypoint beyond it
          const raws = await routesFn({
            origin: req.origin.location, destination: req.destination.location, mode: req.mode,
            intermediates: stopLL ? orderByPath(intermediates, g.path) : intermediates,
            departureTime: req.mode === 'DRIVE' && arriveBy > now ? new Date(Math.max(now + 60_000, arriveBy - 30 * 60_000)).toISOString() : undefined,
          });
          if (raws[0]) gens.push({
            id: 'detour', label: 'ParadePilot detour', provider: 'google_routes_detour',
            providerNote: 'Google Routes geometry forced through closure-aware waypoints computed by ParadePilot.', raw: raws[0], waypointsForUrl: vias, nodes: g.nodes,
          });
        } catch (e) {
          limitations.push(`Google detour request failed (${String((e as Error).message).slice(0, 80)}); showing the demo-grid detour instead.`);
          gens.push({ id: 'detour', label: 'ParadePilot detour (demo grid)', provider: 'demo_grid', providerNote: 'Simplified street-grid model — not Google routing.', raw: toRaw(g, req.mode), waypointsForUrl: vias, nodes: g.nodes });
        }
      }
    }
    routingStatus = {
      id: 'routing', label: 'Routing', provider: 'Google Routes API', mode: 'live', lastFetchedAt: new Date(now).toISOString(), dataAsOf: null, freshness: 'fresh',
      note: `Live Google Routes${req.mode === 'DRIVE' ? ' (traffic-aware)' : req.mode === 'WALK' ? ' (walking is not traffic-aware)' : ''}. Google is not aware of ParadePilot's curated closures — they are checked separately.`,
      sourceUrl: ROUTES_DOCS,
    };
  } else {
    const gridNote = 'Demo Simulation Mode: simplified Manhattan street-grid router (14th–90th St). Not Google routing; no one-ways, subway or park paths.';
    if (req.mode === 'TRANSIT') {
      limitations.push('Transit routing needs Google Routes (set GOOGLE_MAPS_SERVER_KEY). The demo grid router does not fabricate transit routes.');
      fallbackLink = googleMapsUrl(req.origin.location, req.destination.location, 'TRANSIT');
    } else {
      const naive = gridPlan({ ignoreClosures: true });
      const aware = gridPlan({});
      const calm = gridPlan({ avoidCrowdLines: true });
      if (!naive || !aware) limitations.push('One endpoint is outside the demo street grid (Manhattan 14th–90th St), or no closure-free path exists on the grid.');
      if (naive) { naiveNodes = naive.nodes; }
      const seen = new Set<string>();
      const push = (id: string, label: string, g: ReturnType<typeof gridPlan>) => {
        if (!g) return;
        const sig = g.nodes.join('>');
        if (seen.has(sig)) return;
        seen.add(sig);
        gens.push({ id, label, provider: 'demo_grid', providerNote: gridNote, raw: toRaw(g, req.mode), waypointsForUrl: [], nodes: g.nodes });
      };
      push('grid-aware', 'Closure-aware route', aware);
      push('grid-calm', 'Away from the parade corridor', calm);
      push('grid-naive', 'Standard shortest route', naive);
    }
    routingStatus = {
      id: 'routing', label: 'Routing', provider: 'Demo street-grid router', mode: 'simulated', lastFetchedAt: new Date(now).toISOString(), dataAsOf: null, freshness: 'unknown',
      note: req.mode === 'TRANSIT' ? 'Transit not available without a Google Routes key — link-out provided.' : `${gridNote}${config.googleServerKey && !config.forceDemo ? ' (Google call failed; fell back.)' : ' Add GOOGLE_MAPS_SERVER_KEY for live routes.'}`,
      sourceUrl: ROUTES_DOCS,
    };
    if (req.mode === 'DRIVE') traffic = await (deps.getTraffic ?? getTraffic)([...straight, ...gens.flatMap((g) => sampleAlong(g.raw.path, 800))].slice(0, 14), { now });
  }

  stageLog.push(stage('routes', Date.now()));

  // --- 3) Evaluate + rank
  const evaluated = evaluateAll(gens, traffic);
  const prio = req.priority;
  const rank = (x: { gen: Gen; ev: EvalResult }) => {
    const blocked = x.ev.status === 'blocked' ? 1 : 0;
    const delay = x.gen.provider === 'demo_grid' ? (x.ev.trafficDelayS ?? 0) : 0;
    const dur = x.gen.raw.durationS + delay;
    const secondary = prio === 'less_crowd' ? Math.round(x.ev.crowdExposureM / 100) * 1e6 : prio === 'less_walking' ? (x.gen.raw.walkingM ?? x.gen.raw.distanceM) * 1e3 : 0;
    return blocked * 1e12 + secondary + dur;
  };
  evaluated.sort((a, b) => rank(a) - rank(b));
  const clear = evaluated.filter((x) => x.ev.status !== 'blocked');
  const shown = [...clear.slice(0, 2), ...evaluated.filter((x) => x.ev.status === 'blocked').slice(0, clear.length ? 1 : 2)].slice(0, 3);
  const best = clear[0] ?? null;
  const naiveEval = evaluated.find((x) => x.gen.id === 'grid-naive' || x.gen.id === 'g1');

  const sourceNames = (conf: EvalResult) => conf.conflicts.map((c) => c.title.split(':')[0]);
  const candidates: RouteCandidate[] = shown.map((x, i) => {
    const delayAdd = x.gen.provider === 'demo_grid' ? (x.ev.trafficDelayS ?? 0) : 0;
    const durationS = Math.round(x.gen.raw.durationS + delayAdd);
    const mins = Math.round(durationS / 60);
    let reason: string;
    if (x.ev.status === 'blocked') {
      const first = sourceNames(x.ev)[0];
      reason = x.gen.id === 'grid-naive' || x.gen.id === 'g1'
        ? `Not recommended: this is what a closure-unaware route looks like — it runs into ${first}${x.ev.conflicts.length > 1 ? ` and ${x.ev.conflicts.length - 1} more` : ''}.`
        : `Not recommended: overlaps ${x.ev.conflicts.length} active closure${x.ev.conflicts.length > 1 ? 's' : ''} (${first}).`;
    } else if (x === best) {
      const base = naiveEval && naiveEval !== x ? Math.round((naiveEval.gen.raw.durationS) / 60) : null;
      const extra = base !== null ? mins - base : null;
      reason = `Avoids every closure active in your window${extra !== null && extra > 0 ? `; costs about ${extra} min more than the closure-blind route` : ''}${prio === 'less_crowd' ? '; ranked for less exposure near the scheduled corridor' : prio === 'less_walking' ? '; ranked for less walking' : ''}.`;
    } else {
      reason = x.gen.id === 'grid-calm' ? 'Also closure-free, with a wider berth around the scheduled parade corridor.' : 'Closure-free alternative; slightly slower on this priority.';
    }
    const walkingM = x.gen.raw.walkingM === null ? null : Math.round(x.gen.raw.walkingM);
    return {
      id: x.gen.id, label: x.gen.label, reason, mode: req.mode, provider: x.gen.provider, providerNote: x.gen.providerNote,
      path: x.gen.raw.path, durationS, distanceM: Math.round(x.gen.raw.distanceM), walkingM,
      departAt: new Date(arriveBy - durationS * 1000).toISOString(), arriveAt: new Date(arriveBy).toISOString(),
      steps: x.gen.raw.steps, conflicts: x.ev.conflicts, nearby: x.ev.nearby, rules: x.ev.rules, flags: x.ev.flags, status: x.ev.status,
      recommended: x === best && i === shown.indexOf(best),
      googleMapsUrl: googleMapsUrl(req.origin.location, req.destination.location, req.mode, x.gen.waypointsForUrl),
      viaStop: stop ? { id: stop.id, label: stop.name } : null,
    };
  });

  // KPIs (demo/simulated until instrumented)
  let etaDiffMin: number | null = null, minutesSavedEst: number | null = null;
  let basis = 'Not calculable for this request.';
  const bestCand = candidates.find((c) => c.recommended);
  if (bestCand && naiveEval) {
    etaDiffMin = Math.round((bestCand.durationS - naiveEval.gen.raw.durationS) / 60);
    basis = 'ETA difference vs. the closure-blind baseline route in this plan.';
    if (naiveNodes && req.mode !== 'TRANSIT' && !stopLL) {
      const bt = backtrackEstimateS(naiveNodes, d, req.mode, activeLines, o);
      if (bt !== null) {
        minutesSavedEst = Math.max(0, Math.round((bt - bestCand.durationS) / 60));
        basis += ' Minutes saved = (walk the closure-blind route until blocked, then backtrack and re-route) minus the recommended route, on the demo grid model. Simulated estimate.';
      }
    }
  }

  stageLog.push(stage('ready', Date.now()));
  const sources: SourceStatus[] = [
    routingStatus, traffic.status, venues.status, notices.status,
    { id: 'paradeSchedule', label: 'Parade schedule', provider: 'NYC notice + typical Macy\'s timing', mode: 'curated', lastFetchedAt: new Date(now).toISOString(), dataAsOf: null, freshness: 'unknown', note: 'Scheduled/estimated corridor and timing (9am–noon typical). Not a live parade position feed.', sourceUrl: parade.sourceUrl },
  ];

  const plan: TripPlan = {
    tripId: input.tripId, version: input.version, createdAt: new Date(now).toISOString(), request: req,
    candidates, recommendedRouteId: bestCand?.id ?? null, selectedRouteId: bestCand?.id ?? null,
    briefing: undefined as never,
    overlays: {
      closures: notices.events,
      traffic: req.mode === 'DRIVE' ? traffic.events : trafficEarly.events,
      venues: venues.events, parade: [parade], simulated: sims,
    },
    sources, limitations, stageLog,
    kpis: { etaDiffMin, minutesSavedEst, basis },
    stop: stop ? { id: stop.id, label: stop.name } : null,
    stopDetour: null,
    fallbackLink,
  };
  plan.briefing = buildBriefing(plan, { closureCount: closures.filter((c) => windowsOverlap(estWindow[0], estWindow[1], ts(c.startsAt), ts(c.endsAt))).length, noRoute: !bestCand });

  if (stop && !input.skipBaseline) {
    const base = await planTrip({ ...input, stop: null, skipBaseline: true });
    const baseBest = base.candidates.find((c) => c.recommended);
    if (bestCand && baseBest) {
      const extra = Math.round((bestCand.durationS - baseBest.durationS) / 60);
      plan.stopDetour = { extraMin: extra, baselineMin: Math.round(baseBest.durationS / 60), note: 'Travel time only; time spent watching is not included. Estimate on the same data and router.' };
    }
  }
  return plan;
}

/** Put the stopover waypoint where it falls along the grid path, keeping the other via points in path order. */
function orderByPath(wps: { location: LatLng; via: boolean }[], path: LL[]): { location: LatLng; via: boolean }[] {
  const idx = (w: { location: LatLng }) => {
    let best = 0, bd = Infinity;
    path.forEach((p, i) => { const dd = haversineM(p, ll(w.location)); if (dd < bd) { bd = dd; best = i; } });
    return best;
  };
  return [...wps].sort((a, b) => idx(a) - idx(b));
}

/** Demo-only: build a clearly labelled simulated closure on the middle part of a route. */
export function makeSimulatedEvent(path: LL[], arriveBy: number, now: number, n = 1): DisruptionEvent {
  const seg = sliceByFraction(path, 0.42, 0.55);
  return {
    id: `simulated-${n}-${now}`,
    category: 'simulated',
    title: 'SIMULATED incident: temporary street closure on your route (demo)',
    geometry: llToLineString(seg),
    geometryBasis: 'illustrative',
    severity: 'high',
    status: 'simulated',
    startsAt: new Date(now - 5 * 60_000).toISOString(),
    endsAt: new Date(arriveBy + 2 * 3600_000).toISOString(),
    observedAt: new Date(now).toISOString(),
    fetchedAt: new Date(now).toISOString(),
    sourceName: 'ParadePilot demo simulator',
    sourceUrl: null,
    confidenceExplanation: 'Injected by the Simulate disruption control for demonstration. Not a real event and not from any official source.',
    affectedModes: ['WALK', 'DRIVE', 'TRANSIT'],
  };
}
