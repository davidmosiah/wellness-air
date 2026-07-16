# Changelog

## 0.5.7 — 2026-07-16

### Fixed

- Added executable provider-boundary contracts for AirGradient, AirThings, and PurpleAir, covering exact endpoints, authentication placement, identifier encoding, and canonical field mapping.
- AirGradient history reads now reject non-integer or out-of-range windows before any network request.
- Updated the transitive Hono security override to 4.12.30.

All notable changes to `wellness-air` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.4] - 2026-05-20

### Added

- **`air_trend` MCP tool — windowed trend analysis with rate-of-change + conservative natural-language observations.** Pulls past measurements from AirGradient (public or owned sensor) for the configured location across a `hours` window (1-168, default 24) and computes per-pollutant `mean`, `median`, `min`, `max`, `current`, `rate_of_change_per_hour` (Δ mean of last 25% vs first 25% of window, divided by hours), `peak_at` / `trough_at` (ISO timestamps), and `time_above_threshold_minutes` per WHO/ASHRAE thresholds (PM2.5 > 15 µg/m³, CO2 > 1000 ppm, VOC > 250 index). Surfaces a short natural-language `observation` ONLY when the data supports a finding — e.g. "PM2.5 climbed 8 µg/m³ over the last 6 hours — likely combustion source or external smoke event", "CO2 stayed under 800 ppm for the full window — well-ventilated period", "VOC showed a 3-hour spike around 14:30 — check cleaning products / cooking activity". Never invents observations: if no clear pattern, omits the field entirely. Pass `pollutant: 'all'` (default) to get an array of per-pollutant trends plus `worst_pollutant` (the one with the worst current band). Supports `response_format: 'json' | 'markdown'`. Tool annotated `readOnlyHint: true, openWorldHint: true`. Tool count: 18 → 19.
- New `src/services/air-trend.ts` pure-function module (`analyzeAirTrend` + `buildAirTrend` IO wrapper + `formatAirTrendMarkdown` renderer). Backed by `AirGradientClient.getPublicPast` / `getOwnedPast` calling the AirGradient `/measures/past?from=&to=` endpoint.
- New `src/schemas/common.ts` for shared zod input shapes (currently exports `AirTrendInputSchema`).
- Dedicated unit-test runner `scripts/test-air-trend.mjs` (7 cases: increasing PM2.5 trend, flat CO2 ventilated observation, empty input, all-pollutants mode + worst_pollutant, peak_at/trough_at correctness, unremarkable-data no-invented-observation, VOC spike detection). Wired into `npm test`.

## [0.5.3] - 2026-05-19

### Added

- **`air_health_recommendation` MCP tool — quick PM2.5-centric health recommendation.** Takes PM2.5 (µg/m³, required) plus optional CO2 (ppm) and VOC index, and returns simplified WHO/EPA-aligned bands per pollutant, the overall worst-quality band, and a deduplicated list of plain-language recommendations. Supports `response_format: "json" | "markdown"` so agents can render directly to chat. Complements `air_health_bands` (which is the four-pollutant deep classifier with full source citations) by giving agents a fast "I already have a reading — what should I tell the user?" path. PM2.5 bands: `good <10`, `moderate 10-25`, `unhealthy_sensitive 25-50`, `unhealthy 50-150`, `very_unhealthy >150`. CO2 bands: `fresh <800`, `acceptable 800-1000`, `stale 1000-1500`, `drowsy >1500`. VOC index bands: `low <150`, `moderate 150-300`, `elevated >300`. Tool count: 17 → 18.

## [0.5.2] - 2026-05-19

### Added

- **`air_health_bands` MCP tool — WHO 2021 / EPA / ASHRAE / UBA health-band classifier.** Takes PM2.5 (µg/m³), PM10 (µg/m³), CO2 (ppm), and tVOC (ppb) readings (any combination) and returns each pollutant's band plus the worst signal across pollutants plus a deduplicated list of recommended actions plus source citations per band. If readings are omitted, the tool falls back to fetching the current reading from the default provider. Bands: PM2.5 (`good <5`, `moderate 5-10`, `sensitive_groups 10-15`, `unhealthy 15-25`, `very_unhealthy 25-50`, `hazardous >50`); PM10 (`good <15`, `moderate 15-30`, `sensitive_groups 30-45`, `unhealthy 45-75`, `very_unhealthy 75-100`, `hazardous >100`); CO2 (`good <800`, `acceptable 800-1000`, `drowsy 1000-1400`, `headache_risk 1400-2000`, `action_needed >2000`); VOC (UBA-1 through UBA-5). Tool count: 16 → 17. Sources: WHO Global Air Quality Guidelines 2021; ASHRAE 62.1-2019 + Persily/Satish/Allen indoor-air cognition literature; Umweltbundesamt 2007 TVOC guide values.
- New `src/services/health-bands.ts` pure-function module (no IO) with full per-band citations; tested by 4 smoke assertions covering boundary conditions.

## [0.5.1] - 2026-05-11

### Fixed

