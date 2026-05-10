import { SUPPORTED_PROVIDERS, type AirProvider } from "../constants.js";

export interface AirCapabilities {
  providers: ReadonlyArray<AirProvider>;
  configured: ReadonlyArray<AirProvider>;
  metrics: ReadonlyArray<string>;
  privacy_modes: ReadonlyArray<"summary" | "structured" | "raw">;
  notes: string[];
}

export function buildCapabilities(): AirCapabilities {
  const configured: AirProvider[] = [];
  if (process.env.AIRGRADIENT_API_TOKEN || process.env.AIRGRADIENT_LOCATION_ID) configured.push("airgradient");
  if (process.env.AIRTHINGS_CLIENT_ID && process.env.AIRTHINGS_CLIENT_SECRET) configured.push("airthings");
  if (process.env.PURPLEAIR_API_KEY) configured.push("purpleair");
  if (process.env.IQAIR_API_KEY) configured.push("iqair");
  if (process.env.AWAIR_ACCESS_TOKEN) configured.push("awair");
  return {
    providers: SUPPORTED_PROVIDERS,
    configured,
    metrics: ["pm25", "pm10", "co2", "tvoc", "nox", "temperature_c", "humidity", "aqi", "aqi_band"],
    privacy_modes: ["summary", "structured", "raw"] as const,
    notes: [
      "Public AirGradient locations require no auth.",
      "Owned-sensor reads (AirGradient/AirThings/Awair/PurpleAir/IQAir) require provider-specific tokens via env vars.",
      "All readings are cached locally only; no third-party telemetry.",
      "AQI is computed from PM2.5 using the US EPA breakpoint formula when not provided by the upstream API.",
    ],
  };
}
