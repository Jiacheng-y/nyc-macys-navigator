import type { DisruptionEvent, LL, SourceStatus } from '../../../shared/types';
import { llToLineString, llToPoint } from '../../../shared/geo';
import { fetchJson, TtlCache } from '../cache';
import { config } from '../config';
import { freshness } from '../freshness';
import { severityFromRatio, simulatedTraffic } from './demoFixtures';

export const TOMTOM_DOCS = 'https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-flow/flow-segment-data';

interface FlowResponse {
  flowSegmentData?: {
    frc?: string;
    currentSpeed: number;
    freeFlowSpeed: number;
    currentTravelTime: number;
    freeFlowTravelTime: number;
    confidence?: number;
    roadClosure?: boolean;
    coordinates?: { coordinate: { latitude: number; longitude: number }[] };
  };
}

/** Normalize one TomTom Flow Segment response into a vehicle-traffic event. */
export function normalizeTomTom(raw: FlowResponse, point: LL, fetchedAt: string): DisruptionEvent | null {
  const f = raw.flowSegmentData;
  if (!f || typeof f.currentSpeed !== 'number' || typeof f.freeFlowSpeed !== 'number') return null;
  const ratio = f.freeFlowSpeed > 0 ? f.currentSpeed / f.freeFlowSpeed : null;
  const coords: LL[] = (f.coordinates?.coordinate ?? []).map((c) => [c.latitude, c.longitude] as LL);
  return {
    id: `tomtom-${point[0].toFixed(4)}_${point[1].toFixed(4)}`,
    category: 'vehicle_traffic',
    title: `Vehicle traffic: ${f.roadClosure ? 'road closed (per TomTom)' : `${Math.round(f.currentSpeed)} of ${Math.round(f.freeFlowSpeed)} km/h`}`,
    geometry: coords.length >= 2 ? llToLineString(coords) : llToPoint(point),
    geometryBasis: 'source',
    severity: severityFromRatio(ratio, !!f.roadClosure),
    status: 'observed',
    startsAt: null,
    endsAt: null,
    // The Flow Segment Data response has no per-segment observation timestamp; keep null rather than guess.
    observedAt: null,
    fetchedAt,
    sourceName: 'TomTom Traffic Flow (Flow Segment Data)',
    sourceUrl: TOMTOM_DOCS,
    confidenceExplanation: `Vehicle congestion only — not pedestrian density. TomTom confidence ${f.confidence ?? 'n/a'}. Current conditions at fetch time, not a forecast for your arrival time. TomTom's own road-closure flag is not treated as an official closure.`,
    affectedModes: ['DRIVE'],
    metrics: {
      currentSpeedKmh: f.currentSpeed,
      freeFlowSpeedKmh: f.freeFlowSpeed,
      currentTravelTimeS: f.currentTravelTime ?? null,
      freeFlowTravelTimeS: f.freeFlowTravelTime ?? null,
      roadClosure: !!f.roadClosure,
      ratio: ratio === null ? null : Number(ratio.toFixed(2)),
    },
  };
}

const cache = new TtlCache<DisruptionEvent | null>(config.ttlTraffic);
type Fetcher = (url: string) => Promise<any>;

export interface TrafficResult { events: DisruptionEvent[]; status: SourceStatus }

export async function getTraffic(
  points: LL[],
  opts: { now?: number; key?: string; forceDemo?: boolean; fetcher?: Fetcher; useCache?: boolean } = {},
): Promise<TrafficResult> {
  const now = opts.now ?? Date.now();
  const key = opts.key ?? config.tomtomKey;
  const forceDemo = opts.forceDemo ?? config.forceDemo;
  const fetchedAt = new Date(now).toISOString();
  const fetcher: Fetcher = opts.fetcher ?? ((u) => fetchJson(u));
  const base = { id: 'traffic' as const, label: 'Vehicle traffic', provider: 'TomTom Traffic Flow', sourceUrl: TOMTOM_DOCS };
  const simulate = (note: string): TrafficResult => ({
    events: simulatedTraffic(points, fetchedAt),
    status: { ...base, mode: 'simulated', lastFetchedAt: fetchedAt, dataAsOf: null, freshness: 'unknown', note },
  });
  if (forceDemo) return simulate('Demo Simulation Mode is forced (DEMO_MODE=true). Simulated sample data.');
  if (!key) return simulate('No TOMTOM_API_KEY configured — showing simulated sample data.');

  const uniq = new Map<string, LL>();
  for (const p of points) uniq.set(`${p[0].toFixed(3)},${p[1].toFixed(3)}`, p);
  const targets = [...uniq.values()].slice(0, 12);
  const errors: string[] = [];
  const events: DisruptionEvent[] = [];
  await Promise.all(targets.map(async (p) => {
    const ck = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    const cached = opts.useCache === false ? undefined : cache.get(ck, now);
    if (cached !== undefined) { if (cached) events.push(cached); return; }
    try {
      const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${p[0]},${p[1]}&unit=KMPH&key=${encodeURIComponent(key)}`;
      const ev = normalizeTomTom(await fetcher(url), p, fetchedAt);
      cache.set(ck, ev, now);
      if (ev) events.push(ev);
    } catch (e) {
      errors.push(String((e as Error).message).split(key).join('***'));
    }
  }));
  if (events.length === 0 && errors.length > 0) {
    return simulate(`TomTom request failed (${errors[0].slice(0, 80)}) — falling back to simulated sample data.`);
  }
  return {
    events,
    status: {
      ...base, mode: 'live', lastFetchedAt: fetchedAt, dataAsOf: null,
      freshness: freshness(fetchedAt, config.staleTraffic, now),
      note: `Live vehicle flow at ${events.length} sampled points near your routes${errors.length ? ` (${errors.length} failed)` : ''}. Vehicle congestion only.`,
    },
  };
}
