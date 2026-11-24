import type { DisruptionEvent, TripPlan, TripRequest } from '../../shared/types';

export interface Trip {
  id: string;
  request: TripRequest;
  version: number;
  plan: TripPlan;
  pending: TripPlan | null;
  sims: DisruptionEvent[];
  stopId: string | null;
  lastTouched: number;
}

const trips = new Map<string, Trip>();
const MAX = 200;

export const newTripId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).slice(0, 8);
export function saveTrip(t: Trip) {
  t.lastTouched = Date.now();
  trips.set(t.id, t);
  if (trips.size > MAX) {
    const oldest = [...trips.values()].sort((a, b) => a.lastTouched - b.lastTouched)[0];
    trips.delete(oldest.id);
  }
}
export const getTrip = (id: string) => trips.get(id);
export const _clearTrips = () => trips.clear();
