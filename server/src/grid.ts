// Simplified Manhattan street-grid model used by Demo Mode routing and for computing
// closure-avoiding "via" points for Google Routes. It is an approximation (14th–90th St),
// NOT a real street network: no one-ways, no subway, no park paths.
import type { LL, RouteStep, TravelMode } from '../../shared/types';
import { haversineM, lineToLine, pointToLineM } from '../../shared/geo';

const ORIGIN = { lat: 40.7554, lng: -73.9841 }; // ≈ 6th Ave & 42nd St
const M_PER_DEG_LAT = 111_190;
const M_PER_DEG_LNG = 84_330;
const ST_M = 80.5;
const AVE_BEARING = (29 * Math.PI) / 180;
const SIN = Math.sin(AVE_BEARING), COS = Math.cos(AVE_BEARING);

export function xyToLL(x: number, y: number): LL {
  const E = x * COS + y * SIN;
  const N = -x * SIN + y * COS;
  return [ORIGIN.lat + N / M_PER_DEG_LAT, ORIGIN.lng + E / M_PER_DEG_LNG];
}

type Zone = 'mid' | 'uws' | 'ues';
interface Ave { id: string; name: string; x: number; zone: Zone }

// `mid` avenues exist for streets 14–59, `uws` for 60–90 (west of the park), `ues` for 14–90 (5th Ave and east).
export const AVES: Ave[] = [
  { id: 'lex', name: 'Lexington Ave', x: 690, zone: 'ues' },
  { id: 'park', name: 'Park Ave', x: 560, zone: 'ues' },
  { id: 'madison', name: 'Madison Ave', x: 375, zone: 'ues' },
  { id: 'fifth', name: '5th Ave', x: 280, zone: 'ues' },
  { id: 'sixth', name: '6th Ave', x: 0, zone: 'mid' },
  { id: 'seventh', name: '7th Ave', x: -280, zone: 'mid' },
  { id: 'eighth', name: '8th Ave', x: -560, zone: 'mid' },
  { id: 'ninth', name: '9th Ave', x: -840, zone: 'mid' },
  { id: 'tenth', name: '10th Ave', x: -1120, zone: 'mid' },
  { id: 'eleventh', name: '11th Ave', x: -1400, zone: 'mid' },
  { id: 'cpw', name: 'Central Park West', x: -560, zone: 'uws' },
  { id: 'col', name: 'Columbus Ave', x: -765, zone: 'uws' },
  { id: 'ams', name: 'Amsterdam Ave', x: -970, zone: 'uws' },
  { id: 'wea', name: 'West End Ave', x: -1175, zone: 'uws' },
];
const AVE = new Map(AVES.map((a) => [a.id, a]));
const CHAINS: [string, string][] = [['eighth', 'cpw'], ['ninth', 'col'], ['tenth', 'ams'], ['eleventh', 'wea']];
const TRANSVERSE_ST = [65, 66, 79, 86];
export const MIN_ST = 14;
export const MAX_ST = 90;

const exists = (a: Ave, st: number) =>
  a.zone === 'mid' ? st >= MIN_ST && st <= 59 : a.zone === 'uws' ? st >= 60 && st <= MAX_ST : st >= MIN_ST && st <= MAX_ST;

export const nodeKey = (ave: string, st: number) => `${ave}:${st}`;
export function nodeXY(ave: string, st: number): [number, number] {
  return [AVE.get(ave)!.x, (st - 42) * ST_M];
}
export function nodeLL(ave: string, st: number): LL {
  const [x, y] = nodeXY(ave, st);
  return xyToLL(x, y);
}
export const keyLL = (k: string): LL => {
  const [a, s] = k.split(':');
  return nodeLL(a, Number(s));
};

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

interface Edge {
  a: string; b: string; len: number;
  kind: 'street' | 'avenue' | 'transverse';
  name: string;
  mid: LL;
  dir: 'N' | 'S' | 'E' | 'W';
}
interface Graph { nodes: Set<string>; adj: Map<string, Edge[]> }

