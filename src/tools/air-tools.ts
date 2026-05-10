import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AirGradientClient, aqiBand, type AirReading } from "../services/airgradient-client.js";
import { AirThingsClient } from "../services/airthings-client.js";
import { PurpleAirClient } from "../services/purpleair-client.js";
import { buildAgentManifest } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildPrivacyAudit } from "../services/privacy-audit.js";
import { SUPPORTED_PROVIDERS, type AirProvider } from "../constants.js";

interface ConnectionStatus {
  ok: boolean;
  configured_providers: AirProvider[];
  default_provider: AirProvider;
  default_location?: string;
  warnings: string[];
}

function buildConnectionStatus(): ConnectionStatus {
  const cfg = buildCapabilities();
  const defaultProvider = (process.env.WELLNESS_AIR_DEFAULT_PROVIDER as AirProvider) ?? "airgradient";
  const defaultLocation = process.env.WELLNESS_AIR_DEFAULT_LOCATION ?? process.env.AIRGRADIENT_LOCATION_ID;
  const warnings: string[] = [];
  if (cfg.configured.length === 0) {
    warnings.push("No provider tokens configured. Public AirGradient sensors still work without auth.");
  }
  if (!SUPPORTED_PROVIDERS.includes(defaultProvider)) {
    warnings.push(`WELLNESS_AIR_DEFAULT_PROVIDER='${defaultProvider}' not in supported list.`);
  }
  return {
    ok: true,
    configured_providers: [...cfg.configured],
    default_provider: defaultProvider,
    default_location: defaultLocation,
    warnings,
  };
}

function summarizeReading(reading: AirReading): string {
  const parts: string[] = [];
  if (reading.aqi !== undefined) parts.push(`AQI ${reading.aqi} (${aqiBand(reading.aqi)})`);
  if (reading.pm25 !== undefined) parts.push(`PM2.5 ${reading.pm25.toFixed(1)} µg/m³`);
  if (reading.co2 !== undefined) parts.push(`CO₂ ${reading.co2} ppm`);
  if (reading.temperature_c !== undefined) parts.push(`${reading.temperature_c.toFixed(1)}°C`);
  if (reading.humidity !== undefined) parts.push(`${reading.humidity.toFixed(0)}% RH`);
  return parts.join(" · ");
}

function jsonResponse(payload: unknown) {
  const text = JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: payload as Record<string, unknown>,
  };
}

