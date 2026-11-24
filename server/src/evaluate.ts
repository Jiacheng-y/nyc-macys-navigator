// Deterministic, explainable route evaluation. Verified closures are HARD constraints; traffic only applies to
// driving; venue busyness is contextual (point-only) and never becomes a street-level crowd score.
import type {
  ConflictInfo, DisruptionEvent, LL, NearbyNote, RuleResult, SourceStatus, TravelMode,
} from '../../shared/types';
import { geometryToLines, haversineM, pointToLineM, routeToGeometryM, sampleAlong, windowsOverlap } from '../../shared/geo';

export const CROSS_M = 35; // closer than this to a closure line = route uses/crosses the closure
export const NEAR_M = 150; // "nearby" context radius
export const TRAFFIC_M = 80; // traffic sample must be this close to a route to be relevant

export interface EvalContext {
  now: number;
  arriveBy: number;
  /** official_closure + simulated events */
  closures: DisruptionEvent[];
  traffic: DisruptionEvent[];
  venues: DisruptionEvent[];
  parade: DisruptionEvent;
  sources: SourceStatus[];
}

export interface EvalInput {
  path: LL[];
  /** Street-bound legs only (subway/rail excluded). */
  streetLines: LL[][];
  durationS: number;
  mode: TravelMode;
}

export interface EvalResult {
  conflicts: ConflictInfo[];
  nearby: NearbyNote[];
  rules: RuleResult[];
  flags: string[];
  status: 'clear' | 'caution' | 'blocked';
  trafficDelayS: number | null;
  crowdExposureM: number;
  worstTraffic: DisruptionEvent['severity'];
}

const t = (s: string | null) => (s ? Date.parse(s) : null);
const SEV_ORDER = { none: 0, unknown: 0, low: 1, medium: 2, high: 3 } as const;

