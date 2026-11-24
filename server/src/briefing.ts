// Deterministic, template-based briefing. Uses only normalized, sourced facts — no LLM required.
import type { Briefing, SourceStatus, TripPlan } from '../../shared/types';

const fmt = (iso: string | number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const fmtDay = (iso: string | number) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

const modeLabel = (s: SourceStatus) =>
  s.mode === 'live' ? 'live' : s.mode === 'simulated' ? 'SIMULATED' : s.mode === 'curated' ? 'curated' : 'unavailable';

export function buildBriefing(plan: TripPlan, ctx: { closureCount: number; noRoute: boolean }): Briefing {
  const best = plan.candidates.find((c) => c.recommended) ?? null;
  const blocked = plan.candidates.filter((c) => c.status === 'blocked');
  const req = plan.request;
  const src = (id: SourceStatus['id']) => plan.sources.find((s) => s.id === id)!;
  const notices = src('officialNotices'), traffic = src('traffic'), venues = src('venueBusyness');

  const whatChanged = [
    `${ctx.closureCount} official street closure${ctx.closureCount === 1 ? ' is' : 's are'} in effect during your trip window (NYC notice, reviewed ${fmtDay(notices.dataAsOf ?? plan.createdAt)}).`,
    `The Macy's parade is scheduled 9am–noon along CPW → Columbus Circle → 6th Ave (estimated, not tracked live).`,
    req.mode === 'DRIVE'
      ? `Vehicle traffic: ${traffic.mode === 'live' ? 'live flow samples' : 'SIMULATED samples'} along your routes.`
      : `Venue activity near Midtown is shown as a proxy (${modeLabel(venues)}), not street crowd density.`,
  ];

  const affectsTrip: string[] = [];
  const naive = plan.candidates.find((c) => c.status === 'blocked');
  if (ctx.noRoute) {
    affectsTrip.push(plan.limitations[0] ?? 'No validated route is available for this request.');
  } else if (naive) {
    const names = [...new Set(naive.conflicts.map((c) => c.title.split(':')[0]))];
    affectsTrip.push(`Yes — a direct route would run into ${names.slice(0, 2).join(' and ')}${names.length > 2 ? ` (+${names.length - 2} more)` : ''}.`);
    affectsTrip.push('ParadePilot treats those closures as impassable; police-controlled crossings, if any, are not in the notice.');
  } else {
    affectsTrip.push('No active closure overlaps your route in your trip window.');
  }
  if (best?.flags.some((f) => f.includes('not a forecast'))) affectsTrip.push('Traffic shown is current conditions, not a forecast for your arrival time.');

  const evidence: Briefing['evidence'] = [
    { text: `${notices.label}: ${notices.note}`, sourceName: notices.provider, sourceUrl: notices.sourceUrl, asOf: notices.dataAsOf, mode: notices.mode },
    { text: `${traffic.label}: ${traffic.note}`, sourceName: traffic.provider, sourceUrl: traffic.sourceUrl, asOf: traffic.lastFetchedAt, mode: traffic.mode },
    { text: `${venues.label}: ${venues.note}`, sourceName: venues.provider, sourceUrl: venues.sourceUrl, asOf: venues.lastFetchedAt, mode: venues.mode },
    { text: `${src('routing').label}: ${src('routing').note}`, sourceName: src('routing').provider, sourceUrl: src('routing').sourceUrl, asOf: src('routing').lastFetchedAt, mode: src('routing').mode },
  ];

  const recommendedAction: string[] = [];
  let verdict: Briefing['verdict'] = 'clear';
  let headline = '';
  if (!best) {
    verdict = 'no_valid_route';
    headline = 'No validated route';
    recommendedAction.push(req.mode === 'TRANSIT' ? 'Open transit directions in Google Maps and check MTA service advisories.' : 'Check official guidance before travelling; every candidate we found overlaps a closure.');
  } else {
    const mins = Math.round(best.durationS / 60);
    verdict = naive ? 'action_needed' : best.status === 'caution' ? 'caution' : 'clear';
    headline = naive ? 'Take the closure-aware route' : best.status === 'caution' ? 'Route is clear, with cautions' : 'Your route looks clear';
    recommendedAction.push(`Take "${best.label}": about ${mins} min, leave by ${fmt(best.departAt)} to arrive by ${fmt(best.arriveAt)}.`);
    if (plan.kpis.etaDiffMin && plan.kpis.etaDiffMin > 0) recommendedAction.push(`That is about ${plan.kpis.etaDiffMin} min longer than the closure-blind route, which you cannot actually use.`);
    if (blocked.length === 0 && naive === undefined) recommendedAction.push('Keep an eye on the status strip; we will re-check while this page is open.');
  }
  return { whatChanged, affectsTrip, evidence, recommendedAction, verdict, headline };
}
