/**
 * AirGradient API client — open hardware, free public API.
 * Docs: https://api.airgradient.com/public/docs/api/v1/
 *
 * Two read modes:
 *  1. Public sensor by location (no auth) — `https://api.airgradient.com/public/api/v1/locations/{locationId}/measures/current`
 *  2. Owned sensor with token — `Authorization: Bearer <token>` against /api/v1/...
 */
import { AIRGRADIENT_API_BASE, USER_AGENT } from "../constants.js";

export interface AirReading {
  /** ISO-8601 timestamp of measurement. */
  timestamp: string;
  /** PM2.5 in µg/m³ (smaller is better). */
  pm25?: number;
  /** PM1.0 in µg/m³. */
  pm10?: number;
  /** Carbon dioxide ppm (lower is better). */
  co2?: number;
  /** Volatile organic compounds raw value (sensor-specific). */
  tvoc?: number;
  /** Nitrogen oxides index (1-500, lower is better). */
  nox?: number;
  /** Temperature in Celsius. */
  temperature_c?: number;
  /** Relative humidity 0-100. */
  humidity?: number;
  /** US AQI (0-500). Computed from PM2.5 if not provided. */
  aqi?: number;
}

export interface AirGradientClientOptions {
  apiToken?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const PM25_AQI_BREAKPOINTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 12.0, 0, 50],
  [12.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 150.4, 151, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 500.4, 301, 500],
];

/** Compute US AQI from a PM2.5 reading (µg/m³). */
export function pm25ToAqi(pm25: number): number {
  if (!Number.isFinite(pm25) || pm25 < 0) return 0;
  for (const [pmLow, pmHigh, aqiLow, aqiHigh] of PM25_AQI_BREAKPOINTS) {
    if (pm25 >= pmLow && pm25 <= pmHigh) {
      return Math.round(((aqiHigh - aqiLow) / (pmHigh - pmLow)) * (pm25 - pmLow) + aqiLow);
    }
  }
  return 500;
}

export function aqiBand(aqi: number): "good" | "moderate" | "unhealthy_sensitive" | "unhealthy" | "very_unhealthy" | "hazardous" {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy_sensitive";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very_unhealthy";
  return "hazardous";
}

export class AirGradientClient {
  private readonly apiToken?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AirGradientClientOptions = {}) {
    this.apiToken = opts.apiToken ?? process.env.AIRGRADIENT_API_TOKEN ?? undefined;
    this.baseUrl = opts.baseUrl ?? AIRGRADIENT_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  hasAuth(): boolean {
    return Boolean(this.apiToken);
  }

  /** Fetch current measurement from a public sensor by location ID. No auth required. */
  async getPublicCurrent(locationId: string | number): Promise<AirReading | null> {
    const url = `${this.baseUrl}/public/api/v1/locations/${encodeURIComponent(String(locationId))}/measures/current`;
    const res = await this.fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`AirGradient public/current failed: HTTP ${res.status}`);
    const raw = (await res.json()) as Record<string, unknown>;
    return mapAirGradientResponse(raw);
  }

  /** Fetch current measurement from an owned location (requires AIRGRADIENT_API_TOKEN). */
  async getOwnedCurrent(locationId: string | number): Promise<AirReading | null> {
    if (!this.apiToken) {
      throw new Error("AIRGRADIENT_API_TOKEN required for owned-sensor reads");
    }
    const url = `${this.baseUrl}/api/v1/locations/${encodeURIComponent(String(locationId))}/measures/current`;
    const res = await this.fetchImpl(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        Authorization: `Bearer ${this.apiToken}`,
      },
    });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw new Error("AirGradient auth failed — check AIRGRADIENT_API_TOKEN");
    }
    if (!res.ok) throw new Error(`AirGradient owned/current failed: HTTP ${res.status}`);
    const raw = (await res.json()) as Record<string, unknown>;
    return mapAirGradientResponse(raw);
  }

  /** List locations the authenticated user owns. */
  async listOwnedLocations(): Promise<Array<{ locationId: string | number; name?: string }>> {
    if (!this.apiToken) {
      throw new Error("AIRGRADIENT_API_TOKEN required for owned-sensor listing");
    }
    const url = `${this.baseUrl}/api/v1/locations`;
    const res = await this.fetchImpl(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        Authorization: `Bearer ${this.apiToken}`,
      },
    });
    if (!res.ok) throw new Error(`AirGradient locations failed: HTTP ${res.status}`);
    const raw = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => ({
      locationId: (row.locationId ?? row.id) as string | number,
      name: typeof row.name === "string" ? row.name : undefined,
    }));
  }
}

function mapAirGradientResponse(raw: Record<string, unknown>): AirReading {
  // AirGradient public response is { locationId, locationName, pm02, atmp, rhum, rco2, tvoc_index, nox_index, timestamp, ... }
  const pm25 = pickNumber(raw, "pm02", "pm25", "pm2_5");
  const reading: AirReading = {
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    pm25,
    pm10: pickNumber(raw, "pm01", "pm10"),
    co2: pickNumber(raw, "rco2", "co2"),
    tvoc: pickNumber(raw, "tvoc_index", "tvoc"),
    nox: pickNumber(raw, "nox_index", "nox"),
    temperature_c: pickNumber(raw, "atmp", "temperature_c", "temperature"),
    humidity: pickNumber(raw, "rhum", "humidity"),
  };
  if (pm25 !== undefined) {
    reading.aqi = pm25ToAqi(pm25);
  }
  return reading;
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}
