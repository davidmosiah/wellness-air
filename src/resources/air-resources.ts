import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildAgentManifest } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildPrivacyAudit } from "../services/privacy-audit.js";
import { SUPPORTED_PROVIDERS, type AirProvider } from "../constants.js";

function jsonResource(uri: URL, data: unknown) {
  return {
    contents: [
      {
        uri: uri.toString(),
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function buildConnectionStatus() {
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

export function registerAirResources(server: McpServer): void {
  server.registerResource(
    "air_agent_manifest",
    "wellness-air://agent-manifest",
    {
      title: "Air Agent Manifest",
      description: "Machine-readable install and operating instructions for AI agents.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, buildAgentManifest("generic")),
  );

  server.registerResource(
    "air_capabilities",
    "wellness-air://capabilities",
    {
      title: "Air Capabilities",
      description: "Supported providers, metrics, and privacy modes.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, buildCapabilities()),
  );

  server.registerResource(
    "air_connection_status",
    "wellness-air://connection-status",
    {
      title: "Air Connection Status",
      description: "Configured providers and default location (no secrets).",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, buildConnectionStatus()),
  );

  server.registerResource(
    "air_data_inventory",
    "wellness-air://inventory",
    {
      title: "Air Data Inventory",
      description: "Metric catalog and AQI bands exposed by wellness-air.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri, {
        metrics: [
          { id: "aqi", unit: "index 0-500" },
          { id: "pm25", unit: "µg/m³" },
          { id: "pm10", unit: "µg/m³" },
          { id: "co2", unit: "ppm" },
          { id: "tvoc", unit: "index" },
          { id: "temperature_c", unit: "°C" },
          { id: "humidity", unit: "% RH" },
        ],
        privacy_modes: ["summary", "structured", "raw"],
      }),
  );

  server.registerResource(
    "air_privacy_audit",
    "wellness-air://privacy-audit",
    {
      title: "Air Privacy Audit",
      description: "What wellness-air stores locally and sends outbound.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri, buildPrivacyAudit()),
  );
}
