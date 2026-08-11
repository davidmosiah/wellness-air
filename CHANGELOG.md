# Changelog

## 0.7.1

- Security: override `fast-uri@3.1.5` and `ip-address@10.4.0` (high transitive).


## 0.7.0 — 2026-08-01

### Fixed

- **`air_demo` — the tool whose entire job is to show an agent the contract *before* it parses a real reading — omitted `pm10` from both sample readings, so an agent that trusted the demo wrote a parser blind to a field every provider path fills.** `air_current_reading.reading` and `air_daily_summary.snapshot` are the same `AirReading` envelope the handlers emit, and that envelope has carried `pm10` since 0.3 (AirGradient maps it from `pm01`, PurpleAir from `pm10.0_atm`, AirThings from `pm10`). The demo listed `pm25`, `co2`, `tvoc`, `nox`, `temperature_c`, `humidity`, `aqi` and stopped. The failure mode is quiet in the worst way: nothing errors, the agent simply never looks for a pollutant it was told did not exist — and `air_health_bands` bands PM10 separately, so an agent building its own band logic off the demo silently drops one of the four pollutants this server classifies. Verified by running the real handlers: `reading.pm10` and `snapshot.pm10` were the exact two key paths missing, and no key in the demo was invented.
- `air_demo`'s description advertised "`air_current_reading` + `air_daily_summary`" while the payload has returned three samples — `air_aqi_check` included — since 0.1.

### Added

- **`scripts/demo-contract-test.mjs`, wired into `npm test`: a gate that runs the REAL `air_current_reading` / `air_aqi_check` / `air_daily_summary` handlers over a synthetic sensor fixture and compares key paths against `air_demo` in BOTH directions** — a key the demo invents *and* a key the contract has that the demo omits. Both directions were proven to fail on demand before this shipped: injecting a plausible `aqi_trend` into the `air_aqi_check` sample exits 1 ("keys in the demo that the real handler NEVER returns"), deleting `co2`/`tvoc`/`nox` from the sample reading exits 1 with all 6 affected paths (`reading.*` and `snapshot.*`), and the shipped demo exits 0 at 36 key paths. The gate also caught the `pm10` drift above on untouched code — it is not a test written to pass.
  - The handlers are captured through `registerAirTools` itself, decorator included, so the gate compares against the payload the MCP server actually serves, parsed from `content[0].text` — the same JSON an agent receives, with `undefined`-valued keys already dropped.
  - `globalThis.fetch` is replaced and throws on any URL other than the AirGradient public world feed, so the gate needs no network and a handler that started calling elsewhere fails loudly instead of passing quietly.
  - `CONDITIONAL_ON_REQUEST` is the single reviewable place to record a key that only exists for a specific call shape (today: `privacy_mode`, echoed only when the caller passes it). Widening it to silence a failure is how the drift got in.
- `fixtures/airgradient-world-current.json` — a synthetic two-row AirGradient world feed. Fully fake: `locationId` 999001/999002, coordinates `0,0`, `SYNTHETIC-0000` serial. It deliberately carries the positional and identifying columns (`latitude`, `longitude`, `serialNumber`, `locationName`) the mapper drops, so the gate can assert the demo never re-teaches a contract the server does not have.
- `air_demo` now returns top-level `notes`: that the sample is synthetic and the `locationId` a placeholder, that every `reading` field except `timestamp` is optional so parsing must be defensive, that the shape is gate-enforced rather than hand-maintained, and that **`reading.pm10` carries PM1.0 for AirGradient and PM10 for PurpleAir/AirThings** — the same key, two different physical quantities, so an agent must check `provider` before comparing it to a PM10 threshold. That ambiguity is documented here rather than fixed: renaming the field changes the response contract of every read tool and belongs with its own bump.

### Changed

- Minor bump, not patch: `air_demo`'s payload gains `sample.*.reading.pm10` / `sample.*.snapshot.pm10` and a top-level `notes` array. No handler response changed — only the example of it. Nothing was removed or renamed.

## 0.6.1 — 2026-08-01

### Fixed

