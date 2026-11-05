# Wellness Air — Agent Plugins package

Portable [Agent Plugins](https://agent-plugins.org/) v1 package for
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and other Agent Plugins clients:
the `wellness-air` MCP server (`wellness-air@0.7.3` over stdio) plus the `wellness-air` workflow skill.

## Install (Hermes Agent)

```bash
hermes plugins install davidmosiah/wellness-air/agent-plugin --no-enable
hermes plugins enable wellness-air
```

Requires Node.js 20+ (`npx` on PATH). The skill loads as `wellness-air:wellness-air`.

## Connector setup

```bash
npx -y wellness-air@0.7.3 doctor
```

Public sensors need no setup: find a sensor with air_search_public_sensors (or on airgradient.com/map) and pass its locationId. Owned sensors need the provider token in the user's environment before Hermes starts (see the connector README).

## Disclosure

Runs the `wellness-air@0.7.3` npm package locally over stdio through `npx` (Node.js 20+ required); the package is downloaded from npm on first start. Data source: public AirGradient sensors (no key) and, optionally, the user's own AirGradient, Airthings, PurpleAir, IQAir or Awair account through provider tokens. Tools that change state: air_profile_update (local preferences only). Air-quality guidance is general wellness information, not a medical or safety alert system. The tool set comes from the pinned npm version, not from this repository's source tree.
