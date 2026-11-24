// Shared API contracts between the ParadePilot server and web app.
// Convention: `LL` = [lat, lng]. GeoJSON geometry uses [lng, lat] per spec.

export type LL = [number, number];
export type LatLng = { lat: number; lng: number };

export type TravelMode = 'WALK' | 'DRIVE' | 'TRANSIT';
export type Priority = 'fastest' | 'less_crowd' | 'less_walking';

export type EventCategory =
  | 'official_closure'
  | 'vehicle_traffic'
  | 'venue_busyness'
  | 'parade_schedule'
  | 'simulated';

export type EventStatus = 'official_confirmed' | 'observed' | 'estimated' | 'unknown' | 'simulated';
export type Severity = 'none' | 'low' | 'medium' | 'high' | 'unknown';

export type GeoGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

/** Normalized disruption object. Unknown fields stay `null`. */
export interface DisruptionEvent {
  id: string;
  category: EventCategory;
  title: string;
  geometry: GeoGeometry;
  /** Where the map geometry came from: verified from the source, or an approximation we drew. */
  geometryBasis: 'source' | 'illustrative';
  severity: Severity;
  status: EventStatus;
  startsAt: string | null;
  endsAt: string | null;
  observedAt: string | null;
  fetchedAt: string;
  sourceName: string;
  sourceUrl: string | null;
  confidenceExplanation: string;
  affectedModes: TravelMode[];
  /** Adapter-specific measured values (speeds, busyness %). Never a pedestrian-density claim. */
  metrics?: Record<string, number | string | boolean | null>;
}

export type SourceMode = 'live' | 'simulated' | 'curated' | 'unavailable';

export interface SourceStatus {
  id: 'traffic' | 'venueBusyness' | 'officialNotices' | 'routing' | 'paradeSchedule';
  label: string;
  provider: string;
  mode: SourceMode;
  lastFetchedAt: string | null;
  /** When the underlying data was last reviewed/observed, if the source says so. */
  dataAsOf: string | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  note: string;
  sourceUrl: string | null;
}

export interface StatusResponse {
  appMode: 'live' | 'demo';
  sources: SourceStatus[];
  mapsBrowserKey: string | null;
  pollIntervalMs: number;
  minPollIntervalMs: number;
  now: string;
  eventDate: string;
  demoEndpointsEnabled: boolean;
}

export interface Place {
  label: string;
  location: LatLng;
  source: 'preset' | 'google_geocoding' | 'coordinates';
}

export interface TripRequest {
  origin: Place;
  destination: Place;
  /** ISO timestamp the user wants to arrive by. */
  arriveBy: string;
  mode: TravelMode;
  priority: Priority;
  areasToVisit: string[];
}

export interface RouteStep {
  instruction: string;
  distanceM: number | null;
  durationS: number | null;
  kind: 'walk' | 'drive' | 'bus' | 'subway' | 'rail' | 'other';
  transit: { line: string; vehicle: string; from: string | null; to: string | null; stops: number | null } | null;
}

export interface RuleResult {
  id: string;
  label: string;
  outcome: 'pass' | 'warn' | 'fail' | 'info' | 'unknown';
  detail: string;
  sources: string[];
}

export interface ConflictInfo {
  eventId: string;
  title: string;
  /** Closest approach between route and closure geometry, in metres. */
  minDistanceM: number;
  window: { startsAt: string | null; endsAt: string | null };
  geometryBasis: 'source' | 'illustrative';
  simulated: boolean;
  /** Approximate index into route path where the conflict starts. */
  pathIndex: number;
}

export interface NearbyNote {
  eventId: string;
  title: string;
  distanceM: number;
  detail: string;
}

export interface RouteCandidate {
  id: string;
  label: string;
  reason: string;
  mode: TravelMode;
  provider: 'google_routes' | 'google_routes_detour' | 'demo_grid';
  providerNote: string;
  path: LL[];
  durationS: number;
  distanceM: number;
  walkingM: number | null;
  departAt: string;
  arriveAt: string;
  steps: RouteStep[];
  conflicts: ConflictInfo[];
  nearby: NearbyNote[];
  rules: RuleResult[];
  flags: string[];
  status: 'clear' | 'caution' | 'blocked';
  recommended: boolean;
  googleMapsUrl: string;
  /** Present only for a route with a viewing stop. */
  viaStop: { id: string; label: string } | null;
}

export interface Briefing {
  whatChanged: string[];
  affectsTrip: string[];
  evidence: { text: string; sourceName: string; sourceUrl: string | null; asOf: string | null; mode: SourceMode }[];
  recommendedAction: string[];
  verdict: 'clear' | 'caution' | 'action_needed' | 'no_valid_route';
  headline: string;
}

export interface ViewingArea {
  id: string;
  name: string;
  location: LatLng;
  description: string;
  verification: 'verified' | 'demo_assumed' | 'unverified';
  verificationNote: string;
  officialGuidanceUrl: string;
  accessNote: string;
  straightLineWalkMin?: number | null;
}

export interface PlanOverlays {
  closures: DisruptionEvent[];
  traffic: DisruptionEvent[];
  venues: DisruptionEvent[];
  parade: DisruptionEvent[];
  simulated: DisruptionEvent[];
}

export interface TripPlan {
  tripId: string;
  version: number;
  createdAt: string;
  request: TripRequest;
  candidates: RouteCandidate[];
  recommendedRouteId: string | null;
  selectedRouteId: string | null;
  briefing: Briefing;
  overlays: PlanOverlays;
  sources: SourceStatus[];
  limitations: string[];
  stageLog: { stage: 'collecting' | 'relevance' | 'routes' | 'ready'; at: string }[];
  /** Estimated KPIs (demo/simulated until instrumented). */
  kpis: {
    etaDiffMin: number | null;
    minutesSavedEst: number | null;
    basis: string;
  };
  stop: { id: string; label: string } | null;
  stopDetour: { extraMin: number; baselineMin: number; note: string } | null;
  fallbackLink: string | null;
}

export interface TripStatus {
  tripId: string;
  state: 'on_track' | 'potential_delay' | 'action_needed';
  checkedAt: string;
  nextCheckAfterMs: number;
  etaChangeMin: number | null;
  message: string;
  alert: null | {
    title: string;
    impact: string;
    confidence: string;
    sources: { name: string; url: string | null; status: EventStatus; observedAt: string | null }[];
    estimatedDelayMin: number | null;
    lastKnown: string;
    simulated: boolean;
  };
  /** Fresh plan with the new event applied; not adopted until the user switches. */
  pendingPlan: TripPlan | null;
  alternativeRouteId: string | null;
}

export interface ParadeInfo {
  corridor: DisruptionEvent;
  scheduleNote: string;
  viewingAreas: ViewingArea[];
  officialLinks: { label: string; url: string }[];
  closureSummary: { title: string; startsAt: string | null; endsAt: string | null }[];
}