export function evaluateRoute(r: EvalInput, ctx: EvalContext): EvalResult {
  const depart = ctx.arriveBy - r.durationS * 1000;
  const conflicts: ConflictInfo[] = [];
  const nearby: NearbyNote[] = [];
  const lines = r.streetLines.length ? r.streetLines : [r.path];
  const rules: RuleResult[] = [];
  const flags: string[] = [];

  // 1) Official / simulated closures — hard constraint.
  let activeClosures = 0;
  for (const c of ctx.closures) {
    if (!c.affectedModes.includes(r.mode)) continue;
    if (!windowsOverlap(depart, ctx.arriveBy, t(c.startsAt), t(c.endsAt))) continue;
    activeClosures++;
    let best = { distanceM: Infinity, indexA: 0 };
    for (const l of lines) {
      const h = routeToGeometryM(l, c.geometry);
      if (h.distanceM < best.distanceM) best = h;
    }
    if (best.distanceM < CROSS_M) {
      conflicts.push({
        eventId: c.id, title: c.title, minDistanceM: Math.round(best.distanceM),
        window: { startsAt: c.startsAt, endsAt: c.endsAt }, geometryBasis: c.geometryBasis,
        simulated: c.category === 'simulated', pathIndex: best.indexA,
      });
    } else if (best.distanceM < NEAR_M) {
      nearby.push({ eventId: c.id, title: c.title, distanceM: Math.round(best.distanceM), detail: 'Runs close to this closure; check crossings on site.' });
    }
  }
  conflicts.sort((a, b) => a.pathIndex - b.pathIndex);
  const closureSources = [...new Set(conflicts.map((c) => c.title.split(':')[0]))];
  if (conflicts.length) {
    rules.push({
      id: 'closure_conflict', label: 'Verified closures', outcome: 'fail',
      detail: `Route overlaps ${conflicts.length} closure${conflicts.length > 1 ? 's' : ''} active during your trip window: ${closureSources.slice(0, 3).join('; ')}${closureSources.length > 3 ? '…' : ''}.`,
      sources: ['NYC 2026 street-closure notice'],
    });
  } else {
    rules.push({
      id: 'closure_conflict', label: 'Verified closures', outcome: 'pass',
      detail: `No overlap with the ${activeClosures} closure${activeClosures === 1 ? '' : 's'} active in your trip window (map lines are approximate; ${CROSS_M} m tolerance).`,
      sources: ['NYC 2026 street-closure notice'],
    });
  }
  if (r.mode === 'TRANSIT') {
    rules.push({ id: 'transit_scope', label: 'Transit legs', outcome: 'info', detail: 'Only walking and bus legs are checked against street closures. Subway/rail legs run underground; station-entrance closures and bus reroutes are not covered by this notice — check MTA.', sources: ['MTA'] });
  }

  // 2) Vehicle traffic (driving only).
  const trafficSrc = ctx.sources.find((s) => s.id === 'traffic');
  let trafficDelayS: number | null = null;
  let worstTraffic: DisruptionEvent['severity'] = 'none';
  if (r.mode === 'DRIVE') {
    const near = ctx.traffic.filter((e) => {
      const h = routeToGeometryM(r.path, e.geometry);
      return h.distanceM < TRAFFIC_M;
    });
    if (near.length === 0) {
      rules.push({ id: 'traffic', label: 'Vehicle traffic', outcome: 'unknown', detail: 'No traffic samples cover this route — unknown, not "clear".', sources: [trafficSrc?.provider ?? 'TomTom'] });
    } else {
      worstTraffic = near.reduce<DisruptionEvent['severity']>((w, e) => (SEV_ORDER[e.severity] > SEV_ORDER[w] ? e.severity : w), 'none');
      const delays = near.map((e) => {
        const c = e.metrics?.currentTravelTimeS, f = e.metrics?.freeFlowTravelTimeS;
        return typeof c === 'number' && typeof f === 'number' ? Math.max(0, c - f) : null;
      });
      trafficDelayS = delays.every((d) => d !== null) ? (delays as number[]).reduce((a, b) => a + b, 0) : null;
      const simulated = near.some((e) => e.status === 'simulated');
      rules.push({
        id: 'traffic', label: 'Vehicle traffic',
        outcome: worstTraffic === 'high' ? 'warn' : worstTraffic === 'medium' ? 'warn' : 'pass',
        detail: `${near.length} sampled road segment${near.length > 1 ? 's' : ''} along the route; worst: ${worstTraffic}.${trafficDelayS !== null ? ` Sampled segments add ≈${Math.round(trafficDelayS / 60)} min vs free-flow.` : ''} Vehicle congestion only.${simulated ? ' SIMULATED data.' : ''}`,
        sources: [trafficSrc?.provider ?? 'TomTom'],
      });
      if (trafficSrc?.freshness === 'stale') flags.push('Traffic data is stale');
      if (ctx.arriveBy - ctx.now > 2 * 3600_000) flags.push('Traffic reflects current conditions, not a forecast for your arrival time');
    }
  } else {
    rules.push({ id: 'traffic', label: 'Vehicle traffic', outcome: 'info', detail: 'Vehicle traffic does not apply to this travel mode and is never used as a crowd measure.', sources: [] });
  }

  // 3) Venue busyness — contextual, point-only.
  if (r.mode !== 'DRIVE') {
    const hits = ctx.venues
      .map((v) => ({ v, d: Math.round(routeToGeometryM(r.path, v.geometry).distanceM) }))
      .filter((x) => x.d < NEAR_M);
    for (const { v, d } of hits) {
      const pct = v.metrics?.busynessPct;
      nearby.push({
        eventId: v.id, title: v.title, distanceM: d,
        detail: typeof pct === 'number' ? `Venue busyness (proxy) ${pct}% at this venue${v.status === 'simulated' ? ' — simulated' : ''}. Not sidewalk density.` : 'No live busyness available (unknown).',
      });
    }
    const busy = hits.filter((h) => typeof h.v.metrics?.busynessPct === 'number' && (h.v.metrics.busynessPct as number) >= 85);
    rules.push({
      id: 'venue_context', label: 'Nearby venue activity (proxy)',
      outcome: busy.length ? 'warn' : hits.length ? 'info' : 'unknown',
      detail: hits.length
        ? `${hits.length} tracked venue${hits.length > 1 ? 's' : ''} within ${NEAR_M} m (${hits.map((h) => h.v.title.replace('Venue busyness (proxy): ', '')).join(', ')}). Context only — a venue reading says nothing about the street outside.`
        : 'No tracked venues near this route, so no activity data. That is "unknown", not "quiet".',
      sources: [ctx.sources.find((s) => s.id === 'venueBusyness')?.provider ?? 'BestTime'],
    });
  }

  // 4) Scheduled parade corridor proximity (estimate, not measured).
  const corridor = geometryToLines(ctx.parade.geometry)[0];
  const paradeActive = windowsOverlap(depart, ctx.arriveBy, t(ctx.parade.startsAt), t(ctx.parade.endsAt) !== null ? (t(ctx.parade.endsAt) as number) + 3600_000 : null);
  let exposure = 0;
  if (paradeActive) {
    for (const s of sampleAlong(r.path, 40)) if (pointToLineM(s, corridor) < NEAR_M) exposure += 40;
  }
  if (paradeActive && exposure > 0) {
    rules.push({
      id: 'parade_proximity', label: 'Scheduled parade corridor', outcome: 'warn',
      detail: `About ${Math.round(exposure)} m of this route is within ${NEAR_M} m of the scheduled corridor during parade hours — expect spectator crowds. Estimate from the schedule, not a measurement.`,
      sources: ['NYC notice + typical schedule'],
    });
  } else if (paradeActive) {
    rules.push({ id: 'parade_proximity', label: 'Scheduled parade corridor', outcome: exposure === 0 ? 'pass' : 'info', detail: exposure === 0 ? `Stays more than ${NEAR_M} m from the scheduled corridor.` : 'Near the corridor, see closure conflicts.', sources: ['NYC notice + typical schedule'] });
  } else {
    rules.push({ id: 'parade_proximity', label: 'Scheduled parade corridor', outcome: 'info', detail: 'Your trip window is outside the typical parade hours (9am–noon, unverified for 2026).', sources: ['NYC notice + typical schedule'] });
  }

  // 5) Source freshness.
  const stale = ctx.sources.filter((s) => s.freshness === 'stale');
  rules.push({
    id: 'freshness', label: 'Data freshness',
    outcome: stale.length ? 'warn' : 'pass',
    detail: stale.length ? `Stale: ${stale.map((s) => s.label).join(', ')}. Treat related findings as last-known.` : 'Sources are within freshness limits (or marked unknown where no timestamp exists).',
    sources: ctx.sources.map((s) => s.provider),
  });
  if (stale.length) flags.push(`Stale data: ${stale.map((s) => s.label).join(', ')}`);

  // Uncertainty flags
  if (ctx.closures.some((c) => c.geometryBasis === 'illustrative')) flags.push('Closure map lines are illustrative, not surveyed');
  if (r.mode !== 'DRIVE') flags.push('Police-controlled crossing points (if any) are not listed in the notice');
  for (const s of ctx.sources) if (s.mode === 'simulated') flags.push(`${s.label}: simulated data`);

  const status: EvalResult['status'] = conflicts.length ? 'blocked' : rules.some((x) => x.outcome === 'warn') ? 'caution' : 'clear';
  return { conflicts, nearby, rules, flags: [...new Set(flags)], status, trafficDelayS, crowdExposureM: exposure, worstTraffic };
}

export const _internal = { haversineM };
