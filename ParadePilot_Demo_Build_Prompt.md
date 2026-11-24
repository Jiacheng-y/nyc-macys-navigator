# Build Prompt — ParadePilot Thanksgiving Navigation Demo

Build a **working, polished, responsive full-stack demo**, not just a static mockup. Project name: **ParadePilot**. Tagline: **“Meet your friends, not the traffic.”** The product is a **Google Maps companion web app** (not an official Google Maps plugin) for New Yorkers who are traveling to meet friends on **Thanksgiving Day, November 26, 2026**, and may pass through the Macy’s Thanksgiving Day Parade area. It should proactively explain how parade progress, traffic, pedestrian activity, and official closures affect a personal trip, then offer more detailed, safer alternatives. Secondary feature: let users discover nearby public parade viewing opportunities and opt to join the festivities.

## 1. User outcome and product criteria

**Core journey:** Set origin, destination, optional places/areas to visit today, target arrival time, travel mode, and preferences → press **Plan My Day** → agent checks relevant disruptions with timestamps and evidence → personalized risk alert → 2–3 comparable route options, with clear step-by-step instructions and tradeoffs → user accepts a route → agent monitors and suggests a new one if conditions change. User should also be able to inspect parade locations and optionally choose **Join the Parade**, which updates their route through a *verified accessible viewing area* instead of assuming the parade route itself is walkable.

Use the lecture’s **four product-strategy criteria** explicitly:
1. **Customer Journey — Where do we fit?** Make planning, monitoring, rerouting, and optional parade discovery feel like one low-effort journey.
2. **Distribution — Why pick us?** A simple standalone Google Maps companion with a shareable trip summary, evidence-based parade intelligence, and a **Open in Google Maps** deep link. Do not claim to be a native Google Maps extension.
3. **Value — How do we earn?** Deliver on-time arrivals, fewer manual checks, and useful route changes. Show demo KPIs: expected ETA difference, potential minutes saved, alerts acknowledged, and route changes accepted. Clearly label metrics as demo/simulated until instrumented.
4. **Control — What do we safeguard?** Cite data provenance, mark unknowns, minimize location collection, ask before switching routes or sharing a trip, and never treat unverified crowd signals as confirmed closures.

## 2. Three core data inputs (plus routing)

Create independently testable **backend adapters** with a shared normalized event schema. Do not expose secret keys in the browser.

| Input | Selected source | Integration and important limitations |
|---|---|---|
| **Vehicle traffic** | **TomTom Traffic Flow API** | Query road segments near the planned route on the server. Map `currentSpeed`, `freeFlowSpeed`, `roadClosure`, observation time, and source. Show vehicle congestion only; do **not** use it as pedestrian density. API docs: https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-flow/flow-segment-data |
| **Crowd activity proxy** | **BestTime Live Foot Traffic API** | Fetch available **venue-level busyness** for selected nearby restaurants/attractions where a valid venue ID and API access exist. Label `Venue busyness (proxy)` rather than real-time sidewalk density. It is **not** a street-segment crowd sensor, should **not** be used to declare a street blocked, and live values may be absent. Docs: https://documentation.besttime.app/ and https://besttime.app/api/v1/docs |
| **Official notices** | **NYC 2026 parade street-closure notice** and **NYC DOT Weekly Traffic Advisory** | Include an attributable, manually curated `official-notices.json` seed based on verified announcements, with street name/segment, closure start/end if explicit, publication/update time, `sourceUrl`, and `status`. Do not pretend a PDF is a live API. Provide an admin refresh/import workflow and a `lastReviewedAt` field. Official sources: https://www.nyc.gov/assets/cecm/downloads/pdf/thanksgiving-standard-street-closures-2026.pdf and https://www.nyc.gov/html/dot/html/motorist/weektraf.shtml |
| **Routing and map visualization** | **Google Maps Platform** | Google Maps JavaScript API for basemap and markers; Routes API for routes, ETAs, and alternatives where available. Traffic-aware routing is primarily for supported motorized travel modes; do not imply live traffic-aware pedestrian routing. Docs: https://developers.google.com/maps/documentation/routes/ |

