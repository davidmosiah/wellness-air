<!-- delx-wellness header v2 -->
<h1 align="center">Wellness Air</h1>

<h3 align="center">
  Local-first air-quality MCP for AI agents.<br>
  Plug an AirGradient/AirThings/PurpleAir sensor into your agent — <strong>no tokens leave your machine</strong>.
</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/wellness-air"><img src="https://img.shields.io/npm/v/wellness-air?style=for-the-badge&labelColor=0F172A&color=10B981&logo=npm&logoColor=white" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/wellness-air"><img src="https://img.shields.io/npm/dm/wellness-air?style=for-the-badge&labelColor=0F172A&color=0EA5A3&logo=npm&logoColor=white" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/LICENSE-MIT-22C55E?style=for-the-badge&labelColor=0F172A" alt="License MIT" /></a>
  <a href="https://wellness.delx.ai/connectors/air"><img src="https://img.shields.io/badge/SITE-wellness.delx.ai-0EA5A3?style=for-the-badge&labelColor=0F172A" alt="Site" /></a>
</p>

<p align="center">
  <a href="https://github.com/davidmosiah/wellness-air/stargazers"><img src="https://img.shields.io/github/stars/davidmosiah/wellness-air?style=for-the-badge&labelColor=0F172A&color=FBBF24&logo=github" alt="GitHub stars" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/BUILT_FOR-MCP-7C3AED?style=for-the-badge&labelColor=0F172A" alt="Built for MCP" /></a>
  <a href="https://github.com/davidmosiah/delx-wellness-hermes"><img src="https://img.shields.io/badge/HERMES-one--command_setup-10B981?style=for-the-badge&labelColor=0F172A" alt="Hermes one-command setup" /></a>
  <a href="https://github.com/davidmosiah/delx-wellness-openclaw"><img src="https://img.shields.io/badge/OPENCLAW-one--command_setup-FB923C?style=for-the-badge&labelColor=0F172A" alt="OpenClaw one-command setup" /></a>
  <a href="https://github.com/davidmosiah/delx-wellness"><img src="https://img.shields.io/badge/Delx_Wellness-Hub-10B981?style=for-the-badge&labelColor=0F172A&logoColor=white" alt="Delx Wellness Hub" /></a>
</p>

<p align="center">
  <strong>📡 Why this exists:</strong> your sleep / focus / training results are partly a <em>room-quality</em> problem. PM2.5 above 35, CO₂ above 1,000 ppm, low humidity — those wreck recovery and the agent can't see them. <code>wellness-air</code> gives any AI agent <strong>local-first</strong> environmental context to cross with WHOOP / Oura / Garmin / nourish.
</p>

> ⚡ **One-command install** — pick your runtime:
> - [Delx Wellness for Hermes](https://github.com/davidmosiah/delx-wellness-hermes): `npx -y delx-wellness-hermes setup`
> - [Delx Wellness for OpenClaw](https://github.com/davidmosiah/delx-wellness-openclaw): `npx -y delx-wellness-openclaw setup`
>
> Or wire it standalone into Claude Desktop / Cursor / ChatGPT Desktop &mdash; see the install section below.

---

<!-- /delx-wellness header v2 -->

## Overview

Wellness Air is a local MCP server that exposes air-quality readings to any MCP-aware AI agent. v0.1 ships with first-class **AirGradient** support (open hardware + free public API — no auth needed for any of the 12,000+ public sensors worldwide). AirThings, PurpleAir, IQAir AirVisual, and Awair are scaffolded for v0.2.

> If wellness-air helps your agent, please star the repo. Stars make the project easier for other AI builders to discover and help Delx keep shipping local-first wellness infrastructure.

## Try It In 60 Seconds

```bash
# Pick a public sensor near you at https://www.airgradient.com/map/
# Copy the locationId from the URL (e.g. 654321)

WELLNESS_AIR_DEFAULT_LOCATION=654321 npx -y wellness-air doctor
WELLNESS_AIR_DEFAULT_LOCATION=654321 npx -y wellness-air current
```

That's it — no token, no signup, no telemetry.

## Install in Claude Desktop / Cursor / ChatGPT Desktop / Codex

```jsonc
{
  "mcpServers": {
    "wellness-air": {
      "command": "npx",
      "args": ["-y", "wellness-air"],
      "env": {
        "WELLNESS_AIR_DEFAULT_PROVIDER": "airgradient",
        "WELLNESS_AIR_DEFAULT_LOCATION": "654321"
      }
    }
  }
}
```

Reload your client. The agent now has 10 air-quality tools.

## Tools (10 total)

| Tool | Purpose |
|---|---|
| `air_agent_manifest` | Runtime contract: tool list, supported clients, env vars, recommended first calls |
| `air_capabilities` | Supported providers, configured providers, available metrics, privacy modes |
| `air_connection_status` | Health check + warnings the agent should surface |
| `air_privacy_audit` | What is logged locally vs sent to providers |
| `air_data_inventory` | Metric catalog + AQI band thresholds |
| **`air_current_reading`** | **Latest sensor reading (PM2.5, CO₂, AQI, temp, humidity)** |
| **`air_aqi_check`** | **Fast 'is the air OK?' answer with band + recommendation** |
| `air_daily_summary` | Synthesized daily snapshot |
| `air_compare_locations` | Compare AQI across 2-10 locations |
| `air_search_public_sensors` | Discovery helper for AirGradient public map |

## Why local-first?

- **Public sensors require zero auth.** AirGradient runs an open public API; just pass a `locationId`.
- **Owned-sensor tokens stay on your machine.** Set `AIRGRADIENT_API_TOKEN` only if you own a sensor.
- **No telemetry.** wellness-air never phones home. The only outbound calls go to the providers you configure.
- **Read-only.** No tool in v0.1 mutates anything upstream.

## Cross-connector wedge

Where this gets interesting: pair it with the rest of the Delx Wellness stack.

```
WHOOP recovery 47   +   wellness-air AQI 132 (unhealthy_sensitive)
       ↓                          ↓
   Coach: "Recovery's low AND the bedroom AQI was unhealthy last night.
           Skip outdoor cardio today — try mobility + low-intensity strength indoors with HEPA running."
```

Most agents miss the room-quality variable entirely. wellness-air closes that gap.

## Privacy

Run `wellness-air doctor` to inspect the local privacy posture. Highlights:

- All readings cached under `~/.wellness-air` (configurable).
- Provider tokens never returned to the agent.
- No biometric data — environmental only.
- Tool outputs explicitly tagged with their data source for downstream auditability.

## Roadmap

- **v0.2** — full AirThings + PurpleAir + IQAir + Awair adapters; rolling daily/weekly aggregations.
- **v0.3** — historical fetch + cross-correlation helper (e.g. `air_correlate_with_sleep`).
- **v0.4** — webhook trigger for AQI thresholds (agent gets notified when AQI crosses a band).

## License

MIT — see [LICENSE](LICENSE).

<sub>wellness-air is an unofficial connector. AirGradient, AirThings, PurpleAir, IQAir, and Awair are trademarks of their respective owners. None of those companies are affiliated with or endorse this project.</sub>
