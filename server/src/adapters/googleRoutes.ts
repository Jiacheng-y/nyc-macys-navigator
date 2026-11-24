import type { LL, LatLng, Place, RouteStep, TravelMode } from '../../../shared/types';
import { decodePolyline, lineLengthM } from '../../../shared/geo';
import { fetchJson, TtlCache } from '../cache';
import { config } from '../config';
import { PRESET_PLACES } from './demoFixtures';

export const ROUTES_DOCS = 'https://developers.google.com/maps/documentation/routes/';

export interface RawRoute {
  path: LL[];
  durationS: number;
  distanceM: number;
  walkingM: number | null;
  steps: RouteStep[];
  /** Polylines of street-bound legs (walk/drive/bus). Subway/rail legs are excluded from closure checks. */
  streetLines: LL[][];
}

export interface RoutesRequest {
  origin: LatLng;
  destination: LatLng;
  mode: TravelMode;
  alternatives?: boolean;
  /** Waypoints forced onto the route. `via` = pass-through (no stop). */
  intermediates?: { location: LatLng; via: boolean }[];
  departureTime?: string;
  arrivalTime?: string;
}

const dur = (s?: string) => (s ? Number(s.replace('s', '')) : 0);
const gm = (m: TravelMode) => ({ WALK: 'WALK', DRIVE: 'DRIVE', TRANSIT: 'TRANSIT' }[m]);

const FIELD_MASK = [
  'routes.duration', 'routes.distanceMeters', 'routes.polyline.encodedPolyline',
  'routes.legs.steps.navigationInstruction', 'routes.legs.steps.distanceMeters', 'routes.legs.steps.staticDuration',
  'routes.legs.steps.polyline.encodedPolyline', 'routes.legs.steps.travelMode', 'routes.legs.steps.transitDetails',
].join(',');

export function vehicleKind(type?: string): RouteStep['kind'] {
  if (!type) return 'other';
  if (type === 'SUBWAY') return 'subway';
  if (type === 'BUS' || type === 'INTERCITY_BUS' || type === 'TROLLEYBUS') return 'bus';
  if (['HEAVY_RAIL', 'COMMUTER_TRAIN', 'RAIL', 'HIGH_SPEED_TRAIN', 'LONG_DISTANCE_TRAIN', 'MONORAIL'].includes(type)) return 'rail';
  return 'other';
}

/** Convert a Google Routes API v2 response into RawRoute objects. Exported for tests. */
export function parseRoutesResponse(json: any, mode: TravelMode): RawRoute[] {
  const out: RawRoute[] = [];
  for (const r of json?.routes ?? []) {
    const path = r.polyline?.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline) : [];
    if (path.length < 2) continue;
    const steps: RouteStep[] = [];
    const streetLines: LL[][] = [];
    let walkingM = 0;
    for (const leg of r.legs ?? []) {
      for (const s of leg.steps ?? []) {
        const line = s.polyline?.encodedPolyline ? decodePolyline(s.polyline.encodedPolyline) : [];
        const t = s.transitDetails;
        if (t) {
          const kind = vehicleKind(t.transitLine?.vehicle?.type);
          const lineName = t.transitLine?.nameShort || t.transitLine?.name || 'transit';
          const from = t.stopDetails?.departureStop?.name ?? null;
          const to = t.stopDetails?.arrivalStop?.name ?? null;
          steps.push({
            instruction: `Take ${t.transitLine?.vehicle?.name?.text ?? 'transit'} ${lineName}${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}${t.stopCount ? ` (${t.stopCount} stops)` : ''}`,
            distanceM: s.distanceMeters ?? null,
            durationS: dur(s.staticDuration) || null,
            kind,
            transit: { line: lineName, vehicle: t.transitLine?.vehicle?.name?.text ?? 'Transit', from, to, stops: t.stopCount ?? null },
          });
          if (kind === 'bus' && line.length > 1) streetLines.push(line);
        } else {
          const walking = s.travelMode === 'WALK' || mode === 'WALK';
          steps.push({
            instruction: s.navigationInstruction?.instructions ?? (walking ? 'Walk' : 'Continue'),
            distanceM: s.distanceMeters ?? null,
            durationS: dur(s.staticDuration) || null,
            kind: walking ? 'walk' : 'drive',
            transit: null,
          });
          if (walking) walkingM += s.distanceMeters ?? 0;
          if (line.length > 1) streetLines.push(line);
        }
      }
    }
    if (mode !== 'TRANSIT' && streetLines.length === 0) streetLines.push(path);
    out.push({
      path,
      durationS: dur(r.duration),
      distanceM: r.distanceMeters ?? lineLengthM(path),
      walkingM: mode === 'DRIVE' ? null : mode === 'WALK' ? (r.distanceMeters ?? walkingM) : walkingM,
      steps,
      streetLines,
    });
  }
  return out;
}

