# Changelog

All notable changes to `wellness-air` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
