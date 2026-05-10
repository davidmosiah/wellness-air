# Changelog

All notable changes to `wellness-air` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
