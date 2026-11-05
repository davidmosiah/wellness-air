# Wellness Air — Agent Plugins package

Portable [Agent Plugins](https://agent-plugins.org/) v1 package for
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and other Agent Plugins clients:
the `wellness-air` MCP server (`wellness-air@0.8.0` over stdio) plus the `wellness-air` workflow skill.

## Install (Hermes Agent)

```bash
hermes plugins install davidmosiah/wellness-air/agent-plugin --no-enable
hermes plugins enable wellness-air
```

Requires Node.js 20+ (`npx` on PATH). The skill loads as `wellness-air:wellness-air`.

## Connector setup

```bash
npx -y wellness-air@0.8.0 doctor
```

Public sensors need no setup: find a sensor with air_search_public_sensors (or on airgradient.com/map) and pass its locationId. Owned sensors need provider credentials in the user's environment before Hermes starts: `AIRGRADIENT_API_TOKEN`, `AIRTHINGS_CLIENT_ID` together with `AIRTHINGS_CLIENT_SECRET`, or `PURPLEAIR_API_KEY`. The plugin explicitly forwards only these optional credentials; unset or empty values are omitted by Hermes. Public AirGradient reads still need no key.

## Updating an existing plugin

The plugin pins runtime 0.8.0; existing installations are not updated automatically. Update the installed plugin explicitly and restart the connector. Node.js 20+, the stdio launch and its working directory are unchanged.

Profiles must pass field validation, fit within 256 KiB of UTF-8 JSON and use regular files; symbolic links, including dangling links and legacy profile paths, are rejected. Invalid or oversized existing profiles require explicit correction/restoration rather than a reset to defaults. The shared profile lock coordinates only participating writers: older connectors and external editors do not honor it. Never remove a lock while a writer may be active. Follow the [profile storage and recovery guidance](https://github.com/davidmosiah/wellness-air/blob/main/docs/profile-storage.md); do not bypass these checks.

MCP tool inputs have a 10,000-element budget. The [release migration notes](https://github.com/davidmosiah/wellness-air/blob/main/CHANGELOG.md) also describe HTTP restrictions (loopback only, 1 MiB bodies, no compression); this plugin uses stdio, so those HTTP restrictions do not change its launch.

## Disclosure

Runs the `wellness-air@0.8.0` npm package locally over stdio through `npx` (Node.js 20+ required); the package is downloaded from npm on first start. Data source: public AirGradient sensors (no key) and, optionally, the user's own AirGradient, AirThings or PurpleAir account through provider credentials. IQAir AirVisual and Awair are on the roadmap and are not available through this plugin. Tools that change state: air_profile_update (local preferences only). Air-quality guidance is general wellness information, not a medical or safety alert system. The tool set comes from the pinned npm version, not from this repository's source tree.