function buildGraph(): Graph {
  const nodes = new Set<string>();
  const adj = new Map<string, Edge[]>();
  const add = (a: string, b: string, kind: Edge['kind'], name: string) => {
    const [ax, ay] = nodeXY(...(split(a))), [bx, by] = nodeXY(...(split(b)));
    const A = xyToLL(ax, ay), B = xyToLL(bx, by);
    const len = haversineM(A, B);
    const mid: LL = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const dirAB: Edge['dir'] = kind === 'avenue' ? (by > ay ? 'N' : 'S') : bx > ax ? 'E' : 'W';
    const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' } as const;
    const e1: Edge = { a, b, len, kind, name, mid, dir: dirAB };
    const e2: Edge = { a: b, b: a, len, kind, name, mid, dir: opposite[dirAB] };
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(e1);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(e2);
  };
  const split = (k: string): [string, number] => {
    const [a, s] = k.split(':');
    return [a, Number(s)];
  };

  for (const ave of AVES) for (let st = MIN_ST; st <= MAX_ST; st++) if (exists(ave, st)) nodes.add(nodeKey(ave.id, st));

  // Streets (east–west)
  for (let st = MIN_ST; st <= MAX_ST; st++) {
    const groups: Ave[][] = st <= 59
      ? [AVES.filter((a) => exists(a, st)).sort((p, q) => p.x - q.x)]
      : [AVES.filter((a) => a.zone === 'uws').sort((p, q) => p.x - q.x), AVES.filter((a) => a.zone === 'ues').sort((p, q) => p.x - q.x)];
    for (const g of groups) {
      for (let i = 0; i < g.length - 1; i++) {
        const mx = (g[i].x + g[i + 1].x) / 2;
        const name = `${mx < 280 ? 'W' : 'E'} ${ordinal(st)} St`;
        add(nodeKey(g[i].id, st), nodeKey(g[i + 1].id, st), 'street', name);
      }
    }
  }
  // Park transverses (vehicles only): CPW ↔ 5th Ave
  for (const st of TRANSVERSE_ST) add(nodeKey('cpw', st), nodeKey('fifth', st), 'transverse', `${ordinal(st)} St Transverse`);
  // Avenues (north–south)
  for (const ave of AVES) {
    for (let st = MIN_ST; st < MAX_ST; st++) {
      if (exists(ave, st) && exists(ave, st + 1)) add(nodeKey(ave.id, st), nodeKey(ave.id, st + 1), 'avenue', ave.name);
    }
  }
  for (const [lo, hi] of CHAINS) add(nodeKey(lo, 59), nodeKey(hi, 60), 'avenue', AVE.get(hi)!.name);
  return { nodes, adj };
}

const GRAPH = buildGraph();

export function insideGrid(p: LL): boolean {
  return p[0] > 40.735 && p[0] < 40.805 && p[1] > -74.02 && p[1] < -73.94;
}

export function nearestNodes(p: LL, n = 4, exclude?: Set<string>): { key: string; distM: number }[] {
  const out: { key: string; distM: number }[] = [];
  for (const k of GRAPH.nodes) {
    if (exclude?.has(k)) continue;
    out.push({ key: k, distM: haversineM(p, keyLL(k)) });
  }
  return out.sort((a, b) => a.distM - b.distM).slice(0, n);
}

export interface Constraint {
  /** Closure polylines ([lat,lng]) active in the trip window. */
  closures: LL[][];
  /** Within this many metres of a closure line, nodes/edges are treated as impassable. */
  bufferM?: number;
}

export function blockedNodes(c: Constraint): Set<string> {
  const buf = c.bufferM ?? 30;
  const out = new Set<string>();
  for (const k of GRAPH.nodes) {
    const p = keyLL(k);
    for (const line of c.closures) {
      if (pointToLineM(p, line) < buf) { out.add(k); break; }
    }
  }
  return out;
}

const SPEED: Record<TravelMode, number> = { WALK: 1.35, DRIVE: 5.5, TRANSIT: 1.35 };

export interface PathOptions {
  mode: TravelMode;
  blocked?: Set<string>;
  /** Extra cost multiplier per edge, e.g. crowd-avoidance or congestion. */
  penalty?: (e: { mid: LL; kind: string }) => number;
}

