import { useEffect, useRef, useState } from 'react';
import { createGoogleRenderer, createLeafletRenderer, loadGoogleMaps, type MapLayers, type MapRenderer } from '../mapRenderers';

export default function MapView({ layers, mapsKey }: { layers: MapLayers; mapsKey: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const renderer = useRef<MapRenderer | null>(null);
  const latest = useRef(layers);
  latest.current = layers;
  const [backend, setBackend] = useState<'loading' | 'google' | 'osm'>('loading');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    const host = el.current!;
    (async () => {
      let r: MapRenderer | null = null;
      if (mapsKey) {
        try {
          await loadGoogleMaps(mapsKey);
          if (dead) return;
          r = createGoogleRenderer(host);
          setBackend('google');
        } catch (e) {
          setNote(`${(e as Error).message}. Showing OpenStreetMap instead.`);
        }
      } else {
        setNote('No Google Maps key configured — showing OpenStreetMap basemap.');
      }
      if (!r && !dead) { host.innerHTML = ''; r = createLeafletRenderer(host); setBackend('osm'); }
      if (dead) { r?.destroy(); return; }
      renderer.current = r;
      r!.render(latest.current);
    })();
    return () => { dead = true; renderer.current?.destroy(); renderer.current = null; };
  }, [mapsKey]);

  useEffect(() => { renderer.current?.render(layers); }, [layers, backend]);

  return (
    <div className="relative h-full min-h-[300px] w-full overflow-hidden rounded-2xl border border-gold/60 bg-cream shadow-cozy">
      <div ref={el} className="absolute inset-0" role="application" aria-label="Map of the route, closures, traffic and venue activity. The same information is listed in the route and briefing panels." />
      {backend === 'loading' && <div className="absolute inset-0 grid place-items-center text-bark pp-pulse">Loading map…</div>}
      {note && <p className="absolute bottom-2 left-2 right-2 z-[500] rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-bark shadow-cozy sm:right-auto sm:max-w-sm">{note}</p>}
    </div>
  );
}
