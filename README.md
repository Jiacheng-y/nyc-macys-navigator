# ParadePilot 🦃 — "Meet your friends, not the traffic."

A mobile-first **Google Maps companion** web app for getting around Manhattan on **Thanksgiving Day (Nov 26, 2026)** without walking or driving into the Macy's parade closures. It is *not* an official Google Maps plugin; every route has an **Open in Google Maps** link.

Flow: set trip → **Plan My Day** → agent briefing (what changed / does it affect me / evidence / action) → 2–3 route options → pick one → live monitoring → **Simulate disruption** → alert → *Review / Keep / Switch* (with confirmation) → optional **Parade nearby? Join the fun**.

## Quick start (no keys needed)

```bash
npm install
npm run dev          # http://localhost:5173  — Demo Simulation Mode works immediately
npm test             # unit tests (closure-vs-route, normalization, stale data, simulation fallback, end-to-end demo plan)
npm run build        # static site in web/dist
```

## Hosting on GitHub Pages (static, no server)

The planning engine (`server/src/engine.ts`, planner, adapters) is browser-safe and runs **inside the page**, so Pages is enough.

1. Push to GitHub; Settings → Pages → Source: **GitHub Actions**. `.github/workflows/pages.yml` tests, builds and deploys on every push to `main`.
2. Optional live Google: add repo secret `VITE_GOOGLE_MAPS_BROWSER_KEY` (Maps JavaScript + Routes + Geocoding APIs enabled). **It ships in public JS** → restrict it by HTTP referrer to `https://<user>.github.io/*`, cap quota, and use a demo key only. If Routes rejects referrer-restricted calls, the app says so and falls back to the demo grid router.
3. `vite.config.ts` uses `base: './'`, so project sub-paths (`/repo-name/`) work.

> Anything with a *private* key can't live in a static site. **BestTime** (private key) therefore stays simulated on Pages. To use it, run the optional Express server somewhere and set repo variable `VITE_API_BASE` to its URL (`npm run dev:api` locally; `npm run dev:full` runs both).

## Data sources and honesty rules

| Input | Source | Live when | Otherwise |
|---|---|---|---|
| Vehicle traffic | TomTom Traffic Flow (`flowSegmentData`) | `VITE_TOMTOM_API_KEY` (Pages) or `TOMTOM_API_KEY` (server) | Labelled **Simulated**. Vehicle congestion only; current conditions, **not a forecast** for Thursday; no per-segment timestamp is returned, so `observedAt` stays `null`. |
| Crowd proxy | BestTime Live Foot Traffic (`forecasts/now`) | Server only: `BESTTIME_API_KEY_PRIVATE` + `BESTTIME_VENUE_IDS=slug:ven_id,…` | Labelled **Simulated**. Venue-level point markers, never a street crowd score or closure. Venues without live data are **Unknown** (hollow ◇). |
| Official closures | NYC 2026 Thanksgiving closure notice (PDF) + NYC DOT Weekly Advisory | Always (curated) | `server/src/data/official-notices.json` — 26 rows transcribed from the PDF, `lastReviewedAt`, source URLs. **Not a live API.** The PDF has no publication date (recorded as `null`). The DOT advisory is linked, not imported. |
| Routing | Google Routes API (+ Maps JS for the basemap) | Google key | **Demo grid router**: a simplified 14th–90th St Manhattan grid (no one-ways/subway/park paths), clearly labelled. **Transit is not faked** — without Google you get a link-out. |
| Parade position | — | — | Scheduled/estimated corridor only (CPW → Columbus Circle → CPS → 6th Ave to 34th). 9am–noon is the *typical* schedule, not verified for 2026. **No GPS feed.** |

* **Closure geometry is illustrative.** The notice gives street names and boundaries, not coordinates. Lines live in `illustrativeGeometry.ts`, are tagged `geometryBasis: "illustrative"`, and routes are checked with a 35 m tolerance. Police-controlled crossing points aren't listed in the notice, so closures are treated as impassable.
* **Transit**: only walking/bus legs are checked against street closures; subway legs are not. MTA bus reroutes aren't covered by the notice.
* **Viewing spots** in `viewing-areas.json` are `demo_assumed` — *not* verified. The UI says so, links official guidance, and the "Join" flow only proposes a route you must confirm. Replace with `verified` entries when official guidance exists.
* The briefing is a deterministic template; no LLM is used (and none is needed).
* KPIs are demo/simulated until instrumented. "Minutes saved" is a demo-grid model estimate.

### Normalized event
`id, category, title, geometry (GeoJSON), geometryBasis, severity, status, startsAt, endsAt, observedAt, fetchedAt, sourceName, sourceUrl, confidenceExplanation, affectedModes` — unknowns stay `null`.

### Pricing / quota caveats
Google Maps Platform (Maps JS, Routes, Geocoding), TomTom and BestTime are metered and their free tiers/pricing change — check their pricing pages. Responses are cached (traffic 60 s, venues 5 min, routes 2 min) and monitoring polls every ≥15 s (default 30 s, only while the page is open).

## Optional Express API (`server/`)
Same engine behind HTTP: `GET /api/status|places|disruptions?bbox=|parade|venues/busyness?bbox=`, `POST /api/trips/plan`, `POST /api/trips/:id/replan|select`, `GET /api/trips/:id/status`, demo-only `POST /api/demo/simulate-disruption` (gate with `ENABLE_DEMO_ENDPOINTS=false`), and `POST /api/admin/notices/import` (header `x-admin-token`, body = same shape as `official-notices.json`, validated with zod) for refreshing the curated notices. See `.env.example`.

## Layout
`shared/` types + geometry · `server/src/` adapters (`tomtomTraffic`, `besttimeCrowds`, `officialNotices`, `googleRoutes`, `demoFixtures`), `grid.ts`, `evaluate.ts`, `planner.ts`, `engine.ts`, Express `app.ts` · `web/` React + Vite + Tailwind (Google map, auto-falls back to OpenStreetMap/Leaflet if no key or the key is rejected).

## Sources
[NYC closures PDF](https://www.nyc.gov/assets/cecm/downloads/pdf/thanksgiving-standard-street-closures-2026.pdf) · [NYC DOT Weekly Advisory](https://www.nyc.gov/html/dot/html/motorist/weektraf.shtml) · [TomTom Flow Segment Data](https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-flow/flow-segment-data) · [BestTime docs](https://documentation.besttime.app/) · [Google Routes API](https://developers.google.com/maps/documentation/routes/)
