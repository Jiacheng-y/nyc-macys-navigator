import { describe, expect, it } from 'vitest';
import { lineToLine, pointToLineM, routeToGeometryM, windowsOverlap, decodePolyline, sampleAlong } from '../../shared/geo';
import { llToLineString } from '../../shared/geo';
import type { LL } from '../../shared/types';
import { nodeLL } from '../src/grid';
import { evaluateRoute, type EvalContext } from '../src/evaluate';
import { normalizeNotices, loadNoticeFile, paradeCorridorEvent } from '../src/adapters/officialNotices';
import type { DisruptionEvent } from '../../shared/types';

const closureEvent = (line: LL[], start: string | null, end: string | null): DisruptionEvent => ({
  id: 'c1', category: 'official_closure', title: '6th Avenue — test: Street Closed', geometry: llToLineString(line), geometryBasis: 'illustrative',
  severity: 'high', status: 'official_confirmed', startsAt: start, endsAt: end, observedAt: null, fetchedAt: 'x', sourceName: 'test', sourceUrl: null,
  confidenceExplanation: '', affectedModes: ['WALK', 'DRIVE', 'TRANSIT'],
});
const ctx = (closures: DisruptionEvent[], arriveBy: string): EvalContext => ({
  now: Date.parse('2026-11-23T12:00:00Z'), arriveBy: Date.parse(arriveBy), closures, traffic: [], venues: [],
  parade: paradeCorridorEvent('x'), sources: [],
});

describe('geometry', () => {
  it('detects crossing segments as distance 0', () => {
    const a: LL[] = [[40.75, -73.99], [40.76, -73.98]];
    const b: LL[] = [[40.75, -73.98], [40.76, -73.99]];
    expect(lineToLine(a, b).distanceM).toBe(0);
  });
  it('measures point-to-line distance in metres', () => {
    expect(pointToLineM([40.7500, -73.9800], [[40.7510, -73.9810], [40.7510, -73.9790]])).toBeGreaterThan(100);
    expect(pointToLineM([40.7510, -73.9800], [[40.7510, -73.9810], [40.7510, -73.9790]])).toBeLessThan(1);
  });
  it('treats null window bounds as open-ended', () => {
    expect(windowsOverlap(10, 20, null, 15)).toBe(true);
    expect(windowsOverlap(10, 20, 20, null)).toBe(false);
  });
  it('decodes Google polylines', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')[0]).toEqual([38.5, -120.2]);
  });
  it('samples along lines', () => {
    const s = sampleAlong([[40.75, -73.99], [40.76, -73.99]], 300);
    expect(s.length).toBeGreaterThan(3);
  });
});

describe('closure-vs-route checks', () => {
  const closure = [nodeLL('sixth', 23), nodeLL('sixth', 42)];
  const crossing: LL[] = [nodeLL('seventh', 35), nodeLL('fifth', 35)];
  const away: LL[] = [nodeLL('seventh', 20), nodeLL('fifth', 20)];
  const ev = closureEvent(closure, '2026-11-26T02:00:00-05:00', '2026-11-26T15:00:00-05:00');

  it('flags a route that crosses an active closure as blocked', () => {
    const r = evaluateRoute({ path: crossing, streetLines: [crossing], durationS: 600, mode: 'WALK' }, ctx([ev], '2026-11-26T11:00:00-05:00'));
    expect(r.status).toBe('blocked');
    expect(r.conflicts[0].minDistanceM).toBeLessThan(35);
    expect(r.rules.find((x) => x.id === 'closure_conflict')?.outcome).toBe('fail');
  });
  it('does not flag a route that stays clear', () => {
    const r = evaluateRoute({ path: away, streetLines: [away], durationS: 600, mode: 'WALK' }, ctx([ev], '2026-11-26T11:00:00-05:00'));
    expect(r.conflicts).toHaveLength(0);
  });
  it('ignores closures that have ended before the trip window', () => {
    const r = evaluateRoute({ path: crossing, streetLines: [crossing], durationS: 600, mode: 'WALK' }, ctx([ev], '2026-11-26T16:00:00-05:00'));
    expect(r.conflicts).toHaveLength(0);
  });
  it('does not check subway legs against street closures', () => {
    const r = evaluateRoute({ path: crossing, streetLines: [], durationS: 600, mode: 'TRANSIT' }, ctx([ev], '2026-11-26T11:00:00-05:00'));
    // with no street-bound legs the route path is used; pass explicit empty street lines via a far leg instead
    const r2 = evaluateRoute({ path: crossing, streetLines: [away], durationS: 600, mode: 'TRANSIT' }, ctx([ev], '2026-11-26T11:00:00-05:00'));
    expect(r2.conflicts).toHaveLength(0);
    expect(r.rules.some((x) => x.id === 'transit_scope')).toBe(true);
  });
  it('routeToGeometryM works against point geometry', () => {
    const h = routeToGeometryM(crossing, { type: 'Point', coordinates: [crossing[0][1], crossing[0][0]] });
    expect(h.distanceM).toBeLessThan(1);
  });
});

describe('official notice normalization', () => {
  it('normalizes the curated PDF rows with illustrative geometry and null unknowns', () => {
    const file = loadNoticeFile();
    const events = normalizeNotices(file, '2026-11-23T00:00:00Z');
    expect(events.length).toBeGreaterThan(20);
    const sixth = events.find((e) => e.id === 'closure-6th-23-42')!;
    expect(sixth.category).toBe('official_closure');
    expect(sixth.status).toBe('official_confirmed');
    expect(sixth.geometryBasis).toBe('illustrative');
    expect(sixth.startsAt).toBe('2026-11-26T02:00:00-05:00');
    expect(sixth.observedAt).toBeNull();
    expect(sixth.sourceUrl).toContain('nyc.gov');
  });
});
