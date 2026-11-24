import L from 'leaflet';
import type { LL } from '@shared/types';

export interface MapLayers {
  origin: LL | null;
  destination: LL | null;
  stop: LL | null;
  routes: { id: string; path: LL[]; kind: 'selected' | 'alt' | 'blocked' | 'proposed'; label: string }[];
  closures: { id: string; title: string; path: LL[]; active: boolean; simulated: boolean }[];
  corridor: LL[] | null;
  traffic: { id: string; at: LL; sev: string; title: string }[];
  venues: { id: string; at: LL; title: string; pct: number | null }[];
  viewing: { id: string; at: LL; title: string; verified: boolean }[];
  show: { closures: boolean; traffic: boolean; venues: boolean; corridor: boolean; unknown: boolean };
  fitKey: string;
}

export interface MapRenderer {
  render(l: MapLayers): void;
  destroy(): void;
}

const NYC: LL = [40.7527, -73.9890];

/** Marker artwork as SVG so both map libraries draw identical, non-colour-only shapes. */
export function markerSvg(kind: 'origin' | 'dest' | 'stop' | 'traffic' | 'venue' | 'unknown' | 'closure' | 'view', text = '', color = '#2D241F'): string {
  const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">${inner}</svg>`;
  const t = (s: string, fill = '#fff', size = 13) => `<text x="17" y="22" text-anchor="middle" font-family="Nunito Sans,Arial" font-weight="800" font-size="${size}" fill="${fill}">${s}</text>`;
  switch (kind) {
    case 'origin': return wrap(`<circle cx="17" cy="17" r="13" fill="#1F6F54" stroke="#fff" stroke-width="3"/>${t('A')}`);
    case 'dest': return wrap(`<circle cx="17" cy="17" r="13" fill="#2D241F" stroke="#fff" stroke-width="3"/>${t('B')}`);
    case 'stop': return wrap(`<circle cx="17" cy="17" r="13" fill="#E8B66A" stroke="#2D241F" stroke-width="3"/>${t('★', '#2D241F', 15)}`);
    case 'traffic': return wrap(`<path d="M17 4 L31 29 H3 Z" fill="${color}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>${t('!', '#2D241F', 15).replace('y="22"', 'y="26"')}`);
    case 'venue': return wrap(`<path d="M17 3 L31 17 L17 31 L3 17 Z" fill="#6B5547" stroke="#fff" stroke-width="2.5"/>${t(text, '#fff', 11)}`);
    case 'unknown': return wrap(`<path d="M17 3 L31 17 L17 31 L3 17 Z" fill="#fff" stroke="#6B5547" stroke-width="2.5" stroke-dasharray="3 3"/>${t('?', '#6B5547', 14)}`);
    case 'closure': return wrap(`<rect x="5" y="5" width="24" height="24" rx="6" fill="${color}" stroke="#fff" stroke-width="2.5"/>${t('✕', '#fff', 16)}`);
    case 'view': return wrap(`<circle cx="17" cy="17" r="13" fill="#D65A1F" stroke="#fff" stroke-width="3"/>${t('🎈', '#fff', 14)}`);
  }
}
const svgUrl = (s: string) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(s)}`;
const sevColor = (s: string) => (s === 'high' ? '#C62828' : '#F2A900');
const mid = (p: LL[]): LL => p[Math.floor(p.length / 2)];

const ROUTE_STYLE = {
  selected: { color: '#1F6F54', weight: 7, dash: null, opacity: 0.95 },
  proposed: { color: '#0B5C8A', weight: 6, dash: '1 9', opacity: 0.95 },
  alt: { color: '#5F8F7F', weight: 4, dash: '10 8', opacity: 0.85 },
  blocked: { color: '#7A7A7A', weight: 4, dash: '2 7', opacity: 0.8 },
} as const;

/* ---------------------------- Leaflet (OpenStreetMap) ---------------------------- */
export function createLeafletRenderer(el: HTMLElement): MapRenderer {
  const map = L.map(el, { zoomControl: true }).setView(NYC, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const group = L.layerGroup().addTo(map);
  let lastFit = '';
  const icon = (svg: string) => L.icon({ iconUrl: svgUrl(svg), iconSize: [34, 34], iconAnchor: [17, 17], className: 'pp-marker' });
  return {
    render(l) {
      group.clearLayers();
      const bounds: LL[] = [];
      if (l.show.corridor && l.corridor) {
        L.polyline(l.corridor, { color: '#E8B66A', weight: 16, opacity: 0.55 }).addTo(group).bindTooltip('Scheduled parade corridor (estimated, illustrative line)');
        L.polyline(l.corridor, { color: '#6B5547', weight: 3, dashArray: '2 8', opacity: 0.9 }).addTo(group);
      }
      if (l.show.closures) for (const c of l.closures) {
        const color = c.simulated ? '#6B21A8' : '#9B1C1C';
        L.polyline(c.path, { color, weight: 7, opacity: c.active ? 0.95 : 0.45, dashArray: c.simulated ? '10 6' : c.active ? undefined : '4 8' }).addTo(group).bindTooltip(`${c.title}${c.active ? '' : ' (outside your trip window)'}`);
        if (c.active) L.marker(mid(c.path), { icon: icon(markerSvg('closure', '', color)), title: c.title }).addTo(group).bindTooltip(c.title);
      }
      for (const r of l.routes) {
        const s = ROUTE_STYLE[r.kind];
        L.polyline(r.path, { color: s.color, weight: s.weight, opacity: s.opacity, dashArray: s.dash ?? undefined, lineCap: 'round' }).addTo(group).bindTooltip(r.label);
        if (r.kind === 'selected' || r.kind === 'proposed') bounds.push(...r.path);
      }
      if (l.show.traffic) for (const t of l.traffic) L.marker(t.at, { icon: icon(markerSvg('traffic', '', sevColor(t.sev))), title: t.title }).addTo(group).bindTooltip(t.title);
      for (const v of l.venues) {
        if (v.pct === null && !l.show.unknown) continue;
        if (v.pct !== null && !l.show.venues) continue;
        L.marker(v.at, { icon: icon(v.pct === null ? markerSvg('unknown') : markerSvg('venue', String(v.pct))), title: v.title }).addTo(group).bindTooltip(v.pct === null ? `${v.title} — no live data (unknown)` : `${v.title}: ${v.pct}%`);
      }
      for (const v of l.viewing) L.marker(v.at, { icon: icon(markerSvg('view')), title: v.title }).addTo(group).bindTooltip(`${v.title}${v.verified ? '' : ' — unverified demo assumption'}`);
      if (l.origin) { L.marker(l.origin, { icon: icon(markerSvg('origin')), title: 'Start' }).addTo(group); bounds.push(l.origin); }
      if (l.destination) { L.marker(l.destination, { icon: icon(markerSvg('dest')), title: 'Destination' }).addTo(group); bounds.push(l.destination); }
      if (l.stop) L.marker(l.stop, { icon: icon(markerSvg('stop')), title: 'Viewing stop' }).addTo(group);
      if (l.fitKey !== lastFit && bounds.length) { map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] }); lastFit = l.fitKey; }
    },
    destroy() { map.remove(); },
  };
}

/* ---------------------------- Google Maps ---------------------------- */
let gPromise: Promise<void> | null = null;
export function loadGoogleMaps(key: string): Promise<void> {
  if (gPromise) return gPromise;
  gPromise = new Promise<void>((resolve, reject) => {
    if ((window as any).google?.maps) return resolve();
    const timer = setTimeout(() => reject(new Error('Google Maps timed out')), 12_000);
    (window as any).gm_authFailure = () => { clearTimeout(timer); reject(new Error('Google Maps rejected the key (check referrer restrictions and enabled APIs)')); };
    (window as any).__ppGmReady = () => { clearTimeout(timer); resolve(); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__ppGmReady`;
    s.async = true;
    s.onerror = () => { clearTimeout(timer); reject(new Error('Could not load Google Maps')); };
    document.head.appendChild(s);
  });
  gPromise.catch(() => { gPromise = null; });
  return gPromise;
}

