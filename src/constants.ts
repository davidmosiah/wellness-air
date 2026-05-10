export const SERVER_NAME = "wellness-air-mcp";
export const SERVER_VERSION = "0.3.0";
export const NPM_PACKAGE_NAME = "wellness-air";
export const PINNED_NPM_PACKAGE = `${NPM_PACKAGE_NAME}@${SERVER_VERSION}`;
export const USER_AGENT = `${NPM_PACKAGE_NAME}/${SERVER_VERSION} (https://wellness.delx.ai/connectors/air; contact: david@delx.ai)`;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3010;
export const LOCAL_DIR_NAME = ".wellness-air";

export const AIRGRADIENT_API_BASE = "https://api.airgradient.com";
export const AIRTHINGS_API_BASE = "https://ext-api.airthings.com";
export const PURPLEAIR_API_BASE = "https://api.purpleair.com";
export const IQAIR_API_BASE = "https://api.airvisual.com";
export const AWAIR_API_BASE = "https://developer-apis.awair.is";

export const SUPPORTED_PROVIDERS = ["airgradient", "airthings", "purpleair", "iqair", "awair"] as const;
export type AirProvider = typeof SUPPORTED_PROVIDERS[number];
