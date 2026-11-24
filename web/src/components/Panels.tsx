import { useEffect, useRef, type ReactNode } from 'react';
import type { ParadeInfo, RouteCandidate, SourceStatus, TripPlan, TripStatus, ViewingArea } from '@shared/types';
import { haversineM } from '@shared/geo';
import type { MapLayers } from '../mapRenderers';
import { ago, dist, fmtDayTime, fmtTime, mins } from '../util';

export const STAGES = ['Collecting', 'Checking relevance', 'Comparing routes', 'Ready'] as const;

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-display text-lg font-extrabold text-espresso">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

const modeStyle: Record<SourceStatus['mode'], string> = {
  live: 'bg-leaf text-white', simulated: 'bg-gold text-espresso', curated: 'bg-cream text-espresso border border-bark', unavailable: 'bg-white text-alarm border border-alarm',
};
const modeIcon: Record<SourceStatus['mode'], string> = { live: '● Live', simulated: '◐ Simulated', curated: '▤ Curated', unavailable: '✕ Unavailable' };
export const ModeBadge = ({ mode }: { mode: SourceStatus['mode'] }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${modeStyle[mode]}`}>{modeIcon[mode]}</span>
);

export function StageChips({ stage, loading }: { stage: number; loading: boolean }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Agent progress" aria-live="polite">
      {STAGES.map((s, i) => {
        const done = i < stage || (!loading && stage === 3), cur = i === stage && loading;
        return (
          <li key={s} className={`chip text-xs ${done ? 'border-leaf bg-leaf/10 text-leaf' : cur ? 'border-burnt bg-burnt/10 text-burnt pp-pulse' : 'border-bark/30 text-bark/70'}`}>
            <span aria-hidden className="mr-1">{done ? '✓' : cur ? '…' : '○'}</span>{s}
          </li>
        );
      })}
    </ol>
  );
}

export function Legend({ show, setShow }: { show: MapLayers['show']; setShow: (s: MapLayers['show']) => void }) {
  const Item = ({ k, label, swatch }: { k: keyof MapLayers['show']; label: string; swatch: ReactNode }) => (
    <button type="button" aria-pressed={show[k]} onClick={() => setShow({ ...show, [k]: !show[k] })}
      className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-bold ${show[k] ? 'border-bark bg-white' : 'border-bark/30 bg-cream/60 text-bark/60 line-through'}`}>
      {swatch}{label}
    </button>
  );
  const line = (c: string, dash?: string, w = 5) => <svg width="26" height="10" aria-hidden><line x1="1" y1="5" x2="25" y2="5" stroke={c} strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" /></svg>;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Map legend (toggle layers)">
      <Item k="closures" label="Official closure" swatch={<span className="flex items-center gap-1">{line('#9B1C1C')}<span aria-hidden className="rounded bg-alarm px-1 text-[10px] text-white">✕</span></span>} />
      <Item k="traffic" label="Traffic congestion (vehicles)" swatch={<span aria-hidden className="text-[#F2A900]">▲</span>} />
      <Item k="venues" label="Venue activity (proxy)" swatch={<span aria-hidden className="text-bark">◆</span>} />
      <Item k="corridor" label="Scheduled parade corridor" swatch={line('#E8B66A', '2 4', 8)} />
      <Item k="unknown" label="Unknown / no coverage" swatch={<span aria-hidden className="text-bark">◇</span>} />
      <span className="flex items-center gap-1 px-1 text-xs font-bold text-bark">{line('#1F6F54', undefined, 5)}Your route</span>
      <span className="flex items-center gap-1 px-1 text-xs font-bold text-bark">{line('#6B21A8', '6 4', 5)}Simulated</span>
    </div>
  );
}