- **Profile-store regex no longer false-positives on common wellness words.** Split `SECRET_PATTERNS` into `SECRET_KEY_PATTERNS` (broad, for field names like `oauth_token`) and `SECRET_VALUE_PATTERNS` (high-specificity, only credential shapes: JWTs, `Bearer <token>`, `sk_live_`, `sk-proj-`, `xoxb-`, `github_pat_`, raw `Authorization:` headers). Previously legitimate text like "5 training sessions per week", "limit cookies", "I need to refresh my approach", or "secret sauce: more sleep" was rejected.
- **Partial-profile reads no longer crash downstream.** `readProfileFile` now structurally merges with `DEFAULT_PROFILE` when legacy Hermes/OpenClaw files lacked sub-objects. Previously `buildProfileSummary` and `missingCriticalFields` would throw.
- **Onboarding `privacy_note` no longer hard-codes a single connector path.** Lists multiple example paths so the message reads correctly from every connector.

## [0.5.0] - 2026-05-11

### Added

- **Shared wellness profile support** — vendored canonical `profile-store` (Delx Wellness `ab83d1a`) at `src/services/profile-store.ts`. Reads/writes `~/.delx-wellness/profile.json` (the same file every Delx Wellness MCP can read).
- `air_profile_get` MCP tool — returns the user's shared profile, one-line summary, and missing critical fields. Read-only.
- `air_profile_update` MCP tool — persist a partial patch with `explicit_user_intent: true`. Rejects secret-like fields (oauth/token/secret/password/cookie/refresh/api_key/session).
- `air_onboarding` MCP tool — returns the 11-question onboarding flow + the current profile + a cross-connector hint that asthma / respiratory sensitivity should tighten AQI thresholds.
- `wellness-air onboarding [pt-BR|en]` CLI command — emits the flow as JSON on stdout plus a TTY-gated Markdown walkthrough on stderr ("the agent will ask these 11 questions next — non-secret data only, stored at ~/.delx-wellness/profile.json").

### Changed

- Tool count: 13 → 16.
- `recommended_first_calls` now leads with `air_profile_get` so agents fetch the user's location + sensitivity flags before any reading.

## [0.4.0] - 2026-05-10

### Added

- **PurpleAir adapter** — third provider live. PurpleAir public-sensor reads via API key (`PURPLEAIR_API_KEY`). Maps PM2.5/PM10/temperature/humidity to the shared `AirReading` shape. Temperature converted from °F to °C automatically.
- `air_current_reading` now routes to PurpleAir when `provider: "purpleair"` (sensorIndex from https://map.purpleair.com).

### Roadmap

IQAir AirVisual + Awair adapters land in v0.5.

## [0.3.0] - 2026-05-10

### Added

- **AirThings adapter** — full Consumer API client (OAuth 2.0 client_credentials flow). Maps AirThings samples (PM2.5, PM10, CO₂, VOC, temperature, humidity) to the shared `AirReading` shape. AQI computed from PM2.5 via the same US EPA formula.
- `air_list_devices` tool — lists owned AirThings devices with serial numbers; agents pick one and pass it as `locationId` to `air_current_reading`.
- `air_current_reading` now accepts `provider: "airthings"` and routes to the AirThings client.

### Changed

- Tool count: 12 → 13.
- Capabilities now report `airthings` as configured when both `AIRTHINGS_CLIENT_ID` and `AIRTHINGS_CLIENT_SECRET` are set.

### Roadmap

PurpleAir, IQAir AirVisual, Awair adapters land in v0.4.

## [0.2.0] - 2026-05-10

### Added

- `air_quickstart` tool — returns a personalized 3-step setup walkthrough based on the agent's current configuration (location set? owned token? what's left?). Use this first when the user asks "how do I set this up?"
- `air_demo` tool — returns a realistic example payload of `air_current_reading` + `air_aqi_check` + `air_daily_summary` so agents see the contract before any real call.
- `doctor` CLI command now returns a `recommendations[]` array with concrete next-step guidance when something is missing.
- `air_search_public_sensors` returns curated example sensors plus the AirGradient map URL.

### Changed

- `recommended_first_calls` on the agent manifest now leads with `air_quickstart`.
- Tool count: 10 → 12.

## [0.1.0] - 2026-05-10

### Added

- Initial release with full AirGradient support (public sensors require no auth, owned sensors via `AIRGRADIENT_API_TOKEN`).
- 10 MCP tools: `air_agent_manifest`, `air_capabilities`, `air_connection_status`, `air_privacy_audit`, `air_data_inventory`, `air_current_reading`, `air_aqi_check`, `air_daily_summary`, `air_compare_locations`, `air_search_public_sensors`.
- US EPA PM2.5→AQI breakpoint formula with band classification (good / moderate / unhealthy_sensitive / unhealthy / very_unhealthy / hazardous).
- CLI commands: `wellness-air doctor`, `wellness-air status`, `wellness-air setup [client]`, `wellness-air current <locationId>`.
- One-line stderr community CTA on CLI commands (TTY-gated, suppressible via `WELLNESS_AIR_QUIET=1`).
- `community` block on the `air_agent_manifest` so agents can show humans the repo / issues / Twitter / docs.
- AirThings, PurpleAir, IQAir AirVisual, and Awair scaffolded for v0.2 (env vars listed in capabilities; tools return `provider_not_implemented` until v0.2).
- Standard files: `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `glama.json`, `server.json`, `llms.txt`.
- GitHub Actions CI matrix (Node 20/22/24).
