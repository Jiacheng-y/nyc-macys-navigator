import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DisruptionEvent, LL, ParadeInfo, Place, Priority, StatusResponse, TravelMode, TripPlan, TripStatus, ViewingArea } from '@shared/types';
import { geometryToLines } from '@shared/geo';
import { PRESET_PLACES } from '@engine/adapters/demoFixtures';
import { api, friendly } from './api';
import { ago, fmtTime, mid, summaryText, toIso } from './util';
import type { MapLayers } from './mapRenderers';
import MapView from './components/MapView';
import PlaceField from './components/PlaceField';
import { AlertCard, BriefingPanel, Kpis, Legend, Modal, ModeBadge, MonitorStrip, ParadePanel, RouteCards, RouteDetail, Section, StageChips } from './components/Panels';

const AREAS = ["Macy's Herald Square", 'Times Square', 'Bryant Park', 'Rockefeller Center', 'Columbus Circle', 'Grand Central', 'Penn Station'];
const MODES: { id: TravelMode; label: string; icon: string }[] = [{ id: 'WALK', label: 'Walk', icon: '🚶' }, { id: 'DRIVE', label: 'Drive', icon: '🚗' }, { id: 'TRANSIT', label: 'Transit', icon: '🚇' }];
const PRIOS: { id: Priority; label: string }[] = [{ id: 'fastest', label: 'Fastest' }, { id: 'less_crowd', label: 'Less crowd exposure' }, { id: 'less_walking', label: 'Less walking' }];

const loadNum = (k: string) => { try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; } };
const saveNum = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* storage unavailable */ } };
const ll = (p: Place): LL => [p.location.lat, p.location.lng];

type Confirm = { kind: 'switch' } | { kind: 'join'; area: ViewingArea } | { kind: 'share' } | { kind: 'about' } | null;

