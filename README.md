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

Wellness Air is a local MCP server that exposes air-quality readings to any MCP-aware AI agent. It ships with first-class **AirGradient** support (open hardware + free public API — no auth needed for the 2,000+ public sensors in the worldwide feed). **AirThings** and **PurpleAir** are implemented (bring your own free API credentials); **IQAir AirVisual** and **Awair** are on the roadmap.

> If wellness-air helps your agent, please star the repo. Stars make the project easier for other AI builders to discover and help Delx keep shipping local-first wellness infrastructure.

## Try It In 60 Seconds

```bash
# 89 is a real, public AirGradient sensor (Prem Tinsulanonda School, Thailand).
# Swap in one near you from https://www.airgradient.com/map/ — copy the numeric
# locationId from the URL.

WELLNESS_AIR_DEFAULT_LOCATION=89 npx -y wellness-air doctor
WELLNESS_AIR_DEFAULT_LOCATION=89 npx -y wellness-air current
```

That's it — no token, no signup, no telemetry. Public reads use AirGradient's
token-free worldwide feed, so any locationId in that feed works out of the box.

## Install in Claude Desktop / Cursor / ChatGPT Desktop / Codex

```jsonc
{
  "mcpServers": {
    "wellness-air": {
      "command": "npx",
      "args": ["-y", "wellness-air"],
      "env": {
        "WELLNESS_AIR_DEFAULT_PROVIDER": "airgradient",
        "WELLNESS_AIR_DEFAULT_LOCATION": "89"
      }
    }
  }
}
```

Reload your client. The agent now has 19 air-quality tools.

## Tools (19 total)

| Tool | Purpose |
|---|---|
| `air_agent_manifest` | Runtime contract: tool list, supported clients, env vars, recommended first calls |
| `air_capabilities` | Supported providers, configured providers, available metrics, privacy modes |
| `air_connection_status` | Health check + warnings the agent should surface |
| `air_privacy_audit` | What is logged locally vs sent to providers |
| `air_data_inventory` | Metric catalog + AQI band thresholds |
| **`air_current_reading`** | **Latest sensor reading (PM2.5, CO₂, AQI, temp, humidity)** |
| `air_list_devices` | List devices on an authenticated provider account (AirThings) |
| **`air_aqi_check`** | **Fast 'is the air OK?' answer with band + recommendation** |
| `air_daily_summary` | Synthesized daily snapshot |
| `air_compare_locations` | Compare AQI across 2-10 locations |
| `air_search_public_sensors` | Discovery helper for AirGradient public map |
| `air_quickstart` | Personalized 3-step setup walkthrough based on current env state |
| `air_profile_get` | Read the shared Delx Wellness profile (location, sensitivities, units) |
| `air_profile_update` | Persist a non-secret patch to the shared wellness profile (explicit intent required) |
| `air_onboarding` | 11-question onboarding flow for the shared wellness profile |
| `air_demo` | Realistic example payloads — preview output before configuring anything |
| `air_health_recommendation` | PM2.5/CO₂/VOC → WHO/EPA bands + plain-language actions |
| `air_health_bands` | Classify PM2.5/PM10/CO₂/VOC into WHO 2021 / EPA / ASHRAE / UBA bands + citations |
| `air_trend` | Windowed trend analysis (mean/median/rate-of-change/peaks) for PM2.5/CO₂/VOC |

## Why local-first?

- **Public sensors require zero auth.** AirGradient runs an open public API; just pass a `locationId`.
- **Owned-sensor tokens stay on your machine.** Set `AIRGRADIENT_API_TOKEN` only if you own a sensor.
- **No telemetry.** wellness-air never phones home. The only outbound calls go to the providers you configure.
- **Read-only.** No tool mutates anything upstream. (`air_profile_update` writes only to your local shared wellness profile, never to a provider, and requires explicit user intent.)

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

**Shipped:** AirGradient (public + owned) · AirThings · PurpleAir adapters · WHO/EPA/ASHRAE/UBA health bands · windowed trend analysis (`air_trend`) · shared Delx Wellness profile + onboarding.

**Next:**
- IQAir AirVisual + Awair adapters.
- Cross-correlation helper (e.g. `air_correlate_with_sleep`) against the rest of the Delx Wellness stack.
- Webhook trigger for AQI thresholds (agent gets notified when AQI crosses a band).

## 📧 Contact & Support

- 📨 **support@delx.ai** — general questions, integration help, partnerships
- 🐛 **Bug reports / feature requests** — [GitHub Issues](https://github.com/davidmosiah/wellness-air/issues)
- 🐦 **Updates** — [@delx369](https://x.com/delx369) on X
- 🌐 **Site** — [wellness.delx.ai](https://wellness.delx.ai)


## License

MIT — see [LICENSE](LICENSE).

<sub>wellness-air is an unofficial connector. AirGradient, AirThings, PurpleAir, IQAir, and Awair are trademarks of their respective owners. None of those companies are affiliated with or endorse this project.</sub>
