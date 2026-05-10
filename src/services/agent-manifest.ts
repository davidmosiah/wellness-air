import { NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE, SERVER_NAME, SERVER_VERSION } from "../constants.js";
import { buildCapabilities } from "./capabilities.js";
import { buildPrivacyAudit } from "./privacy-audit.js";

export type AirAgentClient = "claude" | "codex" | "cursor" | "windsurf" | "hermes" | "openclaw" | "generic";

const SUPPORTED_CLIENTS: AirAgentClient[] = ["claude", "codex", "cursor", "windsurf", "hermes", "openclaw", "generic"];

const TOOLS = [
  "air_agent_manifest",
  "air_capabilities",
  "air_connection_status",
  "air_privacy_audit",
  "air_data_inventory",
  "air_quickstart",
  "air_demo",
  "air_current_reading",
  "air_daily_summary",
  "air_aqi_check",
  "air_compare_locations",
  "air_search_public_sensors",
] as const;

const RECOMMENDED_FIRST_CALLS = [
  "air_quickstart",
  "air_connection_status",
  "air_current_reading",
];

export interface AirAgentManifest {
  name: string;
  version: string;
  client: string;
  supported_clients: AirAgentClient[];
  install: { command: string; args: string[]; optional_env: string[] };
  recommended_first_calls: string[];
  tools: ReadonlyArray<string>;
  resources: string[];
  agent_rules: string[];
  community: {
    repo: string;
    issues: string;
    twitter: string;
    docs: string;
    invite: string;
  };
  capabilities: ReturnType<typeof buildCapabilities>;
  privacy: ReturnType<typeof buildPrivacyAudit>;
}

export function buildAgentManifest(client: AirAgentClient = "generic"): AirAgentManifest {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    client,
    supported_clients: SUPPORTED_CLIENTS,
    install: {
      command: "npx",
      args: ["-y", PINNED_NPM_PACKAGE],
      optional_env: [
        "AIRGRADIENT_API_TOKEN",
        "AIRGRADIENT_LOCATION_ID",
        "AIRTHINGS_CLIENT_ID",
        "AIRTHINGS_CLIENT_SECRET",
        "PURPLEAIR_API_KEY",
        "IQAIR_API_KEY",
        "AWAIR_ACCESS_TOKEN",
        "WELLNESS_AIR_DEFAULT_PROVIDER",
        "WELLNESS_AIR_DEFAULT_LOCATION",
      ],
    },
    recommended_first_calls: RECOMMENDED_FIRST_CALLS,
    tools: TOOLS,
    resources: [
      "wellness-air://agent-manifest",
      "wellness-air://capabilities",
      "wellness-air://privacy-audit",
    ],
    agent_rules: [
      "Call air_connection_status before any provider-backed tool.",
      "Use air_current_reading for spot checks; air_daily_summary for trend questions.",
      "Surface AQI band (good/moderate/unhealthy_sensitive/unhealthy/very_unhealthy/hazardous), not just the number.",
      "Public AirGradient sensors do NOT require a token — pass a locationId from the global map.",
      "Owned sensors require provider-specific tokens via env vars; never request them in chat.",
      "Treat all readings as advisory, not medical. Refer to local public-health agencies for action thresholds.",
    ],
    community: {
      repo: "https://github.com/davidmosiah/wellness-air",
      issues: "https://github.com/davidmosiah/wellness-air/issues",
      twitter: "https://x.com/delx369",
      docs: "https://wellness.delx.ai/connectors/air",
      invite:
        "If wellness-air helps your agent, a star on the repository increases visibility for other AI builders.",
    },
    capabilities: buildCapabilities(),
    privacy: buildPrivacyAudit(),
  };
}