export default function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [parade, setParade] = useState<ParadeInfo | null>(null);
  const [base, setBase] = useState<DisruptionEvent[]>([]);
  const [origin, setOrigin] = useState<Place>(PRESET_PLACES[0]);
  const [dest, setDest] = useState<Place>(PRESET_PLACES[1]);
  const [time, setTime] = useState('11:00');
  const [mode, setMode] = useState<TravelMode>('WALK');
  const [priority, setPriority] = useState<Priority>('fastest');
  const [areas, setAreas] = useState<string[]>([]);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [tStatus, setTStatus] = useState<TripStatus | null>(null);
  const [polling, setPolling] = useState(true);
  const [checking, setChecking] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hasSim, setHasSim] = useState(false);
  const [simEvents, setSimEvents] = useState<DisruptionEvent[]>([]);
  const [stopProposal, setStopProposal] = useState<TripPlan | null>(null);
  const [paradeOpen, setParadeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [tab, setTab] = useState<'plan' | 'route' | 'explore'>('plan');
  const [show, setShow] = useState<MapLayers['show']>({ closures: true, traffic: true, venues: true, corridor: true, unknown: true });
  const [alerts, setAlerts] = useState(() => loadNum('pp.alerts'));
  const [changes, setChanges] = useState(() => loadNum('pp.changes'));
  const [checks, setChecks] = useState(() => loadNum('pp.checks'));
  const [now, setNow] = useState(Date.now());
  const ackedFor = useRef<number | null>(null);
  const toast = useRef<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const say = (m: string) => { toast.current = m; setToastMsg(m); setTimeout(() => toast.current === m && setToastMsg(null), 4500); };

  // ---- Initial load: status, parade info, base overlays
  useEffect(() => {
    api.status().then(setStatus).catch((e) => setError(friendly(e)));
    api.parade().then(setParade).catch(() => undefined);
    api.disruptions([-74.02, 40.73, -73.94, 40.80]).then((r) => setBase(r.events)).catch(() => undefined);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ---- Plan
  const onPlan = async () => {
    setError(null); setLoading(true); setStage(0); setTStatus(null); setReviewing(false); setStopProposal(null); setDismissed(false); setHasSim(false); setSimEvents([]);
    const t1 = setTimeout(() => setStage(1), 450), t2 = setTimeout(() => setStage(2), 900);
    try {
      const [p] = await Promise.all([api.plan({ origin, destination: dest, arriveBy: toIso(time), mode, priority, areasToVisit: areas }), new Promise((r) => setTimeout(r, 1200))]);
      setPlan(p); setSelectedId(p.selectedRouteId); setStage(3); setTab('route');
      api.status().then(setStatus).catch(() => undefined);
    } catch (e) { setError(friendly(e)); setStage(3); }
    finally { clearTimeout(t1); clearTimeout(t2); setLoading(false); }
  };

  const selectRoute = async (id: string) => {
    if (!plan) return;
    setSelectedId(id);
    try { setPlan(await api.select(plan.tripId, id)); } catch (e) { setError(friendly(e)); }
  };

  // ---- Monitoring
  const runCheck = useCallback(async (auto: boolean) => {
    if (!plan || !plan.selectedRouteId) return;
    setChecking(true);
    try {
      const s = await api.tripStatus(plan.tripId);
      setTStatus(s);
      if (auto) { setChecks((c) => { saveNum('pp.checks', c + 1); return c + 1; }); }
    } catch (e) { setError(friendly(e)); }
    finally { setChecking(false); }
  }, [plan?.tripId, plan?.selectedRouteId]);

  useEffect(() => { if (plan?.selectedRouteId) runCheck(false); }, [plan?.tripId, plan?.selectedRouteId]);
  useEffect(() => {
    if (!plan || !polling || !status) return;
    const ms = Math.max(status.minPollIntervalMs, status.pollIntervalMs);
    const t = setInterval(() => runCheck(true), ms);
    return () => clearInterval(t);
  }, [plan?.tripId, polling, status?.pollIntervalMs, runCheck]);

  const ack = () => {
    const v = tStatus?.pendingPlan?.version ?? -1;
    if (ackedFor.current !== v) { ackedFor.current = v; setAlerts((a) => { saveNum('pp.alerts', a + 1); return a + 1; }); }
  };
  const simulate = async () => {
    if (!plan) return;
    try { const r = await api.simulate(plan.tripId); setSimEvents((x) => [...x, r.event]); setHasSim(true); setDismissed(false); setReviewing(false); await runCheck(false); setTab('route'); }
    catch (e) { setError(friendly(e)); }
  };
  const clearSim = async () => {
    if (!plan) return;
    await api.clearSim(plan.tripId); setHasSim(false); setSimEvents([]); setReviewing(false); setDismissed(false); await runCheck(false);
  };
  const doSwitch = async () => {
    if (!plan || !tStatus?.alternativeRouteId) return;
    setConfirm(null);
    try {
      const p = await api.select(plan.tripId, tStatus.alternativeRouteId, true);
      setPlan(p); setSelectedId(p.selectedRouteId); setReviewing(false); setChanges((c) => { saveNum('pp.changes', c + 1); return c + 1; });
      say('Route switched. Monitoring the new route.');
    } catch (e) { setError(friendly(e)); }
  };

  // ---- Join the parade (optional stop)
  const doJoin = async (a: ViewingArea) => {
    if (!plan) { setConfirm(null); say('Plan your trip first, then add a viewing stop.'); return; }
    setConfirm(null); setBusy(true);
    try { setStopProposal(await api.replan(plan.tripId, a.id)); } catch (e) { setError(friendly(e)); }
    finally { setBusy(false); }
  };
  const useStopRoute = async () => {
    if (!plan || !stopProposal) return;
    const best = stopProposal.candidates.find((c) => c.recommended);
    if (!best) return;
    try {
      const p = await api.select(plan.tripId, best.id, true);
      setPlan(p); setSelectedId(p.selectedRouteId); setStopProposal(null); setChanges((c) => { saveNum('pp.changes', c + 1); return c + 1; });
      say('Viewing stop added to your route.');
    } catch (e) { setError(friendly(e)); }
  };

  // ---- Map layers
  const selected = plan?.candidates.find((c) => c.id === selectedId) ?? null;
  const proposal = reviewing ? tStatus?.pendingPlan ?? null : stopProposal;
  const layers: MapLayers = useMemo(() => {
    const arrive = Date.parse(toIso(time));
    const closureEvents = plan ? [...plan.overlays.closures, ...plan.overlays.simulated, ...simEvents] : base.filter((e) => e.category === 'official_closure');
    const trafficEvents = plan ? plan.overlays.traffic : [];
    const venueEvents = plan ? plan.overlays.venues : base.filter((e) => e.category === 'venue_busyness');
    const corridorEv = plan?.overlays.parade[0] ?? parade?.corridor ?? base.find((e) => e.category === 'parade_schedule');
    const routes: MapLayers['routes'] = (plan?.candidates ?? []).map((c) => ({
      id: c.id, path: c.path, label: `${c.label} — ${Math.round(c.durationS / 60)} min${c.status === 'blocked' ? ' (blocked by closure)' : ''}`,
      kind: c.id === selectedId ? 'selected' : c.status === 'blocked' ? 'blocked' : 'alt',
    }));
    const pr = proposal?.candidates.find((c) => c.recommended);
    if (pr) routes.push({ id: `p-${pr.id}`, path: pr.path, kind: 'proposed', label: `Proposed: ${pr.label} — ${Math.round(pr.durationS / 60)} min` });
    return {
      origin: ll(origin), destination: ll(dest), stop: (proposal ?? plan)?.stop ? ((): LL | null => { const a = parade?.viewingAreas.find((v) => v.id === (proposal ?? plan)!.stop!.id); return a ? [a.location.lat, a.location.lng] : null; })() : null,
      routes,
      closures: closureEvents.map((e) => ({
        id: e.id, title: e.title, path: geometryToLines(e.geometry)[0], simulated: e.category === 'simulated',
        active: e.category === 'simulated' || (Date.parse(e.startsAt ?? '') <= arrive && Date.parse(e.endsAt ?? '') >= arrive - 3600_000),
      })),
      corridor: corridorEv ? geometryToLines(corridorEv.geometry)[0] : null,
      traffic: trafficEvents.filter((e) => e.severity === 'medium' || e.severity === 'high').map((e) => ({ id: e.id, at: mid(geometryToLines(e.geometry)[0]), sev: e.severity, title: `${e.title}${e.status === 'simulated' ? ' (simulated)' : ''}` })),
      venues: venueEvents.map((e) => ({ id: e.id, at: geometryToLines(e.geometry)[0][0], title: `${e.title}${e.status === 'simulated' ? ' (simulated)' : ''}`, pct: typeof e.metrics?.busynessPct === 'number' ? (e.metrics.busynessPct as number) : null })),
      viewing: paradeOpen ? (parade?.viewingAreas ?? []).map((a) => ({ id: a.id, at: [a.location.lat, a.location.lng] as LL, title: a.name, verified: a.verification === 'verified' })) : [],
      show, fitKey: `${plan?.tripId ?? 'none'}|${selectedId}|${proposal?.version ?? 0}|${origin.label}|${dest.label}`,
    };
  }, [plan, base, parade, selectedId, proposal, origin, dest, time, show, paradeOpen, simEvents]);

  const areaNotes = useMemo(() => {
    if (!plan) return [];
    return areas.map((a) => {
      const key = a.split(' ')[0].replace("'s", '');
      const v = plan.overlays.venues.find((e) => e.title.toLowerCase().includes(key.toLowerCase()));
      const pct = v?.metrics?.busynessPct;
      return `${a}: ${typeof pct === 'number' ? `venue busyness (proxy) ${pct}%${v!.status === 'simulated' ? ' — simulated' : ''}. Venue-level only; says nothing about the street outside.` : 'no live data — unknown.'}`;
    });
  }, [plan, areas]);

  const sources = plan?.sources ?? status?.sources ?? [];
  const mapsKey = status?.mapsBrowserKey ?? null;
  const showAlert = tStatus?.state === 'action_needed' && !!tStatus.alert;

  return (
    <div className="flex min-h-full flex-col lg:h-screen lg:overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[3000] focus:bg-white focus:p-2">Skip to content</a>
      {/* ---- Header */}
      <header className="relative overflow-hidden border-b-4 border-gold bg-gradient-to-r from-burnt to-pumpkin text-white">
        <Leaves />
        <div className="relative mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden><rect width="40" height="40" rx="11" fill="#FFF9F0" /><path d="M10 28 L20 8 L30 28 L20 22Z" fill="#B64013" /><circle cx="20" cy="30" r="2.6" fill="#E8B66A" /></svg>
            <div>
              <h1 className="font-display text-2xl font-extrabold leading-none">ParadePilot</h1>
              <p className="text-sm font-semibold text-white/90">Thanksgiving in NYC <span aria-hidden>🦃</span> · Meet your friends, not the traffic.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border-2 border-white px-3 py-1 text-sm font-extrabold ${status?.appMode === 'live' ? 'bg-leaf' : 'bg-gold text-espresso'}`} title="Live if any source uses real API data; Demo if everything is simulated.">
              {status ? (status.appMode === 'live' ? '● Live' : '◐ Demo') : '…'}
            </span>
            <button className="btn-secondary !min-h-[40px] !py-1 text-sm" onClick={() => setConfirm({ kind: 'about' })}>How it works</button>
            <button className="btn-secondary !min-h-[40px] !py-1 text-sm" disabled={!plan?.selectedRouteId} onClick={() => setConfirm({ kind: 'share' })}>Share trip</button>
          </div>
        </div>
        <div className="relative border-t border-white/25 bg-espresso/30">
          <ul className="mx-auto flex max-w-[1800px] gap-3 overflow-x-auto px-4 py-1.5 text-xs font-semibold" aria-label="Data source freshness">
            {sources.map((s) => (
              <li key={s.id} className="flex shrink-0 items-center gap-1.5" title={s.note}>
                <ModeBadge mode={s.mode} /> {s.label}: {s.mode === 'curated' ? `reviewed ${ago(s.dataAsOf, now)}` : s.lastFetchedAt ? `updated ${ago(s.lastFetchedAt, now)}` : s.mode === 'simulated' ? 'sample data' : 'n/a'}
                {s.freshness === 'stale' && <span className="rounded bg-alarm px-1 text-white">STALE</span>}
              </li>
            ))}
          </ul>
        </div>
      </header>

      {/* ---- Mobile tabs */}
      <nav className="sticky top-0 z-[1000] flex border-b border-gold bg-ivory lg:hidden" aria-label="Sections">
        {([['plan', '1 Plan'], ['route', '2 Route'], ['explore', '3 Explore']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} aria-current={tab === id} className={`flex-1 py-3 text-sm font-extrabold ${tab === id ? 'border-b-4 border-burnt text-burnt' : 'text-bark'}`}>{label}</button>
        ))}
      </nav>

      <main id="main" className="mx-auto grid w-full max-w-[1800px] flex-1 gap-4 p-3 lg:min-h-0 lg:grid-cols-[340px_minmax(0,1fr)_410px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden lg:p-4">
        {error && <div role="alert" className="col-span-full flex items-start justify-between gap-2 rounded-xl border-2 border-alarm bg-white p-3 font-semibold text-alarm"><span>⚠ {error}</span><button className="underline" onClick={() => setError(null)}>Dismiss</button></div>}

        {/* ---- Left: setup */}
        <div className={`${tab === 'plan' ? '' : 'hidden'} space-y-3 lg:block lg:overflow-y-auto lg:pr-1`}>
          <Section title="Thanksgiving trip setup">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onPlan(); }}>
              <PlaceField label="From" value={origin} onChange={setOrigin} />
              <div className="flex justify-center"><button type="button" className="btn-ghost !min-h-[36px] !py-0 text-sm" onClick={() => { setOrigin(dest); setDest(origin); }}>⇅ Swap</button></div>
              <PlaceField label="Meet friends at" value={dest} onChange={setDest} />
              <div>
                <label className="label" htmlFor="arrive">Arrive by (Thu, Nov 26)</label>
                <input id="arrive" type="time" required className="input" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <fieldset>
                <legend className="label">Travel mode</legend>
                <div className="grid grid-cols-3 gap-2">
                  {MODES.map((m) => (
                    <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}
                      className={`rounded-xl border-2 py-2 text-sm font-extrabold ${mode === m.id ? 'border-burnt bg-burnt text-white' : 'border-bark/30 bg-white'}`}><span aria-hidden>{m.icon}</span> {m.label}</button>
                  ))}
                </div>
                {mode === 'TRANSIT' && !status?.mapsBrowserKey && <p className="mt-1 text-xs text-bark">Transit needs a Google Maps key. Without one we’ll link out instead of inventing a route.</p>}
              </fieldset>
              <fieldset>
                <legend className="label">Priority</legend>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {PRIOS.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={priority === p.id} onClick={() => setPriority(p.id)}
                      className={`chip ${priority === p.id ? 'border-burnt bg-burnt text-white' : 'border-bark/40 bg-white'}`}>{p.label}</button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="label">Areas I may visit today (optional)</legend>
                <div className="flex flex-wrap gap-1.5">
                  {AREAS.map((a) => {
                    const on = areas.includes(a);
                    return <button key={a} type="button" aria-pressed={on} onClick={() => setAreas(on ? areas.filter((x) => x !== a) : [...areas, a])}
                      className={`chip text-xs ${on ? 'border-leaf bg-leaf/15 text-leaf' : 'border-bark/40 bg-white'}`}>{on ? '✓ ' : ''}{a}</button>;
                  })}
                </div>
              </fieldset>
              <button type="submit" className="btn-primary w-full !min-h-[52px] text-lg" disabled={loading}>{loading ? 'Planning…' : '🍂 Plan My Day'}</button>
              <p className="text-xs text-bark">Your locations stay in this browser tab. {api.backend === 'server' ? 'Requests go to the ParadePilot API.' : 'Planning runs on-device; only map/route providers you configured are called.'}</p>
            </form>
          </Section>
        </div>

        {/* ---- Center: map */}
        <div className="order-first flex min-h-0 flex-col gap-2 lg:order-none">
          <div className="h-[44vh] min-h-[300px] lg:h-auto lg:flex-1"><MapView layers={layers} mapsKey={mapsKey} /></div>
          <Legend show={show} setShow={setShow} />
          {(loading || plan) && <StageChips stage={stage} loading={loading} />}
        </div>

        {/* ---- Right: intelligence */}
        <div className={`${tab === 'route' || tab === 'explore' ? '' : 'hidden'} space-y-3 lg:block lg:overflow-y-auto lg:pr-1`}>
          <div className={`${tab === 'route' ? '' : 'hidden'} space-y-3 lg:block`}>
            {!plan && !loading && (
              <Section title="Ready when you are">
                <p>Choose where you’re starting and where your friends are, then press <b>Plan My Day</b>. We’ll check official closures, traffic and venue activity and propose routes that avoid the parade crowds.</p>
              </Section>
            )}
            {loading && <Section title="Working on it…"><p className="pp-pulse">Collecting sources, checking what’s relevant to your trip, comparing routes.</p></Section>}
            {plan && (
              <>
                <MonitorStrip status={tStatus} polling={polling} setPolling={setPolling} onCheck={() => runCheck(false)} onSimulate={simulate} onClear={clearSim}
                  simEnabled={status?.demoEndpointsEnabled ?? true} hasSim={hasSim} checking={checking} intervalS={Math.round(Math.max(status?.minPollIntervalMs ?? 15000, status?.pollIntervalMs ?? 30000) / 1000)} />
                {showAlert && tStatus && <AlertCard status={tStatus} reviewing={reviewing} dismissed={dismissed}
                  onReview={() => { ack(); setReviewing(true); }} onKeep={() => { ack(); setDismissed(true); setReviewing(false); say('Keeping your current route. We’ll keep watching.'); }}
                  onSwitch={() => { ack(); setConfirm({ kind: 'switch' }); }} />}
                <BriefingPanel plan={plan} areaNotes={areaNotes} sourcesNow={now} />
                <RouteCards plan={plan} selectedId={selectedId} onSelect={selectRoute} busy={loading} />
                {selected && <RouteDetail c={selected} />}
              </>
            )}
          </div>
          <div className={`${tab === 'explore' ? '' : 'hidden'} space-y-3 lg:block`}>
            <ParadePanel info={parade} open={paradeOpen} setOpen={setParadeOpen} origin={origin.location} busy={busy}
              onJoin={(a) => setConfirm({ kind: 'join', area: a })} proposal={stopProposal} onUse={useStopRoute} onCancel={() => setStopProposal(null)} />
            <Kpis plan={plan} alerts={alerts} changes={changes} checks={checks} />
          </div>
        </div>
      </main>

      {toastMsg && <div role="status" className="fixed bottom-4 left-1/2 z-[3000] -translate-x-1/2 rounded-xl bg-espresso px-4 py-2 text-sm font-bold text-white shadow-cozy">{toastMsg}</div>}

      {/* ---- Dialogs */}
      {confirm?.kind === 'switch' && tStatus?.pendingPlan && (() => {
        const alt = tStatus.pendingPlan.candidates.find((c) => c.id === tStatus.alternativeRouteId);
        return (
          <Modal title="Switch to the alternative route?" onClose={() => setConfirm(null)}
            actions={<><button className="btn-secondary" onClick={() => setConfirm(null)}>Not now</button><button className="btn-primary" onClick={doSwitch}>Yes, switch route</button></>}>
            <p>{alt ? <><b>{alt.label}</b>: about {Math.round(alt.durationS / 60)} min, leave by {fmtTime(alt.departAt)} to arrive by {fmtTime(alt.arriveAt)}.</> : 'No alternative available.'}</p>
            {alt && <p>{alt.reason}</p>}
            <p className="text-sm text-bark">Your current route stays in place until you confirm.</p>
          </Modal>
        );
      })()}
      {confirm?.kind === 'join' && (
        <Modal title="Plan a stop at a viewing spot?" onClose={() => setConfirm(null)}
          actions={<><button className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="btn-primary" onClick={() => doJoin(confirm.area)}>Calculate route with stop</button></>}>
          <p><b>{confirm.area.name}</b></p>
          <p className="text-sm">{confirm.area.verificationNote}</p>
          <p className="text-sm">We’ll calculate a proposal and show the extra travel time. Nothing changes until you choose “Use this route”.</p>
          {!plan && <p className="font-bold text-alarm">Plan your trip first.</p>}
        </Modal>
      )}
      {confirm?.kind === 'share' && plan && (
        <Modal title="Share this trip summary?" onClose={() => setConfirm(null)}
          actions={<><button className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn-primary" onClick={async () => {
              const text = summaryText(plan);
              try { if (navigator.share) await navigator.share({ title: 'My ParadePilot route', text }); else { await navigator.clipboard.writeText(text); say('Summary copied to clipboard.'); } } catch { /* user cancelled */ }
              setConfirm(null);
            }}>{typeof navigator !== 'undefined' && 'share' in navigator ? 'Share…' : 'Copy summary'}</button></>}>
          <p className="text-sm">Sharing sends the text below to wherever you choose. ParadePilot itself uploads nothing.</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-cream p-2 text-xs">{summaryText(plan)}</pre>
        </Modal>
      )}
      {confirm?.kind === 'about' && (
        <Modal title="How ParadePilot decides" onClose={() => setConfirm(null)}>
          <ul className="space-y-2 text-sm">
            <li><b>1 · Customer journey.</b> Plan → check official closures → compare routes → monitor and re-route → optionally join the fun, all in one flow.</li>
            <li><b>2 · Distribution.</b> A standalone Google Maps <i>companion</i> (not a Google extension). Share a trip summary, or open any route in Google Maps.</li>
            <li><b>3 · Value.</b> On-time arrival, fewer manual checks, useful route changes. KPIs shown are demo/simulated until instrumented.</li>
            <li><b>4 · Control.</b> Every fact shows its source and age. Unknown stays “unknown”. Venue busyness is a venue-level proxy, never a street crowd meter or a closure. We ask before switching routes or sharing.</li>
          </ul>
          <p className="text-sm text-bark">Official closures come from the NYC 2026 Thanksgiving closure notice (manually curated; map lines are approximate). The parade corridor is a schedule-based estimate, not live GPS.</p>
        </Modal>
      )}
    </div>
  );
}

function Leaves() {
  const leaf = (x: number, r: number, c: string) => <path key={x} transform={`translate(${x} 18) rotate(${r})`} d="M0 -14 C10 -8 12 4 0 16 C-12 4 -10 -8 0 -14Z" fill={c} />;
  return (
    <svg aria-hidden className="pointer-events-none absolute right-0 top-0 h-full w-72 opacity-25" viewBox="0 0 300 60" preserveAspectRatio="xMaxYMid slice">
      {leaf(30, 20, '#E8B66A')}{leaf(80, -35, '#FFF9F0')}{leaf(135, 50, '#E8B66A')}{leaf(190, -10, '#FFF9F0')}{leaf(245, 30, '#E8B66A')}
    </svg>
  );
}
