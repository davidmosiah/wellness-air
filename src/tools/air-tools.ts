import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AirGradientClient, aqiBand, type AirReading } from "../services/airgradient-client.js";
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
      if (chosen !== "airgradient") {
        return jsonResponse({
          ok: false,
          error: "provider_not_implemented",
          provider: chosen,
          hint: `In v0.1 only AirGradient is implemented. Roadmap: ${SUPPORTED_PROVIDERS.filter((p) => p !== "airgradient").join(", ")}.`,
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
        "Helper for discovering AirGradient public sensors. v0.1 returns guidance to use https://www.airgradient.com/map/ since there is no public search endpoint yet.",
      inputSchema: {
        query: z.string().optional().describe("Free-text city / region hint for the human."),
      },
    },
    async ({ query }) => {
      return jsonResponse({
        ok: true,
        guidance:
          "AirGradient has no public 'search-by-name' endpoint yet. Open https://www.airgradient.com/map/ and copy the locationId from the URL of the sensor you want to track. Set WELLNESS_AIR_DEFAULT_LOCATION to that id.",
        query,
        map_url: "https://www.airgradient.com/map/",
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