- **`air_trend` read array position as position in time, so a provider returning newest-first would have made `current` the OLDEST reading — and 0.6.0 started saying so out loud.** The series was never sorted. `current` was the last element of the array, `last_sample_at` the last timestamp, and `rate_of_change_per_hour` compared the first quarter of the *array* to the last quarter. Measured on the 0.6.0 build, feeding the same 24-sample falling series newest-first: `time_above_threshold_minutes` 120 (correct — the integrator sorts internally, so minutes and `coverage_ratio` were always robust), but `current` 40 instead of 17, `rate_of_change_per_hour` +0.75 instead of −0.75 (a falling series reported as rising), and `last_sample_at` `00:00` instead of `01:55`.
  - **Why this mattered more after 0.6.0 than before:** `current` had carried this assumption all along, silently. 0.6.0 built `last_sample_at` and the low-coverage note on top of it and made an explicit temporal claim — *"Last sample: X"*, *"current may be stale"* — from an ordering the module had never verified. A caller can discount a bare number; a timestamped caveat that names the wrong sample is trusted. AirGradient returns ascending today, but that was never part of any provider contract, and a merged or paged response does not have to.
  - **Fix:** the series is sorted chronologically once, at the entry point (`analyzeAirTrend`), and every temporal field is derived from the sorted series. Samples whose timestamp cannot be parsed still count towards `mean`/`median`/`min`/`max`/`samples_analyzed` but sort to the front, so an unplaceable sample can never be reported as the most recent one. The input array is not mutated.
- **The VOC spike observation padded the run with the window's GLOBAL median cadence instead of the run's own, so one physical event reported different durations depending on how the sensor sampled *elsewhere*.** A spike genuinely spanning 14:30 → 15:30 at a 30-minute cadence was announced as a *"2-hour spike"* inside an hourly window and a *"1.2-hour spike"* inside a 10-minute-cadence window. 0.6.0's claim that the observation "spans the run's real elapsed time" was only half true: the elapsed time was there, plus a padding term taken from the wrong series. The span is now computed with the midpoint rule over the run's own sample spacing (`perPointSpansMs`, the same primitive that produces `time_above_threshold_minutes`, so the two can no longer disagree) — that run reports 1.5 hours from either baseline.
- **Spikes shorter than an hour were floored to `"1-hour"`** by a `Math.max(1, …)` on the rounded hour count: three samples 5 minutes apart span 15 minutes and were announced as an hour long. Spans under an hour are now reported in minutes (`"VOC showed a 15-minute spike around …"`).

### Added

- `scripts/test-air-trend.mjs` tests 9 and 10, both verified to fail against the 0.6.0 build and pass against this one. Test 9 feeds the same series newest-first and deterministically shuffled and asserts the *whole* per-pollutant result is identical to the ascending analysis — not just the fields enumerated today, which is what stops the next temporal field from inheriting the assumption — plus that the low-coverage note quotes the newest timestamp and never the oldest, and that an undated sample is counted but never becomes `last_sample_at`. Test 10 asserts the VOC span numerically (90 min), asserts it is identical across a sparse and a dense baseline carrying the identical run, covers the sub-hour case (15 min), and checks the observation survives a newest-first series. All 8 pre-existing tests still pass unchanged.
- Rationale comments on `MAX_SAMPLE_SPAN_MINUTES` (60) and `LOW_COVERAGE_RATIO` (0.75) explaining what each number trades off in each direction, so a later reader does not treat them as arbitrary — or as derived.

### Known limitations

- **`air_trend` accepts `privacy_mode` and ignores it.** `AirTrendInputSchema` declares the field and `decorateReadToolConfig` injects it, but the `air_trend` handler destructures only `{ hours, pollutant, response_format, locationId }`. None of the three modes is applied, and unlike the other read tools the value is not even echoed back — a caller passing `privacy_mode: "summary"` gets a response indistinguishable from `"structured"`, with no signal the request was dropped. This pre-dates 0.6.x and is byte-identical before and after the 0.6.0/0.6.1 work; it is recorded rather than fixed because the fix adds a field to every `air_trend` response and belongs with its own version bump. Blast radius is low today: `air_trend`'s payload carries no location identifier or device serial, which is all `applyPrivacyMode()` redacts, so `"summary"` would be a no-op on the body regardless. The defect is the silent no-op, not leaked data. Documented at the handler in `src/tools/air-tools.ts`.

### Changed

