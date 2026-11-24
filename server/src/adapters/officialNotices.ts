import { z } from 'zod';
import type { DisruptionEvent, SourceStatus } from '../../../shared/types';
import { llToLineString } from '../../../shared/geo';
import { CLOSURE_GEOMETRY, PARADE_CORRIDOR } from '../illustrativeGeometry';
import { freshness } from '../freshness';
import { config } from '../config';

import bundled from '../data/official-notices.json';

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO-8601 timestamp');
export const NoticeSchema = z.object({
  id: z.string().min(1),
  street: z.string().min(1),
  boundaries: z.string().nullable(),
  restriction: z.string(),
  startsAt: iso.nullable(),
  endsAt: iso.nullable(),
  status: z.enum(['official_confirmed', 'estimated', 'unknown']),
  sourceName: z.string(),
  sourceUrl: z.string().url().nullable(),
  note: z.string().nullable().optional(),
});
export const NoticeFileSchema = z.object({
  meta: z.object({
    lastReviewedAt: iso,
    reviewedBy: z.string(),
    documentTitle: z.string(),
    publishedAt: iso.nullable(),
    publishedAtNote: z.string().optional(),
    sources: z.array(z.object({ name: z.string(), url: z.string().url(), note: z.string().optional() })),
  }),
  notices: z.array(NoticeSchema),
});
export type NoticeFile = z.infer<typeof NoticeFileSchema>;

/** Runtime override set by the admin import (server) so imports take effect without a restart. */
let override: NoticeFile | null = null;
export function loadNoticeFile(): NoticeFile {
  return override ?? NoticeFileSchema.parse(bundled);
}
export function setNoticeOverride(f: NoticeFile | null) { override = f; }

/**
 * Normalize curated notices into disruption events. Rows without map geometry (new imports) are kept
 * out of the map and route checks rather than guessed; add a line to illustrativeGeometry.ts to draw them.
 */
export function normalizeNotices(file: NoticeFile, fetchedAt: string, geometry = CLOSURE_GEOMETRY): DisruptionEvent[] {
  const out: DisruptionEvent[] = [];
  for (const n of file.notices) {
    const line = geometry[n.id];
    if (!line) continue;
    out.push({
      id: n.id,
      category: 'official_closure',
      title: `${n.street}${n.boundaries ? ` — ${n.boundaries}` : ''}: ${n.restriction}`,
      geometry: llToLineString(line),
      geometryBasis: 'illustrative',
      severity: 'high',
      status: n.status,
      startsAt: n.startsAt,
      endsAt: n.endsAt,
      observedAt: null,
      fetchedAt,
      sourceName: n.sourceName,
      sourceUrl: n.sourceUrl,
      confidenceExplanation:
        'Closure text is from the official NYC notice (manually curated); the drawn line is an approximation. Closures are subject to change at the direction of the NYPD.' +
        (n.note ? ` ${n.note}` : ''),
      affectedModes: ['WALK', 'DRIVE', 'TRANSIT'],
      metrics: { reviewedAt: file.meta.lastReviewedAt },
    });
  }
  return out;
}

export function paradeCorridorEvent(fetchedAt: string): DisruptionEvent {
  return {
    id: 'parade-corridor-2026',
    category: 'parade_schedule',
    title: "Scheduled Macy's parade corridor (CPW → Columbus Circle → CPS → 6th Ave to 34th St)",
    geometry: llToLineString(PARADE_CORRIDOR),
    geometryBasis: 'illustrative',
    severity: 'unknown',
    status: 'estimated',
    startsAt: '2026-11-26T09:00:00-05:00',
    endsAt: '2026-11-26T12:00:00-05:00',
    observedAt: null,
    fetchedAt,
    sourceName: "NYC 2026 street-closure notice (route description) + typical Macy's schedule",
    sourceUrl: 'https://www.nyc.gov/assets/cecm/downloads/pdf/thanksgiving-standard-street-closures-2026.pdf',
    confidenceExplanation:
      "Route description is from the NYC notice. The 9am–noon timing is the typical schedule from prior years — confirm on the official Macy's site. This is a scheduled corridor, NOT a live parade position feed.",
    affectedModes: ['WALK', 'DRIVE', 'TRANSIT'],
  };
}

export function getOfficialNotices(now = Date.now(), file: NoticeFile = loadNoticeFile()) {
  const fetchedAt = new Date(now).toISOString();
  const events = normalizeNotices(file, fetchedAt);
  const status: SourceStatus = {
    id: 'officialNotices',
    label: 'Official street closures',
    provider: 'NYC 2026 parade closure notice + NYC DOT Weekly Advisory',
    mode: 'curated',
    lastFetchedAt: fetchedAt,
    dataAsOf: file.meta.lastReviewedAt,
    freshness: freshness(file.meta.lastReviewedAt, config.staleNotices, now),
    note: `Manually curated from the official PDF (not a live API). ${file.notices.length} rows; last reviewed ${file.meta.lastReviewedAt}. The DOT Weekly Advisory is linked, not auto-imported.`,
    sourceUrl: file.meta.sources[0]?.url ?? null,
  };
  return { events, status, file };
}