export function BriefingPanel({ plan, areaNotes, sourcesNow }: { plan: TripPlan; areaNotes: string[]; sourcesNow: number }) {
  const b = plan.briefing;
  const tone = b.verdict === 'clear' ? 'border-leaf bg-leaf/10' : b.verdict === 'no_valid_route' ? 'border-alarm bg-alarm/10' : 'border-burnt bg-burnt/10';
  const icon = b.verdict === 'clear' ? '✓' : b.verdict === 'no_valid_route' ? '⛔' : '⚠';
  const List = ({ items }: { items: string[] }) => <ul className="space-y-1.5 text-[15px] leading-snug">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>;
  const H = ({ children }: { children: ReactNode }) => <h4 className="mb-1 mt-3 text-xs font-extrabold uppercase tracking-wide text-bark">{children}</h4>;
  return (
    <Section title="Agent briefing">
      <p className={`rounded-xl border-2 px-3 py-2 font-bold ${tone}`}><span aria-hidden>{icon} </span>{b.headline}</p>
      <H>What changed?</H><List items={b.whatChanged} />
      <H>Does it affect my trip?</H><List items={b.affectsTrip} />
      {areaNotes.length > 0 && <><H>Areas I may visit</H><List items={areaNotes} /></>}
      <H>Recommended action</H><List items={b.recommendedAction} />
      <H>Evidence &amp; last updated</H>
      <ul className="space-y-1.5 text-sm">
        {b.evidence.map((e, i) => (
          <li key={i} className="flex items-start gap-2">
            <ModeBadge mode={e.mode} />
            <span>
              {e.sourceUrl ? <a className="font-bold text-burnt underline" href={e.sourceUrl} target="_blank" rel="noreferrer">{e.sourceName}</a> : <b>{e.sourceName}</b>}
              {' — '}{e.asOf ? `as of ${fmtDayTime(e.asOf)} (${ago(e.asOf, sourcesNow)})` : 'no timestamp from source'}
              <span className="block text-xs text-bark">{e.text}</span>
            </span>
          </li>
        ))}
      </ul>
      {plan.limitations.length > 0 && (
        <div role="note" className="mt-3 rounded-xl border border-gold bg-cream p-2 text-sm"><b>Limits: </b>{plan.limitations.join(' ')}</div>
      )}
      {plan.fallbackLink && <a className="btn-secondary mt-3 w-full" href={plan.fallbackLink} target="_blank" rel="noreferrer">Open transit directions in Google Maps ↗</a>}
    </Section>
  );
}

const statusBadge = (s: RouteCandidate['status']) =>
  s === 'clear' ? <span className="rounded-full bg-leaf px-2 py-0.5 text-xs font-extrabold text-white">✓ Clear</span>
  : s === 'caution' ? <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-extrabold text-espresso">⚠ Caution</span>
  : <span className="rounded-full bg-alarm px-2 py-0.5 text-xs font-extrabold text-white">⛔ Blocked</span>;