export function shortestPath(from: string, to: string, opt: PathOptions): { nodes: string[]; cost: number } | null {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  // Simple binary-less priority queue (graph is tiny: ~1,000 nodes).
  const frontier = new Set<string>([from]);
  while (frontier.size) {
    let cur = '', best = Infinity;
    for (const k of frontier) { const d = dist.get(k)!; if (d < best) { best = d; cur = k; } }
    frontier.delete(cur);
    if (cur === to) break;
    done.add(cur);
    for (const e of GRAPH.adj.get(cur) ?? []) {
      if (done.has(e.b)) continue;
      if (e.kind === 'transverse' && opt.mode !== 'DRIVE') continue;
      if (opt.blocked?.has(e.b) && e.b !== to) continue;
      const speed = opt.mode === 'DRIVE' ? (e.kind === 'avenue' ? 6.5 : 4.5) : SPEED.WALK;
      const cost = (e.len / speed) * (opt.penalty ? opt.penalty(e) : 1);
      const nd = best + cost;
      if (nd < (dist.get(e.b) ?? Infinity)) { dist.set(e.b, nd); prev.set(e.b, cur); frontier.add(e.b); }
    }
  }
  if (!dist.has(to)) return null;
  const nodes = [to];
  while (nodes[0] !== from) nodes.unshift(prev.get(nodes[0])!);
  return { nodes, cost: dist.get(to)! };
}

function edgeBetween(a: string, b: string): Edge {
  return GRAPH.adj.get(a)!.find((e) => e.b === b)!;
}

export interface GridRoute {
  path: LL[];
  nodes: string[];
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
}

const HEAD_NAME = { N: 'north (uptown)', S: 'south (downtown)', E: 'east', W: 'west' } as const;
const RIGHT = { N: 'E', E: 'S', S: 'W', W: 'N' } as const;

/** Turn a node path (plus the real start/end points) into a polyline, distance, time and steps. */
export function describePath(nodes: string[], start: LL, end: LL, mode: TravelMode): GridRoute {
  const verb = mode === 'DRIVE' ? 'Drive' : 'Walk';
  const speedFor = (kind: string) => (mode === 'DRIVE' ? (kind === 'avenue' ? 6.5 : 4.5) : SPEED.WALK);
  const path: LL[] = [start, ...nodes.map(keyLL), end];
  const steps: RouteStep[] = [];
  const first = keyLL(nodes[0]);
  const lead = haversineM(start, first);
  let distanceM = lead + haversineM(keyLL(nodes[nodes.length - 1]), end);
  let durationS = distanceM / (mode === 'DRIVE' ? 4 : SPEED.WALK);
  if (lead > 15) {
    steps.push({ instruction: `${verb} to the nearest intersection (${Math.round(lead)} m)`, distanceM: Math.round(lead), durationS: Math.round(lead / SPEED[mode]), kind: mode === 'DRIVE' ? 'drive' : 'walk', transit: null });
  }
  let group: { name: string; dir: Edge['dir']; len: number; time: number } | null = null;
  let prevDir: Edge['dir'] | null = null;
  const flush = () => {
    if (!group) return;
    const turn = prevDir === null ? `${verb} ${HEAD_NAME[group.dir]} on` : group.dir === RIGHT[prevDir] ? 'Turn right onto' : prevDir === RIGHT[group.dir] ? 'Turn left onto' : 'Continue onto';
    steps.push({ instruction: `${turn} ${group.name} for ${Math.round(group.len)} m`, distanceM: Math.round(group.len), durationS: Math.round(group.time), kind: mode === 'DRIVE' ? 'drive' : 'walk', transit: null });
    prevDir = group.dir;
    group = null;
  };
  for (let i = 0; i < nodes.length - 1; i++) {
    const e = edgeBetween(nodes[i], nodes[i + 1]);
    distanceM += e.len;
    durationS += e.len / speedFor(e.kind);
    if (group && group.name === e.name && group.dir === e.dir) { group.len += e.len; group.time += e.len / speedFor(e.kind); }
    else { flush(); group = { name: e.name, dir: e.dir, len: e.len, time: e.len / speedFor(e.kind) }; }
  }
  flush();
  steps.push({ instruction: 'Arrive at your destination', distanceM: null, durationS: null, kind: 'other', transit: null });
  return { path, nodes, distanceM, durationS, steps };
}