export function createGoogleRenderer(el: HTMLElement): MapRenderer {
  const g = (window as any).google.maps as typeof google.maps;
  const map = new g.Map(el, { center: { lat: NYC[0], lng: NYC[1] }, zoom: 14, mapTypeControl: false, streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy' });
  const things: { setMap(m: google.maps.Map | null): void }[] = [];
  const info = new g.InfoWindow();
  let lastFit = '';
  const P = (p: LL) => ({ lat: p[0], lng: p[1] });
  const line = (path: LL[], o: google.maps.PolylineOptions, tip: string) => {
    const pl = new g.Polyline({ path: path.map(P), map, ...o });
    pl.addListener('click', (e: google.maps.PolyMouseEvent) => { info.setContent(`<div style="font:600 13px sans-serif;max-width:240px">${esc(tip)}</div>`); info.setPosition(e.latLng); info.open(map); });
    things.push(pl);
  };
  const marker = (at: LL, svg: string, tip: string) => {
    const m = new g.Marker({ position: P(at), map, title: tip, icon: { url: svgUrl(svg), scaledSize: new g.Size(34, 34), anchor: new g.Point(17, 17) } });
    m.addListener('click', () => { info.setContent(`<div style="font:600 13px sans-serif;max-width:240px">${esc(tip)}</div>`); info.open(map, m); });
    things.push(m);
  };
  const dots = (c: string) => [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3, strokeColor: c }, offset: '0', repeat: '14px' }];
  return {
    render(l) {
      things.splice(0).forEach((t) => t.setMap(null));
      const bounds: LL[] = [];
      if (l.show.corridor && l.corridor) {
        line(l.corridor, { strokeColor: '#E8B66A', strokeOpacity: 0.55, strokeWeight: 16 }, 'Scheduled parade corridor (estimated, illustrative line)');
        line(l.corridor, { strokeOpacity: 0, icons: dots('#6B5547') }, 'Scheduled parade corridor');
      }
      if (l.show.closures) for (const c of l.closures) {
        const color = c.simulated ? '#6B21A8' : '#9B1C1C';
        const tip = `${c.title}${c.active ? '' : ' (outside your trip window)'}`;
        line(c.path, { strokeColor: color, strokeOpacity: c.active ? 0.95 : 0.45, strokeWeight: 7, ...(c.simulated || !c.active ? { strokeOpacity: 0, icons: dots(color) } : {}) }, tip);
        if (c.active) marker(mid(c.path), markerSvg('closure', '', color), tip);
      }
      for (const r of l.routes) {
        const s = ROUTE_STYLE[r.kind];
        line(r.path, { strokeColor: s.color, strokeWeight: s.weight, strokeOpacity: s.dash ? 0 : s.opacity, icons: s.dash ? dots(s.color) : undefined, zIndex: r.kind === 'selected' ? 5 : 3 }, r.label);
        if (r.kind === 'selected' || r.kind === 'proposed') bounds.push(...r.path);
      }
      if (l.show.traffic) for (const t of l.traffic) marker(t.at, markerSvg('traffic', '', sevColor(t.sev)), t.title);
      for (const v of l.venues) {
        if (v.pct === null && !l.show.unknown) continue;
        if (v.pct !== null && !l.show.venues) continue;
        marker(v.at, v.pct === null ? markerSvg('unknown') : markerSvg('venue', String(v.pct)), v.pct === null ? `${v.title} — no live data (unknown)` : `${v.title}: ${v.pct}%`);
      }
      for (const v of l.viewing) marker(v.at, markerSvg('view'), `${v.title}${v.verified ? '' : ' — unverified demo assumption'}`);
      if (l.origin) { marker(l.origin, markerSvg('origin'), 'Start'); bounds.push(l.origin); }
      if (l.destination) { marker(l.destination, markerSvg('dest'), 'Destination'); bounds.push(l.destination); }
      if (l.stop) marker(l.stop, markerSvg('stop'), 'Viewing stop');
      if (l.fitKey !== lastFit && bounds.length) {
        const b = new g.LatLngBounds();
        bounds.forEach((p) => b.extend(P(p)));
        map.fitBounds(b, 48);
        lastFit = l.fitKey;
      }
    },
    destroy() { things.splice(0).forEach((t) => t.setMap(null)); },
  };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
