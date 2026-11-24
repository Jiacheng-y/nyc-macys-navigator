// One API surface, two backends:
//  • VITE_API_BASE set  → HTTP calls to the Express server (live server-side keys, e.g. BestTime).
//  • otherwise          → the same engine runs in the browser (GitHub Pages friendly).
import type { DisruptionEvent, ParadeInfo, Place, StatusResponse, TripPlan, TripStatus } from '@shared/types';
import { createEngine, HttpError } from '@engine/engine';
import { ZodError } from 'zod';

const BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const engine = createEngine();

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}
const post = (b: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(b) });

export function friendly(e: unknown): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof ZodError) return `Please check your inputs: ${e.issues.map((i) => i.message).join('; ')}`;
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export const api = {
  backend: BASE ? ('server' as const) : ('in-browser' as const),
  status: (): Promise<StatusResponse> => (BASE ? http('/api/status') : engine.status()),
  places: (q: string): Promise<{ places: Place[]; note: string | null }> =>
    BASE ? http(`/api/places?q=${encodeURIComponent(q)}`) : engine.places(q),
  disruptions: (bbox: [number, number, number, number]) =>
    BASE ? http<{ events: DisruptionEvent[] }>(`/api/disruptions?bbox=${bbox.join(',')}`) : engine.disruptions(bbox),
  parade: async (): Promise<ParadeInfo> => (BASE ? http('/api/parade') : engine.parade()),
  plan: (body: unknown): Promise<TripPlan> => (BASE ? http('/api/trips/plan', post(body)) : engine.plan(body)),
  replan: (id: string, viaViewingAreaId: string | null): Promise<TripPlan> =>
    BASE ? http(`/api/trips/${id}/replan`, post({ viaViewingAreaId })) : engine.replan(id, viaViewingAreaId),
  select: async (id: string, routeId: string, fromPending = false): Promise<TripPlan> =>
    BASE ? http(`/api/trips/${id}/select`, post({ routeId, fromPending })) : engine.select(id, routeId, fromPending),
  tripStatus: (id: string): Promise<TripStatus> => (BASE ? http(`/api/trips/${id}/status`) : engine.tripStatus(id)),
  simulate: async (id: string): Promise<{ event: DisruptionEvent }> => (BASE ? http('/api/demo/simulate-disruption', post({ tripId: id })) : engine.simulateDisruption(id)),
  clearSim: async (id: string) => (BASE ? http('/api/demo/clear-simulation', post({ tripId: id })) : engine.clearSimulation(id)),
};