Use **real API responses when valid keys are supplied**; otherwise activate an explicit **Demo Simulation Mode** with deterministic seeded sample data and a visible “Simulated data” label. Never disguise mock data as live or claim minute-by-minute parade location if no verified feed exists. Parade progress can be represented as **scheduled/estimated** positions with an uncertainty label based on official event details, not as GPS tracking.

## 3. UI screens and exact workflow

**Screen A — Thanksgiving Trip Setup**
- Header: ParadePilot logo, “Thanksgiving in NYC”, a small `Live / Demo` badge, source freshness status.
- Left panel: Google Places-supported origin/destination inputs where configured; default example trip in Manhattan; target arrival time; optional `Areas I may visit today` chips; Walking / Driving / Transit preference (if a mode cannot be routed by the configured API, say so and provide a link out instead of fabricating a route); priority toggle `Fastest / Less crowd exposure / Less walking`.
- Prominent orange **Plan My Day** button.

**Screen B — Personalized Route Intelligence**
- Large central interactive Google map: origin and destination pins, parade corridor, verified street closures, vehicle-traffic overlay or colored traffic markers, venue busyness *at venue points only*, selected route and alternatives. Legend MUST distinguish `Official closure`, `Traffic congestion`, `Venue activity proxy`, `Scheduled parade corridor`, and `Unknown / no coverage`.
- Right-side **Agent Briefing**: “What changed?”, “Does it affect my trip?”, “Evidence & last updated”, “Recommended action”. Use plain English, 2–4 short statements, not a wall of chat text. Show simple agent stages: `Collecting → Checking relevance → Comparing routes → Ready`.
- Route cards (2–3 if available): ETA, estimated arrival, travel mode, time/distance, walking distance where supported, known closure conflicts, uncertainty flags, and concise reason for choosing each. Clearly warn if no validated route is available.
- Select a route → detailed turn-by-turn steps from actual route data when provided, with source attribution. **Open in Google Maps** action using an appropriate Google Maps Directions URL with origin, destination, and travel mode. Do not imply that custom closures will automatically carry over into Google Maps.

**Screen C — Monitoring & Proactive Rerouting**
- Trip status strip: `On track / Potential delay / Action needed`, latest refresh time, optional ETA change.
- Periodically refresh supported data while the page is open using configurable intervals and rate limits. Compare source-stamped snapshots with the chosen route. For the demo, provide an explicit **Simulate disruption** control that inserts a new *clearly labeled simulated event* on the selected route.
- If disruption intersects the selected route, show alert: impact, confidence, supporting sources, estimated delay *only if calculable*, and an alternative route. Buttons **Review alternative**, **Keep current route**, and **Switch route** (confirmation required). Do not silently modify the user's route.

**Screen D — Explore the Parade (secondary feature)**
- A collapsible **“Parade nearby? Join the fun”** panel with the scheduled parade corridor and publicly verified viewing information, estimated walking time from current origin/route if available, and a warm **Explore viewing spots** action.
- Show `Join the Parade` only for a **verified publicly accessible viewing area**; never place users inside the closed parade roadway or invent an entrance/crossing. If access information is uncertain, link to official event guidance with “Check access before going.”
- Re-plan the trip with the viewing area as an optional stop, highlight extra journey time, and require confirmation.

## 4. Agent logic (transparent and deterministic for safety)

1. Parse trip intent, normalize places and chosen transportation mode, and geocode addresses.
2. Retrieve `traffic`, `venueBusyness`, and `officialNotices` concurrently from server adapters; validate types, preserve raw provenance, and record retrieval timestamps.
3. Retrieve supported candidate routes; check each route geometry against verified closure segments/polygons using actual geospatial intersection or distance checks. Never rely on Google routing alone to recognize new official restrictions.
4. Calculate a route risk summary using **verified closures as hard constraints**, traffic severity for driving, venue-level busyness only as contextual nearby activity, freshness, and data gaps. **Do not turn venue busyness into a street-level pedestrian-density score.** Expose explainable rule results rather than arbitrary confidence percentages.
5. Recommend the best *validated* candidate with plain-language reasoning; if all candidates are affected or unsupported, state the limitation and link to official guidance.
6. Monitor updates, detect meaningful impact to the chosen route, and ask permission before switching. If an LLM is available, use it only to summarize normalized, sourced facts and to explain tradeoffs, not to invent events, timestamps, locations, or routes. A deterministic template-based agent must work without an LLM key.

