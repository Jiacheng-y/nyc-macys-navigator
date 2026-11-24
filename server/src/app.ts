// Optional Express wrapper around the engine (for local dev with live server-side keys, or a separate host).
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { ZodError } from 'zod';
import { config } from './config';
import { createEngine, HttpError } from './engine';
import type { PlanDeps } from './planner';
import { importNoticeFile } from './adminNotices';

function rateLimit(perMin: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = req.ip ?? 'x', now = Date.now();
    const h = hits.get(k);
    if (!h || now > h.reset) hits.set(k, { n: 1, reset: now + 60_000 });
    else if (++h.n > perMin) return res.status(429).json({ error: 'Too many requests — polling is rate limited.' });
    next();
  };
}

const bboxParam = (v: unknown): [number, number, number, number] | null => {
  if (typeof v !== 'string') return null;
  const p = v.split(',').map(Number);
  return p.length === 4 && p.every(Number.isFinite) ? (p as [number, number, number, number]) : null;
};

export function createApp(deps: PlanDeps = {}) {
  const app = express();
  const eng = createEngine(deps);
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '500kb' }));
  app.use('/api', rateLimit(config.rateLimitPerMin));
  const h = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).then((out) => { if (out !== undefined && !res.headersSent) res.json(out); }).catch(next);

  app.get('/api/status', h(() => eng.status()));
  app.get('/api/places', h((req) => eng.places(String(req.query.q ?? ''))));
  app.get('/api/disruptions', h((req) => eng.disruptions(bboxParam(req.query.bbox) ?? [-74.02, 40.73, -73.94, 40.8])));
  app.get('/api/venues/busyness', h((req) => eng.venues(bboxParam(req.query.bbox))));
  app.get('/api/parade', h(() => eng.parade()));
  app.post('/api/trips/plan', h((req) => eng.plan(req.body)));
  app.post('/api/trips/:id/replan', h((req) => eng.replan(req.params.id, req.body?.viaViewingAreaId ?? null)));
  app.post('/api/trips/:id/select', h((req) => eng.select(req.params.id, String(req.body?.routeId), !!req.body?.fromPending)));
  app.get('/api/trips/:id/status', h((req) => eng.tripStatus(req.params.id)));
  app.post('/api/demo/simulate-disruption', h((req) => eng.simulateDisruption(String(req.body?.tripId))));
  app.post('/api/demo/clear-simulation', h((req) => eng.clearSimulation(String(req.body?.tripId))));
  app.post('/api/admin/notices/import', h((req, res) => {
    if (!config.adminToken) return res.status(403).json({ error: 'Admin import disabled: set ADMIN_TOKEN.' });
    if (req.header('x-admin-token') !== config.adminToken) return res.status(401).json({ error: 'Bad admin token' });
    const file = importNoticeFile(req.body);
    return { ok: true, notices: file.notices.length, lastReviewedAt: file.meta.lastReviewedAt };
  }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid request', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    console.error('[api error]', err);
    res.status(500).json({ error: 'Something went wrong on our side. Your last good plan is unchanged.' });
  });
  return app;
}
