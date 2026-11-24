import type { GeoGeometry, LL } from './types';

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: LL, b: LL): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type XY = [number, number];
function project(p: LL, refLat: number): XY {
  return [rad(p[1]) * R * Math.cos(rad(refLat)), rad(p[0]) * R];
}

function ptSegDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function cross(o: XY, a: XY, b: XY) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function segIntersect(p1: XY, p2: XY, p3: XY, p4: XY): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Min distance in metres between two segments (0 if they cross). */
export function segSegDistM(a1: LL, a2: LL, b1: LL, b2: LL): number {
  const refLat = (a1[0] + a2[0] + b1[0] + b2[0]) / 4;
  const p1 = project(a1, refLat), p2 = project(a2, refLat), p3 = project(b1, refLat), p4 = project(b2, refLat);
  if (segIntersect(p1, p2, p3, p4)) return 0;
  return Math.min(ptSegDist(p1, p3, p4), ptSegDist(p2, p3, p4), ptSegDist(p3, p1, p2), ptSegDist(p4, p1, p2));
}

export function pointToLineM(p: LL, line: LL[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineM(p, line[0]);
  const refLat = p[0];
  const P = project(p, refLat);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, ptSegDist(P, project(line[i], refLat), project(line[i + 1], refLat)));
  }
  return best;
}

export interface LineHit {
  distanceM: number;
  /** Index of the segment on line `a` where the closest approach occurs. */
  indexA: number;
}

/** Closest approach between two polylines. */
export function lineToLine(a: LL[], b: LL[]): LineHit {
  let best: LineHit = { distanceM: Infinity, indexA: 0 };
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const d = segSegDistM(a[i], a[i + 1], b[j], b[j + 1]);
      if (d < best.distanceM) {
        best = { distanceM: d, indexA: i };
        if (d === 0) return best;
      }
    }
  }
  return best;
}

export function lineLengthM(line: LL[]): number {
  let t = 0;
  for (let i = 0; i < line.length - 1; i++) t += haversineM(line[i], line[i + 1]);
  return t;
}

/** Points along a line every `spacingM` metres (always includes the first and last point). */
export function sampleAlong(line: LL[], spacingM: number): LL[] {
  if (line.length === 0) return [];
  const out: LL[] = [line[0]];
  let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const seg = haversineM(line[i], line[i + 1]);
    let d = spacingM - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t]);
      d += spacingM;
    }
    carry = (carry + seg) % spacingM;
  }
  const last = line[line.length - 1];
  if (out.length === 1 || haversineM(out[out.length - 1], last) > 1) out.push(last);
  return out;
}

export function pointAtFraction(line: LL[], f: number): LL {
  const total = lineLengthM(line);
  let target = total * f;
  for (let i = 0; i < line.length - 1; i++) {
    const seg = haversineM(line[i], line[i + 1]);
    if (target <= seg) {
      const t = seg === 0 ? 0 : target / seg;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
    }
    target -= seg;
  }
  return line[line.length - 1];
}

/** Sub-line between two fractions of total length. */
export function sliceByFraction(line: LL[], f0: number, f1: number): LL[] {
  const total = lineLengthM(line);
  const a = total * f0, b = total * f1;
  const out: LL[] = [pointAtFraction(line, f0)];
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    acc += haversineM(line[i], line[i + 1]);
    if (acc > a && acc < b) out.push(line[i + 1]);
  }
  out.push(pointAtFraction(line, f1));
  return out;
}

/** GeoJSON → list of [lat,lng] lines (points become single-point lines). */
export function geometryToLines(g: GeoGeometry): LL[][] {
  if (g.type === 'Point') return [[[g.coordinates[1], g.coordinates[0]]]];
  if (g.type === 'LineString') return [g.coordinates.map(([lng, lat]) => [lat, lng] as LL)];
  return g.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng] as LL));
}

export function llToLineString(line: LL[]): GeoGeometry {
  return { type: 'LineString', coordinates: line.map(([lat, lng]) => [lng, lat] as [number, number]) };
}

export function llToPoint(p: LL): GeoGeometry {
  return { type: 'Point', coordinates: [p[1], p[0]] };
}

/** Min distance in metres from a route to any geometry part. */
export function routeToGeometryM(route: LL[], g: GeoGeometry): LineHit {
  let best: LineHit = { distanceM: Infinity, indexA: 0 };
  for (const part of geometryToLines(g)) {
    if (part.length === 1) {
      for (let i = 0; i < route.length - 1; i++) {
        const d = pointToLineM(part[0], [route[i], route[i + 1]]);
        if (d < best.distanceM) best = { distanceM: d, indexA: i };
      }
    } else {
      const h = lineToLine(route, part);
      if (h.distanceM < best.distanceM) best = h;
    }
  }
  return best;
}

/** Google encoded polyline → [lat,lng][]. */
export function decodePolyline(encoded: string): LL[] {
  const out: LL[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

export function bboxOf(points: LL[], padM = 0): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lat, lng] of points) {
    w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat);
  }
  const dLat = padM / 111_190;
  const dLng = padM / (111_320 * Math.cos(rad((s + n) / 2)));
  return [w - dLng, s - dLat, e + dLng, n + dLat];
}

export function inBbox(p: LL, bbox: [number, number, number, number]): boolean {
  return p[1] >= bbox[0] && p[1] <= bbox[2] && p[0] >= bbox[1] && p[0] <= bbox[3];
}

/** Time-window overlap; `null` bounds are open-ended. */
export function windowsOverlap(
  aStart: number | null, aEnd: number | null, bStart: number | null, bEnd: number | null,
): boolean {
  const as = aStart ?? -Infinity, ae = aEnd ?? Infinity, bs = bStart ?? -Infinity, be = bEnd ?? Infinity;
  return as < be && bs < ae;
}
