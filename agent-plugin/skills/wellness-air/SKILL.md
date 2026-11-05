---
name: wellness-air
description: >-
  Check indoor and outdoor air quality (PM2.5, PM10, CO2, TVOC, AQI) with the local wellness-air MCP server, using public AirGradient sensors or the user's own monitors. Use when the user asks about air quality, AQI near them, whether to exercise outside or open windows, CO2 in a room, or air trends.
---

# Wellness Air

MCP server `wellness-air` from the `wellness-air@0.7.3` npm package, run locally through `npx`. It reads PM2.5, PM10, CO2, TVOC, NOx, temperature, humidity, AQI bands, trends and health recommendations. Data source: public AirGradient sensors (no key) and, optionally, the user's own AirGradient, Airthings, PurpleAir, IQAir or Awair account through provider tokens.

## Workflow

1. Start with `air_quickstart`. Then pick what fits the question: `air_search_public_sensors`, `air_current_reading`, `air_health_recommendation`.
2. Lead with the answer to the user's question and keep supporting detail short.

## Setup (the user runs this in a terminal, not in chat)

```bash
npx -y wellness-air@0.7.3 doctor
```

Public sensors need no setup: find a sensor with air_search_public_sensors (or on airgradient.com/map) and pass its locationId. Owned sensors need the provider token in the user's environment before Hermes starts (see the connector README).

## Safety

- Tools that change local state: air_profile_update (local preferences only). Use them only when the user asks.
- Air-quality guidance is general wellness information, not a medical or safety alert system.
