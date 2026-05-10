# AGENTS.md — wellness-air

Notes for AI agents and human contributors working on this repo.

## What this is

A local-first MCP server that exposes air-quality readings (PM2.5, CO₂, AQI, etc.) to any MCP-aware agent. v0.1 ships full AirGradient support; AirThings/PurpleAir/IQAir/Awair are scaffolded.

## Source layout

- `src/index.ts` — MCP entry. Registers tools, runs stdio or Streamable HTTP.
- `src/constants.ts` — Versions, provider list, default ports/hosts.
- `src/services/airgradient-client.ts` — Public + owned AirGradient API client. Implements US EPA AQI conversion from PM2.5.
- `src/services/{capabilities,privacy-audit,agent-manifest}.ts` — Standard manifest surfaces.
- `src/tools/air-tools.ts` — All 10 tools registered with the MCP server.
- `src/cli/commands.ts` — `doctor`, `setup`, `status`, `current` CLI commands.

## Tool naming

All tools follow the `air_<verb_or_noun>` pattern. Resources use the `wellness-air://` scheme.

## Adding a provider in v0.2

1. Create `src/services/<provider>-client.ts` modeled on `airgradient-client.ts`. Keep the `AirReading` shape consistent.
2. Wire the provider into `air_current_reading` and `air_daily_summary` switch in `src/tools/air-tools.ts`.
3. Add provider env vars to `src/services/capabilities.ts` configured-detection.
4. Update `src/services/agent-manifest.ts` `optional_env`.
5. Add provider notes to `src/services/privacy-audit.ts`.
6. Bump `SERVER_VERSION` in `src/constants.ts` AND `version` in both `package.json` and `server.json`.

## Testing

- `npm test` runs typecheck + build + smoke + metadata check.
- `npm run smoke` exercises the MCP tool surface against a public AirGradient sensor.
- `npm run test:metadata` ensures `package.json` / `server.json` versions stay in sync.

## Privacy contract

- AirGradient public reads = no auth, no PII, no token storage.
- Owned-sensor reads = `AIRGRADIENT_API_TOKEN` from env, never returned in tool output.
- All cached data lives under `~/.wellness-air` (override with `WELLNESS_AIR_LOCAL_DIR`).
- No third-party telemetry. The only outbound call goes to the configured provider.

## Versioning

SemVer. v0.x = pre-1.0; tool contracts are stable but new tools may land. Document every release in `CHANGELOG.md`.