const cache = new TtlCache<RawRoute[]>(config.ttlRoutes);
type Fetcher = (url: string, init: RequestInit) => Promise<any>;

export const googleRoutingAvailable = () => !!config.googleServerKey && !config.forceDemo;

export async function computeRoutes(req: RoutesRequest, opts: { fetcher?: Fetcher; key?: string; now?: number } = {}): Promise<RawRoute[]> {
  const key = opts.key ?? config.googleServerKey;
  if (!key) throw new Error('No GOOGLE_MAPS_SERVER_KEY configured');
  const fetcher = opts.fetcher ?? ((u, i) => fetchJson(u, i));
  const ck = JSON.stringify(req);
  const hit = opts.fetcher ? undefined : cache.get(ck, opts.now);
  if (hit) return hit;
  const wp = (l: LatLng) => ({ location: { latLng: { latitude: l.lat, longitude: l.lng } } });
  const body: Record<string, unknown> = {
    origin: wp(req.origin),
    destination: wp(req.destination),
    travelMode: gm(req.mode),
    units: 'METRIC',
  };
  if (req.mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_AWARE';
    if (req.departureTime) body.departureTime = req.departureTime;
  }
  if (req.mode === 'TRANSIT' && req.arrivalTime) body.arrivalTime = req.arrivalTime;
  if (req.intermediates?.length && req.mode !== 'TRANSIT') {
    body.intermediates = req.intermediates.map((i) => ({ ...wp(i.location), via: i.via }));
  } else if (req.alternatives) {
    body.computeAlternativeRoutes = true;
  }
  const json = await fetcher('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
    body: JSON.stringify(body),
  });
  const routes = parseRoutesResponse(json, req.mode);
  if (!opts.fetcher) cache.set(ck, routes, opts.now);
  return routes;
}

/** Google Maps Directions URL (deep link). Closures known only to ParadePilot do not carry over. */
export function googleMapsUrl(origin: LatLng, destination: LatLng, mode: TravelMode, waypoints: LL[] = []): string {
  const p = new URLSearchParams({
    api: '1',
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: { WALK: 'walking', DRIVE: 'driving', TRANSIT: 'transit' }[mode],
  });
  if (waypoints.length) p.set('waypoints', waypoints.slice(0, 8).map((w) => `${w[0].toFixed(5)},${w[1].toFixed(5)}`).join('|'));
  return `https://www.google.com/maps/dir/?${p.toString().replace(/%2C/g, ',').replace(/%7C/g, '|')}`;
}

/** Geocode free text: preset landmarks always; Google Geocoding API when a server key exists. */
export async function geocode(q: string, opts: { fetcher?: (u: string) => Promise<any>; key?: string } = {}): Promise<{ places: Place[]; note: string | null }> {
  const needle = q.trim().toLowerCase();
  const presets = PRESET_PLACES.filter((p) => !needle || p.label.toLowerCase().includes(needle));
  const coord = needle.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (coord) return { places: [{ label: `${coord[1]}, ${coord[2]}`, location: { lat: Number(coord[1]), lng: Number(coord[2]) }, source: 'coordinates' }], note: null };
  const key = opts.key ?? config.googleServerKey;
  if (!key || config.forceDemo || needle.length < 3) {
    return { places: presets, note: key ? null : 'Google Geocoding not configured — showing preset landmarks. Paste "lat, lng" to use any point.' };
  }
  try {
    const fetcher = opts.fetcher ?? ((u: string) => fetchJson(u));
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&bounds=${encodeURIComponent('40.68,-74.05|40.88,-73.90')}&components=${encodeURIComponent('locality:New York')}&key=${encodeURIComponent(key)}`;
    const json = await fetcher(url);
    if (json.status !== 'OK' && json.status !== 'ZERO_RESULTS') throw new Error(`${json.status}${json.error_message ? `: ${json.error_message}` : ''}`);
    const g: Place[] = (json.results ?? []).slice(0, 5).map((r: any) => ({
      label: r.formatted_address, location: { lat: r.geometry.location.lat, lng: r.geometry.location.lng }, source: 'google_geocoding' as const,
    }));
    return { places: [...g, ...presets], note: null };
  } catch (e) {
    return { places: presets, note: `Google Geocoding unavailable (${String((e as Error).message).slice(0, 80)}) — showing preset landmarks.` };
  }
}
