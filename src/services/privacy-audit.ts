import { SUPPORTED_PROVIDERS, LOCAL_DIR_NAME } from "../constants.js";

export interface AirPrivacyAudit {
  local_storage: string;
  outbound_destinations: string[];
  what_is_logged: string[];
  what_is_never_logged: string[];
  agent_rules: string[];
}

export function buildPrivacyAudit(): AirPrivacyAudit {
  return {
    local_storage: `~/${LOCAL_DIR_NAME}`,
    outbound_destinations: SUPPORTED_PROVIDERS.map((p) => providerEndpoint(p)),
    what_is_logged: [
      "Last-known sensor readings cached locally to support offline replies.",
      "Failed API responses written to local debug log with API key redacted.",
    ],
    what_is_never_logged: [
      "API tokens, OAuth secrets, or session credentials.",
      "Sensor location coordinates outside what the user explicitly configured.",
      "Any biometric data — this connector reads environmental data only.",
    ],
    agent_rules: [
      "Treat all readings as recent observations, not real-time guarantees.",
      "Surface AQI band (good/moderate/unhealthy) in human responses, not just numbers.",
      "When AQI > 100, suggest checking with the user before recommending outdoor activity.",
      "Do not extrapolate to medical advice — this is environmental context, not diagnosis.",
    ],
  };
}

function providerEndpoint(provider: string): string {
  switch (provider) {
    case "airgradient":
      return "api.airgradient.com (public + owned reads)";
    case "airthings":
      return "ext-api.airthings.com (OAuth)";
    case "purpleair":
      return "api.purpleair.com (API key)";
    case "iqair":
      return "api.airvisual.com (API key)";
    case "awair":
      return "developer-apis.awair.is (OAuth)";
    default:
      return provider;
  }
}