export function RouteCards({ plan, selectedId, onSelect, busy }: { plan: TripPlan; selectedId: string | null; onSelect: (id: string) => void; busy: boolean }) {
  if (plan.candidates.length === 0) return null;
  return (
    <Section title={`Routes (${plan.candidates.length})`}>
      <ul className="space-y-2.5">
        {plan.candidates.map((c) => {
          const sel = c.id === selectedId;
          const disabled = c.status === 'blocked';
          return (
            <li key={c.id}>
              <button type="button" disabled={busy} onClick={() => onSelect(c.id)} aria-pressed={sel}
                className={`w-full rounded-2xl border-2 p-3 text-left transition ${sel ? 'border-leaf bg-leaf/5' : 'border-bark/25 bg-white hover:border-burnt'} ${disabled ? 'opacity-90' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <b className="text-base">{c.label}{c.recommended && <span className="ml-2 rounded-full bg-burnt px-2 py-0.5 text-xs text-white">★ Best</span>}</b>
                  {statusBadge(c.status)}
                </div>
                <p className="mt-1 text-2xl font-extrabold">{mins(c.durationS)} <span className="text-sm font-semibold text-bark">· {dist(c.distanceM)}{c.walkingM !== null && c.mode !== 'WALK' ? ` · ${dist(c.walkingM)} walking` : ''} · {c.mode.toLowerCase()}</span></p>
                <p className="text-sm font-semibold">Leave by {fmtTime(c.departAt)} → arrive {fmtTime(c.arriveAt)}</p>
                <p className="mt-1 text-sm text-bark">{c.reason}</p>
                {c.conflicts.length > 0 && <p className="mt-1 text-sm font-bold text-alarm">⛔ {c.conflicts.length} closure conflict{c.conflicts.length > 1 ? 's' : ''}: {[...new Set(c.conflicts.map((x) => x.title.split(':')[0]))].slice(0, 2).join('; ')}</p>}
                {c.flags.length > 0 && <p className="mt-1 text-xs text-bark">ⓘ {c.flags.slice(0, 3).join(' · ')}</p>}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function RouteDetail({ c }: { c: RouteCandidate }) {
  return (
    <Section title="Step by step" aside={<span className="text-xs font-bold text-bark">{c.provider === 'demo_grid' ? 'Demo grid router' : 'Google Routes'}</span>}>
      <ol className="space-y-1.5 text-[15px]">
        {c.steps.map((s, i) => (
          <li key={i} className="flex gap-2"><span className="w-6 shrink-0 text-right font-extrabold text-burnt">{i + 1}</span>
            <span>{s.instruction}{s.distanceM ? <span className="text-bark"> · {dist(s.distanceM)}</span> : null}{s.kind === 'subway' ? <span className="ml-1 rounded bg-cream px-1 text-xs font-bold">🚇 underground</span> : null}</span></li>
        ))}
      </ol>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-bold">Why this rating? (rule checks)</summary>
        <ul className="mt-2 space-y-1.5">
          {c.rules.map((r) => (
            <li key={r.id}><b>{r.outcome === 'pass' ? '✓' : r.outcome === 'fail' ? '⛔' : r.outcome === 'warn' ? '⚠' : r.outcome === 'unknown' ? '?' : 'ⓘ'} {r.label}:</b> {r.detail}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-bark">Source of route: {c.providerNote}</p>
      </details>
      <a className="btn-primary mt-3 w-full" href={c.googleMapsUrl} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
      <p className="mt-1.5 text-xs text-bark">Google Maps won’t know ParadePilot’s closure list. Check its route against the closures on this map.</p>
    </Section>
  );
}

export function MonitorStrip(props: {
  status: TripStatus | null; polling: boolean; setPolling: (b: boolean) => void; onCheck: () => void; onSimulate: () => void; onClear: () => void;
  simEnabled: boolean; hasSim: boolean; checking: boolean; intervalS: number;
}) {
  const s = props.status;
  const st = s?.state ?? 'on_track';
  const cfg = { on_track: ['✓ On track', 'border-leaf bg-leaf/10'], potential_delay: ['⚠ Potential delay', 'border-gold bg-gold/30'], action_needed: ['⛔ Action needed', 'border-alarm bg-alarm/10'] }[st];
  return (
    <section className={`rounded-2xl border-2 p-3 ${cfg[1]}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-lg">{cfg[0]}</b>
        <span className="text-xs font-semibold text-bark">
          {s ? `Checked ${fmtTime(s.checkedAt)}${s.etaChangeMin !== null ? ` · ETA ${s.etaChangeMin > 0 ? '+' : ''}${s.etaChangeMin} min` : ''}` : 'Not checked yet'}
        </span>
      </div>
      <p className="text-sm">{s?.message ?? 'Monitoring starts once you pick a route.'}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary !min-h-[40px] !py-1.5 text-sm" onClick={props.onCheck} disabled={props.checking}>↻ Check now</button>
        <label className="chip cursor-pointer border-bark/40 bg-white text-xs"><input type="checkbox" className="mr-1.5 h-4 w-4" checked={props.polling} onChange={(e) => props.setPolling(e.target.checked)} />Auto-refresh every {props.intervalS}s</label>
        {props.simEnabled && (
          <>
            <button type="button" className="btn !min-h-[40px] !py-1.5 border-2 border-[#6B21A8] bg-white text-sm text-[#6B21A8] hover:bg-[#6B21A8]/10" onClick={props.onSimulate}>⚡ Simulate disruption</button>
            {props.hasSim && <button type="button" className="btn-ghost !min-h-[40px] !py-1.5 text-sm" onClick={props.onClear}>Clear simulation</button>}
          </>
        )}
      </div>
    </section>
  );
}

export function AlertCard({ status, onReview, onKeep, onSwitch, reviewing, dismissed }: { status: TripStatus; onReview: () => void; onKeep: () => void; onSwitch: () => void; reviewing: boolean; dismissed: boolean }) {
  const a = status.alert;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (a && !dismissed) ref.current?.focus(); }, [a?.title, dismissed]);
  if (!a || dismissed) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="rounded-2xl border-[3px] border-alarm bg-white p-4 shadow-cozy">
      <h3 className="font-display text-lg font-extrabold text-alarm">⛔ {a.title}</h3>
      <p className="mt-1">{a.impact}</p>
      <dl className="mt-2 space-y-1 text-sm">
        <div><dt className="inline font-bold">Confidence: </dt><dd className="inline">{a.confidence}</dd></div>
        <div><dt className="inline font-bold">Delay: </dt><dd className="inline">{a.estimatedDelayMin !== null ? `${a.estimatedDelayMin >= 0 ? '+' : ''}${a.estimatedDelayMin} min vs. current route (calculated)` : 'not calculable'}</dd></div>
        <div><dt className="inline font-bold">Last known: </dt><dd className="inline">{a.lastKnown}</dd></div>
        <div><dt className="inline font-bold">Sources: </dt><dd className="inline">{a.sources.map((s) => `${s.name} (${s.status})`).join('; ')}</dd></div>
      </dl>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button type="button" className="btn-secondary" onClick={onReview} disabled={!status.alternativeRouteId}>{reviewing ? 'Reviewing…' : 'Review alternative'}</button>
        <button type="button" className="btn-secondary" onClick={onKeep}>Keep current route</button>
        <button type="button" className="btn-primary" onClick={onSwitch} disabled={!status.alternativeRouteId}>Switch route</button>
      </div>
      <p className="mt-2 text-xs text-bark">We never change your route without asking.</p>
    </div>
  );
}

export function ParadePanel(props: {
  info: ParadeInfo | null; open: boolean; setOpen: (b: boolean) => void; origin: { lat: number; lng: number } | null;
  onJoin: (a: ViewingArea) => void; busy: boolean; proposal: TripPlan | null; onUse: () => void; onCancel: () => void;
}) {
  const { info } = props;
  return (
    <section className="card overflow-hidden border-2 border-pumpkin/60">
      <button type="button" aria-expanded={props.open} onClick={() => props.setOpen(!props.open)}
        className="flex w-full items-center justify-between gap-2 bg-gradient-to-r from-pumpkin/15 to-gold/30 px-4 py-3 text-left">
        <span className="font-display text-lg font-extrabold"><span aria-hidden>🎈 </span>Parade nearby? Join the fun</span>
        <span aria-hidden className="text-xl">{props.open ? '▾' : '▸'}</span>
      </button>
      {props.open && info && (
        <div className="space-y-3 p-4 text-[15px]">
          <p>{info.scheduleNote}</p>
          <p className="rounded-xl border border-gold bg-cream p-2 text-sm"><b>Heads-up:</b> the parade roadway is closed to the public. ParadePilot only offers side-street viewing spots and never routes you onto closed streets. None of these spots is officially verified for 2026 — check access before going.</p>
          <ul className="space-y-2.5">
            {info.viewingAreas.map((a) => {
              const walkMin = props.origin ? Math.round((haversineM([props.origin.lat, props.origin.lng], [a.location.lat, a.location.lng]) * 1.3) / 1.35 / 60) : null;
              const canJoin = a.verification === 'verified' || a.verification === 'demo_assumed';
              return (
                <li key={a.id} className="rounded-xl border border-bark/30 p-3">
                  <b>{a.name}</b>
                  <p className="text-sm">{a.description}</p>
                  <p className="mt-1 text-xs font-bold text-burnt">{a.verification === 'verified' ? '✓ Verified public viewing area' : '⚠ ' + a.verificationNote}</p>
                  <p className="text-xs text-bark">{a.accessNote}</p>
                  {walkMin !== null && <p className="mt-1 text-sm">≈{walkMin} min walk from your start <span className="text-xs text-bark">(straight-line estimate)</span></p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canJoin
                      ? <button type="button" className="btn-primary !min-h-[40px] !py-1.5 text-sm" disabled={props.busy} onClick={() => props.onJoin(a)}>Join the Parade{a.verification === 'verified' ? '' : ' (demo)'}</button>
                      : <a className="btn-secondary !min-h-[40px] !py-1.5 text-sm" href={a.officialGuidanceUrl} target="_blank" rel="noreferrer">Check access before going ↗</a>}
                    <a className="btn-ghost !min-h-[40px] !py-1.5 text-sm" href={a.officialGuidanceUrl} target="_blank" rel="noreferrer">Official guidance ↗</a>
                  </div>
                </li>
              );
            })}
          </ul>
          {props.proposal && (
            <div className="rounded-xl border-2 border-[#0B5C8A] bg-[#0B5C8A]/5 p-3" role="status">
              <b>Proposed route with a viewing stop: {props.proposal.stop?.label}</b>
              <p className="text-sm">{props.proposal.stopDetour ? `Adds ≈${props.proposal.stopDetour.extraMin} min of travel (${props.proposal.stopDetour.baselineMin} → ${props.proposal.stopDetour.baselineMin + props.proposal.stopDetour.extraMin} min). ${props.proposal.stopDetour.note}` : 'Extra time could not be calculated.'}</p>
              {!props.proposal.candidates.some((c) => c.recommended) && <p className="text-sm font-bold text-alarm">No closure-free route reaches this stop in your time window.</p>}
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn-primary !min-h-[40px] !py-1.5 text-sm" onClick={props.onUse} disabled={!props.proposal.candidates.some((c) => c.recommended)}>Use this route</button>
                <button type="button" className="btn-secondary !min-h-[40px] !py-1.5 text-sm" onClick={props.onCancel}>Dismiss</button>
              </div>
            </div>
          )}
          <p className="text-sm">Official links: {info.officialLinks.map((l, i) => <span key={l.url}>{i ? ' · ' : ''}<a className="font-bold text-burnt underline" href={l.url} target="_blank" rel="noreferrer">{l.label}</a></span>)}</p>
          <details className="text-sm"><summary className="cursor-pointer font-bold">All {info.closureSummary.length} street closures in the notice</summary>
            <ul className="mt-1 list-disc pl-5">{info.closureSummary.map((c, i) => <li key={i}>{c.title}: {fmtDayTime(c.startsAt)} → {fmtDayTime(c.endsAt)}</li>)}</ul></details>
        </div>
      )}
    </section>
  );
}

export function Kpis({ plan, alerts, changes, checks }: { plan: TripPlan | null; alerts: number; changes: number; checks: number }) {
  const Tile = ({ v, l }: { v: string; l: string }) => <div className="rounded-xl bg-cream p-2.5 text-center"><div className="font-display text-2xl font-extrabold text-burnt">{v}</div><div className="text-xs font-bold text-bark">{l}</div></div>;
  const k = plan?.kpis;
  return (
    <Section title="Measure: what it improves" aside={<span className="chip border-gold bg-gold/30 text-xs">Demo / simulated</span>}>
      <div className="grid grid-cols-2 gap-2">
        <Tile v={k?.etaDiffMin == null ? '—' : `${k.etaDiffMin >= 0 ? '+' : ''}${k.etaDiffMin} min`} l="Expected ETA difference" />
        <Tile v={k?.minutesSavedEst == null ? '—' : `~${k.minutesSavedEst} min`} l="Potential minutes saved" />
        <Tile v={String(alerts)} l="Alerts acknowledged" />
        <Tile v={String(changes)} l="Route changes accepted" />
        <Tile v={String(checks)} l="Manual checks avoided" />
        <Tile v={String(plan?.sources.length ?? 0)} l="Sources cited" />
      </div>
      <p className="mt-2 text-xs text-bark">{k?.basis ?? 'Plan a trip to see estimates.'} These are demo values, not instrumented measurements.</p>
    </Section>
  );
}

export function Modal({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[2000] grid place-items-center bg-espresso/60 p-4" onMouseDown={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()} className="card max-h-[90vh] w-full max-w-lg overflow-auto p-5">
        <h2 className="font-display text-xl font-extrabold">{title}</h2>
        <div className="mt-2 space-y-2 text-[15px]">{children}</div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">{actions ?? <button className="btn-primary" onClick={onClose}>Close</button>}</div>
      </div>
    </div>
  );
}