export function registerAirTools(server: McpServer): void {
  server.registerTool(
    "air_agent_manifest",
    {
      title: "Air agent manifest",
      description:
        "Returns the wellness-air agent manifest: tool list, supported clients, env vars, recommended first calls, capabilities, privacy posture, and community links.",
      inputSchema: {
        client: z
          .enum(["claude", "codex", "cursor", "windsurf", "hermes", "openclaw", "generic"])
          .optional()
          .describe("Optional client name for tailored manifest hints."),
      },
    },
    async ({ client }) => jsonResponse(buildAgentManifest(client ?? "generic")),
  );

  server.registerTool(
    "air_capabilities",
    {
      title: "Air capabilities",
      description: "Lists supported providers, configured providers (via env vars), available metrics, and privacy modes.",
      inputSchema: {},
    },
    async () => jsonResponse(buildCapabilities()),
  );

  server.registerTool(
    "air_connection_status",
    {
      title: "Air connection status",
      description:
        "Reports which providers are configured, which is the default, and any warnings the agent should surface to the user.",
      inputSchema: {},
    },
    async () => jsonResponse(buildConnectionStatus()),
  );

  server.registerTool(
    "air_privacy_audit",
    {
      title: "Air privacy audit",
      description: "Returns what wellness-air stores locally, what it sends to providers, what it never logs, and agent rules.",
      inputSchema: {},
    },
    async () => jsonResponse(buildPrivacyAudit()),
  );

  server.registerTool(
    "air_data_inventory",
    {
      title: "Air data inventory",
      description:
        "Returns the inventory of air-quality metrics this connector exposes plus per-provider availability hints (no remote calls).",
      inputSchema: {},
    },
    async () => {
      const inventory = {
        metrics: [
          { id: "aqi", unit: "index 0-500", source: "computed from PM2.5 (US EPA breakpoints)" },
          { id: "pm25", unit: "µg/m³", source: "all providers" },
          { id: "pm10", unit: "µg/m³", source: "AirGradient, AirThings, PurpleAir" },
          { id: "co2", unit: "ppm", source: "AirGradient, AirThings, Awair" },
          { id: "tvoc", unit: "index", source: "AirGradient, Awair" },
          { id: "nox", unit: "index", source: "AirGradient" },
          { id: "temperature_c", unit: "°C", source: "AirGradient, AirThings, Awair" },
          { id: "humidity", unit: "% RH", source: "AirGradient, AirThings, Awair" },
        ],
        bands: [
          { aqi_max: 50, label: "good" },
          { aqi_max: 100, label: "moderate" },
          { aqi_max: 150, label: "unhealthy_sensitive" },
          { aqi_max: 200, label: "unhealthy" },
          { aqi_max: 300, label: "very_unhealthy" },
          { aqi_max: 500, label: "hazardous" },
        ],
      };
      return jsonResponse(inventory);
    },
  );

  server.registerTool(
    "air_current_reading",
    {
      title: "Air current reading",
      description:
        "Fetches the most recent air-quality reading for a location. Defaults to the AirGradient public sensor at WELLNESS_AIR_DEFAULT_LOCATION (or pass locationId).",
      inputSchema: {
        provider: z.enum(SUPPORTED_PROVIDERS).optional().describe("Provider to query. Defaults to airgradient."),
        locationId: z.string().optional().describe("Provider-specific location identifier."),
      },
    },
    async ({ provider, locationId }) => {
      const chosen = provider ?? (process.env.WELLNESS_AIR_DEFAULT_PROVIDER as AirProvider) ?? "airgradient";
      const loc = locationId ?? process.env.WELLNESS_AIR_DEFAULT_LOCATION ?? process.env.AIRGRADIENT_LOCATION_ID;
      if (!loc) {
        return jsonResponse({
          ok: false,
          error: "missing_location",
          hint: "Pass locationId or set WELLNESS_AIR_DEFAULT_LOCATION (AirGradient public location id).",
        });
      }
      if (chosen === "airthings") {
        const at = new AirThingsClient();
        if (!at.hasAuth()) {
          return jsonResponse({
            ok: false,
            error: "missing_credentials",
            provider: "airthings",
            hint: "Set AIRTHINGS_CLIENT_ID and AIRTHINGS_CLIENT_SECRET (Consumer API client_credentials). Sign in at https://dashboard.airthings.com → API.",
          });
        }
        try {
          const reading = await at.getLatestSamples(loc);
          if (!reading) {
            return jsonResponse({ ok: false, error: "not_found", provider: "airthings", locationId: loc });
          }
          return jsonResponse({
            ok: true,
            provider: "airthings",
            locationId: loc,
            reading,
            summary: summarizeReading(reading),
            band: reading.aqi !== undefined ? aqiBand(reading.aqi) : undefined,
          });
        } catch (err) {
          return jsonResponse({ ok: false, error: "airthings_error", provider: "airthings", message: (err as Error).message });
        }
      }
      if (chosen === "purpleair") {
        const pa = new PurpleAirClient();
        if (!pa.hasAuth()) {
          return jsonResponse({
            ok: false,
            error: "missing_credentials",
            provider: "purpleair",
            hint: "Set PURPLEAIR_API_KEY (free read-only key at https://develop.purpleair.com).",
          });
        }
        try {
          const reading = await pa.getSensor(loc);
          if (!reading) {
            return jsonResponse({ ok: false, error: "not_found", provider: "purpleair", locationId: loc });
          }
          return jsonResponse({
            ok: true,
            provider: "purpleair",
            locationId: loc,
            reading,
            summary: summarizeReading(reading),
            band: reading.aqi !== undefined ? aqiBand(reading.aqi) : undefined,
          });
        } catch (err) {
          return jsonResponse({ ok: false, error: "purpleair_error", provider: "purpleair", message: (err as Error).message });
        }
      }
      if (chosen !== "airgradient") {
        return jsonResponse({
          ok: false,
          error: "provider_not_implemented",
          provider: chosen,
          hint: `v0.4 ships airgradient + airthings + purpleair. Remaining roadmap: ${SUPPORTED_PROVIDERS.filter((p) => p !== "airgradient" && p !== "airthings" && p !== "purpleair").join(", ")}.`,
        });
      }
      const client = new AirGradientClient();
      const reading = client.hasAuth() ? await client.getOwnedCurrent(loc) : await client.getPublicCurrent(loc);
      if (!reading) {
        return jsonResponse({ ok: false, error: "not_found", provider: chosen, locationId: loc });
      }
      return jsonResponse({
        ok: true,
        provider: chosen,
        locationId: loc,
        reading,
        summary: summarizeReading(reading),
        band: reading.aqi !== undefined ? aqiBand(reading.aqi) : undefined,
      });
    },
  );

  server.registerTool(
    "air_list_devices",
    {
      title: "Air list devices",
      description:
        "Lists devices owned by the configured provider account. v0.3 supports AirThings (requires AIRTHINGS_CLIENT_ID/SECRET). For AirGradient owned sensors use air_search_public_sensors instead.",
      inputSchema: {
        provider: z.enum(SUPPORTED_PROVIDERS).optional(),
      },
    },
    async ({ provider }) => {
      const chosen = provider ?? "airthings";
      if (chosen !== "airthings") {
        return jsonResponse({
          ok: false,
          error: "provider_not_supported_for_listing",
          provider: chosen,
          hint:
            chosen === "airgradient"
              ? "Use air_search_public_sensors or open https://www.airgradient.com/map/ for the public list."
              : `Device listing not implemented for ${chosen} yet.`,
        });
      }
      const at = new AirThingsClient();
      if (!at.hasAuth()) {
        return jsonResponse({
          ok: false,
          error: "missing_credentials",
          hint: "Set AIRTHINGS_CLIENT_ID and AIRTHINGS_CLIENT_SECRET.",
        });
      }
      try {
        const devices = await at.listDevices();
        return jsonResponse({
          ok: true,
          provider: "airthings",
          count: devices.length,
          devices,
          next: devices.length > 0
            ? `Pick a serialNumber and call air_current_reading { provider: 'airthings', locationId: '${devices[0].serialNumber}' }.`
            : "No devices found on this AirThings account.",
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: "airthings_error", message: (err as Error).message });
      }
    },
  );

  server.registerTool(
    "air_aqi_check",
    {
      title: "Air AQI check",
      description:
        "Returns just the AQI number + band for the configured location. Use for fast 'is the air OK to go outside?' prompts.",
      inputSchema: {
        locationId: z.string().optional(),
      },
    },
    async ({ locationId }) => {
      const loc = locationId ?? process.env.WELLNESS_AIR_DEFAULT_LOCATION ?? process.env.AIRGRADIENT_LOCATION_ID;
      if (!loc) return jsonResponse({ ok: false, error: "missing_location" });
      const client = new AirGradientClient();
      const reading = client.hasAuth() ? await client.getOwnedCurrent(loc) : await client.getPublicCurrent(loc);
      if (!reading || reading.aqi === undefined) return jsonResponse({ ok: false, error: "no_aqi_available" });
      const band = aqiBand(reading.aqi);
      return jsonResponse({
        ok: true,
        aqi: reading.aqi,
        band,
        recommendation: aqiRecommendation(band),
        timestamp: reading.timestamp,
      });
    },
  );

  server.registerTool(
    "air_daily_summary",
    {
      title: "Air daily summary",
      description:
        "Returns a synthesized daily snapshot for a location. v0.1 returns the current reading framed as a daily snapshot; richer multi-hour aggregation arrives in v0.2.",
      inputSchema: {
        locationId: z.string().optional(),
        date: z.string().optional().describe("YYYY-MM-DD; defaults to today (local timezone)."),
      },
    },
    async ({ locationId, date }) => {
      const loc = locationId ?? process.env.WELLNESS_AIR_DEFAULT_LOCATION ?? process.env.AIRGRADIENT_LOCATION_ID;
      if (!loc) return jsonResponse({ ok: false, error: "missing_location" });
      const client = new AirGradientClient();
      const reading = client.hasAuth() ? await client.getOwnedCurrent(loc) : await client.getPublicCurrent(loc);
      if (!reading) return jsonResponse({ ok: false, error: "not_found", locationId: loc });
      const today = date ?? new Date().toISOString().slice(0, 10);
      return jsonResponse({
        ok: true,
        date: today,
        locationId: loc,
        snapshot: reading,
        summary: summarizeReading(reading),
        band: reading.aqi !== undefined ? aqiBand(reading.aqi) : undefined,
        notes: ["v0.1 snapshot; rolling daily aggregation lands in v0.2."],
      });
    },
  );

  server.registerTool(
    "air_compare_locations",
    {
      title: "Air compare locations",
      description: "Compare current readings across multiple location IDs (default: AirGradient public sensors).",
      inputSchema: {
        locationIds: z.array(z.string()).min(2).max(10).describe("Two to ten provider-specific location identifiers."),
      },
    },
    async ({ locationIds }) => {
      const client = new AirGradientClient();
      const results = await Promise.all(
        locationIds.map(async (loc) => {
          try {
            const reading = client.hasAuth() ? await client.getOwnedCurrent(loc) : await client.getPublicCurrent(loc);
            return reading
              ? {
                  locationId: loc,
                  aqi: reading.aqi,
                  band: reading.aqi !== undefined ? aqiBand(reading.aqi) : undefined,
                  summary: summarizeReading(reading),
                  reading,
                }
              : { locationId: loc, error: "not_found" as const };
          } catch (err) {
            return { locationId: loc, error: (err as Error).message };
          }
        }),
      );
      return jsonResponse({ ok: true, count: locationIds.length, results });
    },
  );

  server.registerTool(
    "air_search_public_sensors",
    {
      title: "Air search public sensors",
      description:
        "Helper for discovering AirGradient public sensors. Returns a curated list of well-maintained public sensors plus a hint to the AirGradient map for finding more.",
      inputSchema: {
        query: z.string().optional().describe("Free-text city / region hint for the human."),
      },
    },
    async ({ query }) => {
      return jsonResponse({
        ok: true,
        curated_sensors: [
          { locationId: "654321", city: "São Paulo, BR", note: "Example placeholder; replace with a sensor near you from the AirGradient map." },
          { locationId: "654322", city: "New York, US", note: "Example placeholder." },
          { locationId: "654323", city: "Berlin, DE", note: "Example placeholder." },
        ],
        guidance:
          "AirGradient has no public 'search-by-name' endpoint. Open https://www.airgradient.com/map/, click any green public sensor near you, and copy the numeric locationId from the URL (e.g. /locations/654321). Set WELLNESS_AIR_DEFAULT_LOCATION to that id and rerun air_current_reading.",
        query,
        map_url: "https://www.airgradient.com/map/",
      });
    },
  );

  server.registerTool(
    "air_quickstart",
    {
      title: "Air quickstart",
      description:
        "Returns a personalized 3-step setup walkthrough for the human based on the current agent/env state. Call this first when the user asks 'how do I use this?'",
      inputSchema: {
        client: z
          .enum(["claude", "codex", "cursor", "windsurf", "hermes", "openclaw", "generic"])
          .optional(),
      },
    },
    async ({ client }) => {
      const status = buildConnectionStatus();
      const hasLocation = Boolean(status.default_location);
      const hasOwnedToken = status.configured_providers.includes("airgradient");
      const steps: Array<{ step: number; title: string; action: string; example?: string; done?: boolean }> = [];

      steps.push({
        step: 1,
        title: "Pick a public AirGradient sensor near you",
        action: "Open https://www.airgradient.com/map/ — click any green dot — copy the numeric locationId from the URL.",
        example: "URL like https://www.airgradient.com/map/?locationId=654321 → set WELLNESS_AIR_DEFAULT_LOCATION=654321",
        done: hasLocation,
      });
      steps.push({
        step: 2,
        title: hasOwnedToken
          ? "(Optional) Owned-sensor token already set"
          : "(Optional) Add an AirGradient API token if you own a sensor",
        action: hasOwnedToken
          ? "AIRGRADIENT_API_TOKEN is configured. Public reads will be skipped in favor of owned-sensor reads."
          : "Sign in at https://app.airgradient.com → Account → API Token. Set AIRGRADIENT_API_TOKEN. Public sensors don't need this.",
        done: hasOwnedToken,
      });
      steps.push({
        step: 3,
        title: "Verify with the agent",
        action: "Call air_aqi_check or air_current_reading. The agent should return AQI + band + recommendation.",
        example: hasLocation
          ? `Tool call: air_aqi_check { locationId: '${status.default_location}' }`
          : "Tool call: air_aqi_check { locationId: '<your_id>' }",
        done: false,
      });
      const remaining = steps.filter((s) => !s.done).length;
      return jsonResponse({
        ok: true,
        client: client ?? "generic",
        ready: remaining === 1, // last step is always 'verify'; if other steps done, you're ready to verify
        configured: { location: hasLocation, token: hasOwnedToken },
        steps,
        next: steps.find((s) => !s.done) ?? steps[steps.length - 1],
      });
    },
  );

  server.registerTool(
    "air_demo",
    {
      title: "Air demo",
      description:
        "Returns a realistic example payload of what air_current_reading + air_daily_summary look like in practice. Use this to help users understand what the connector will return BEFORE they configure anything.",
      inputSchema: {},
    },
    async () => {
      const sampleReading: AirReading = {
        timestamp: new Date().toISOString(),
        pm25: 18.4,
        co2: 612,
        tvoc: 92,
        nox: 1,
        temperature_c: 23.7,
        humidity: 48,
        aqi: 64,
      };
      return jsonResponse({
        ok: true,
        is_demo: true,
        sample: {
          air_current_reading: {
            ok: true,
            provider: "airgradient",
            locationId: "654321",
            reading: sampleReading,
            summary: summarizeReading(sampleReading),
            band: aqiBand(sampleReading.aqi!),
          },
          air_aqi_check: {
            ok: true,
            aqi: 64,
            band: "moderate",
            recommendation: aqiRecommendation("moderate"),
            timestamp: sampleReading.timestamp,
          },
          air_daily_summary: {
            ok: true,
            date: new Date().toISOString().slice(0, 10),
            locationId: "654321",
            snapshot: sampleReading,
            band: "moderate",
            summary: summarizeReading(sampleReading),
            notes: ["v0.1 snapshot; rolling daily aggregation lands in v0.2."],
          },
        },
      });
    },
  );
}

function aqiRecommendation(band: ReturnType<typeof aqiBand>): string {
  switch (band) {
    case "good":
      return "Air quality is good. No precautions needed for outdoor activity.";
    case "moderate":
      return "Acceptable for most. Sensitive groups (asthma, heart conditions) may want to limit prolonged outdoor exertion.";
    case "unhealthy_sensitive":
      return "Sensitive groups should reduce outdoor activity. Healthy adults are typically fine.";
    case "unhealthy":
      return "Everyone should reduce prolonged outdoor activity; sensitive groups should stay indoors.";
    case "very_unhealthy":
      return "Avoid outdoor activity. Use HEPA filtration indoors if available.";
    case "hazardous":
      return "Stay indoors with windows closed and HEPA filtration if possible. Health alert level.";
  }
}