export interface GridPlanInput {
  start: LL;
  end: LL;
  mode: TravelMode;
  closures: LL[][];
  /** Lines that attract crowds (parade corridor); used only for the "calmer" variant. */
  crowdLines?: LL[][];
  /** Slow zones for driving. */
  congestion?: { at: LL; factor: number }[];
  ignoreClosures?: boolean;
  avoidCrowdLines?: boolean;
}

export function planOnGrid(inp: GridPlanInput): (GridRoute & { startBlocked: boolean; endBlocked: boolean; startSnapM: number; endSnapM: number }) | null {
  if (inp.mode === 'TRANSIT') return null;
  if (!insideGrid(inp.start) || !insideGrid(inp.end)) return null;
  const blocked = inp.ignoreClosures ? new Set<string>() : blockedNodes({ closures: inp.closures });
  const free = (p: LL) => nearestNodes(p, 6, blocked)[0];
  const sNear = nearestNodes(inp.start, 1)[0];
  const eNear = nearestNodes(inp.end, 1)[0];
  // Snap onto the nearest unblocked node when the closest node is blocked, unless that costs > 300 m extra.
  const sFree = free(inp.start), eFree = free(inp.end);
  const s = blocked.has(sNear.key) && sFree && sFree.distM < sNear.distM + 300 ? sFree : sNear;
  const e = blocked.has(eNear.key) && eFree && eFree.distM < eNear.distM + 300 ? eFree : eNear;
  const penalty = (edge: { mid: LL; kind: string }) => {
    let f = 1;
    if (inp.avoidCrowdLines) {
      for (const l of inp.crowdLines ?? []) if (pointToLineM(edge.mid, l) < 160) { f *= 2.2; break; }
    }
    for (const c of inp.congestion ?? []) if (haversineM(edge.mid, c.at) < 200) { f *= c.factor; break; }
    return f;
  };
  const res = shortestPath(s.key, e.key, { mode: inp.mode, blocked, penalty });
  if (!res) return null;
  const r = describePath(res.nodes, inp.start, inp.end, inp.mode);
  return { ...r, startBlocked: blocked.has(s.key), endBlocked: blocked.has(e.key), startSnapM: s.distM, endSnapM: e.distM };
}

/**
 * Estimate how long a traveller would take if they followed `naive` until they hit the first
 * closure, then re-routed. Grid-model estimate only.
 */
export function backtrackEstimateS(naiveNodes: string[], end: LL, mode: TravelMode, closures: LL[][], start: LL): number | null {
  const blocked = blockedNodes({ closures });
  const idx = naiveNodes.findIndex((k) => blocked.has(k));
  if (idx <= 0) return null;
  const stuckAt = naiveNodes[idx - 1];
  const upTo = describePath(naiveNodes.slice(0, idx), start, keyLL(stuckAt), mode);
  const eNear = nearestNodes(end, 1)[0];
  const rest = shortestPath(stuckAt, eNear.key, { mode, blocked });
  if (!rest) return null;
  const tail = describePath(rest.nodes, keyLL(stuckAt), end, mode);
  // The "up to" leg already includes lead-in; both legs are reached on foot/vehicle at the same speed.
  return upTo.durationS + tail.durationS;
}

/** Waypoints sampled from a grid path, for forcing a Google route along a closure-aware line. */
export function viaPoints(nodes: string[], maxPoints = 8, minSpacingM = 450): LL[] {
  const pts: LL[] = [];
  let last: LL | null = null;
  // Prefer corner nodes (where the path turns) since those define the shape of the detour.
  for (let i = 1; i < nodes.length - 1; i++) {
    const [a0, s0] = nodes[i - 1].split(':'), [a1, s1] = nodes[i].split(':'), [a2, s2] = nodes[i + 1].split(':');
    const dir1 = a0 === a1 ? 'v' : 'h', dir2 = a1 === a2 ? 'v' : 'h';
    void s0; void s1; void s2;
    if (dir1 === dir2) continue;
    const p = keyLL(nodes[i]);
    if (!last || haversineM(last, p) >= minSpacingM) { pts.push(p); last = p; }
  }
  if (pts.length <= maxPoints) return pts;
  const step = pts.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => pts[Math.floor(i * step)]);
}

export function lineHitsLine(a: LL[], b: LL[]): number {
  return lineToLine(a, b).distanceM;
}