**Normalized disruption object:** `id`, `category` (`official_closure | vehicle_traffic | venue_busyness | parade_schedule | simulated`), `title`, `geometry` (GeoJSON point/line/polygon), `severity`, `status` (`official_confirmed | observed | estimated | unknown | simulated`), `startsAt`, `endsAt`, `observedAt`, `fetchedAt`, `sourceName`, `sourceUrl`, `confidenceExplanation`, `affectedModes`. Preserve `null` for unknown fields.

## 5. Implementation requirements

- **Frontend:** React + TypeScript + Vite + Tailwind CSS, mobile-first but optimized for desktop demo. Accessible, high contrast, keyboard usable.
- **Backend:** Node.js + Express + TypeScript (or Fastify), with typed API contracts, input validation, CORS, error handling, basic caching, polling limits, and `.env.example`.
- **Suggested endpoints:** `GET /api/status`, `GET /api/disruptions?bbox=...`, `GET /api/parade`, `POST /api/trips/plan`, `POST /api/trips/:id/replan`, `GET /api/trips/:id/status`, `GET /api/venues/busyness?bbox=...`, `POST /api/demo/simulate-disruption` (demo-only, gated).
- Adapter modules: `tomtomTraffic.ts`, `besttimeCrowds.ts`, `officialNotices.ts`, `googleRoutes.ts`, plus `demoFixtures.ts`. Handle missing credentials or API failures without blank screens.
- Provide sample 2026 Thanksgiving parade notice records **only where verifiable from the linked official source**. Store approximate demo map geometry separately as `illustrative` unless verified. Do not imply a dynamically tracked parade GPS position.
- Provide a README with installation commands, how to obtain and configure keys, exact feature availability per API, service pricing/quota caveats, mock versus live modes, source links, and startup commands. Do not hardcode API keys.
- Include working unit tests for closure-vs-route checks, data normalization, stale-data handling, and simulation fallback.
- **Acceptance:** `npm install` and a documented single development command start frontend and backend; default Demo Mode works immediately with no credentials. In Live Mode, available authenticated sources actually fetch data; unavailable ones show a clear fallback label. All visible buttons must work.

## 6. Visual direction — warm Thanksgiving, high contrast

Use a distinctive **warm orange + ivory white** identity with deep brown text, accessible contrast, cozy rounded cards, clean typography, soft shadows, festive autumn leaves, and subtle Thanksgiving motifs (small turkey / pumpkin icons used sparingly). Suggested palette: pumpkin orange `#D65A1F`, burnt orange `#B64013`, warm ivory `#FFF9F0`, dark espresso `#2D241F`, muted gold `#E8B66A`. Primary call-to-action buttons should be bold orange with readable white text. Keep emergency notices visually distinct and never convey risk with color alone. Make the map the visual centerpiece, with a clean side-panel workflow, minimal scrolling, animated but restrained agent status, and polished responsive states. Avoid generic blue SaaS styling.

## 7. Final demo script (90 seconds)

1. **Plan:** User enters origin and friend's meetup spot with an arrival time; click **Plan My Day**.
2. **Explain:** Show official parade closure corridor, traffic conditions, available nearby venue activity, and a source-cited personalized route recommendation.
3. **React:** Click **Simulate disruption**; agent detects overlap, shows warning and last-known data, proposes a safer alternative; user confirms rerouting.
4. **Explore:** Open **Parade nearby? Join the fun** and show an optional officially supported viewing area, without routing through a blocked street.
5. **Measure:** Briefly show what the product improves: ETA impact, manual checks avoided, clear source provenance, user control.

**Output the complete runnable project with frontend, backend, working integrations where keys exist, explicit simulation fallback, tests, and README. Do not stop at a wireframe or write a product essay. Prioritize a convincing end-to-end interactive flow and accurate labeling of uncertain data over adding many unrelated features.**