- Patch bump: no field is added, removed or renamed. `current`, `last_sample_at`, `peak_at`, `trough_at` and `rate_of_change_per_hour` become correct for non-ascending input (they were already correct for the ascending input AirGradient sends), and the VOC observation string gains a `N-minute` form alongside `N-hour`.

## 0.6.0 — 2026-08-01

### Fixed

- **`air_trend` reported wildly inflated `time_above_threshold_minutes` whenever the sensor had gaps — the worse the sensor coverage, the bigger the number.** An agent asking "how long was PM2.5 above the WHO guideline today?" got 1440 minutes (the entire day) for a two-hour PM2.5 event, purely because the sensor was offline for the other 22 hours. Any downstream advice — "you were exposed all day, consider an air purifier", a correlation against sleep or recovery data, a health-band summary — was built on a number that was up to 144× the truth. The measured cases: a contiguous two-hour peak with a healthy sensor read a correct 120 min; the *same physical peak* with the sensor offline the rest of the day read 1440 min (12×); two samples 24 h apart with the last one above threshold read 720 min (144×); and 24 above-threshold samples confined to the first two hours of the window read 1440 min (12×). Reachable through the default call path (`hours: 24`, `pollutant: "all"`), so this affected ordinary usage, not an edge case.
  - **Root cause:** the estimator never received the sample timestamps it needed. It computed `minutesPerSample = (hours * 60) / values.length` — dividing the *nominal window* by the sample count — and multiplied by the number of samples above threshold. That normalization silently assumes the sensor covered the whole window, so every missing sample redistributed its time onto the samples that survived. Fewer samples meant more minutes each. (Had it used the sensor's real ~5-minute cadence, the arithmetic would have been right; the window-normalization *was* the bug.) `analyzeOne()` already held the timestamps from `extractSeries()` and simply did not pass them down.
  - **Fix:** `time_above_threshold_minutes` now integrates over the real elapsed time between neighbouring samples (midpoint rule): each sample is credited half the gap to the previous sample plus half the gap to the next. No sample may be credited more than `min(2 × median cadence, 60 min)`, so a reading sitting next to a sensor outage cannot claim the outage. The result no longer depends on the requested window size at all — the same 24 samples now return the same minutes whether analysed over 2 h or 24 h.
- The `air_trend` VOC observation ("VOC showed a *N*-hour spike around HH:MM") measured the spike with the same window-normalized arithmetic and was inflated by sensor gaps in the same way. It now spans the run's real elapsed time.
- `formatAirTrendMarkdown` never rendered `notes`, so callers using `response_format: "markdown"` could not see any window caveat. Notes are now rendered.

### Added

- **`coverage_ratio` (0–1) and `last_sample_at` on every `air_trend` per-pollutant result.** `coverage_ratio` is the fraction of the requested window actually covered by samples; below 0.75 `air_trend` now emits an explicit note that `time_above_threshold_minutes` is a floor rather than a full-window measurement and that `current` may be stale. This closes a second silent failure: `current` is the newest *sample*, which during an outage can be hours old, and nothing in the response said so.
- Regression fixture `scripts/test-air-trend.mjs` test 8 (6 synthetic cases): the contiguous-peak control, the same peak behind a 22 h sensor gap, two samples 24 h apart, an above-threshold block at the window start, window-size independence, and the low-coverage note reaching both JSON and Markdown. Verified to fail against the 0.5.8 build and pass against this one. All 7 pre-existing cases still pass unchanged.
- `scripts/metadata-check.mjs` now also verifies `SERVER_VERSION` in `src/constants.ts` against `package.json`. It previously checked only `package.json` ↔ `server.json`, and the runtime version had drifted twice before.

### Changed

- Minor bump rather than patch: `air_trend` output gains two fields and the semantics of `time_above_threshold_minutes` change (it is now a measurement of observed time, not a share of the window).

## 0.5.8 — 2026-07-30

### Added

- **Agent-readiness (mcp-scorecard):** real `privacy_mode` input on all read tools (`summary|structured|raw`), full MCP resource set (`wellness-air://agent-manifest|capabilities|connection-status|inventory|privacy-audit`), `readOnlyHint` annotations on read tools, and `standard_tools` on `air_agent_manifest`.

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
