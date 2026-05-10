/**
 * PurpleAir API client.
 * Docs: https://api.purpleair.com/
 *
 * Auth: API key in `X-API-Key` header. Free read-only key available at
 * https://develop.purpleair.com after sign-up.
 *
 * Public sensor IDs are integers visible at https://map.purpleair.com/
 * (click any sensor → URL contains ?select=<sensor_index>).
 */
import { PURPLEAIR_API_BASE, USER_AGENT } from "../constants.js";
import type { AirReading } from "./airgradient-client.js";
import { pm25ToAqi } from "./airgradient-client.js";

const SENSOR_FIELDS = [
  "name",
  "pm2.5_atm",
  "pm10.0_atm",
  "humidity",
  "temperature",
  "last_seen",
].join(",");

export interface PurpleAirClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class PurpleAirClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PurpleAirClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.PURPLEAIR_API_KEY;
    this.baseUrl = opts.baseUrl ?? PURPLEAIR_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  hasAuth(): boolean {
    return Boolean(this.apiKey);
  }

  async getSensor(sensorIndex: string | number): Promise<AirReading | null> {
    if (!this.apiKey) {
      throw new Error("PURPLEAIR_API_KEY required");
    }
    const url = `${this.baseUrl}/v1/sensors/${encodeURIComponent(String(sensorIndex))}?fields=${encodeURIComponent(SENSOR_FIELDS)}`;
    const res = await this.fetchImpl(url, {
      headers: {
        "X-API-Key": this.apiKey,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) {
      throw new Error("PurpleAir auth failed — check PURPLEAIR_API_KEY");
    }
    if (!res.ok) throw new Error(`PurpleAir /sensors failed: HTTP ${res.status}`);
    const json = (await res.json()) as { sensor?: Record<string, unknown> };
    const sensor = json.sensor;
    if (!sensor) return null;
    return mapPurpleAirResponse(sensor);
  }
}

function mapPurpleAirResponse(sensor: Record<string, unknown>): AirReading {
  const pm25 = pickNumber(sensor, "pm2.5_atm", "pm2.5");
  const lastSeen = sensor.last_seen;
  const tempF = pickNumber(sensor, "temperature");
  const reading: AirReading = {
    timestamp:
      typeof lastSeen === "number"
        ? new Date(lastSeen * 1000).toISOString()
        : new Date().toISOString(),
    pm25,
    pm10: pickNumber(sensor, "pm10.0_atm", "pm10.0"),
    humidity: pickNumber(sensor, "humidity"),
    temperature_c: tempF !== undefined ? Math.round(((tempF - 32) * 5) / 9 * 10) / 10 : undefined,
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
  }
  return undefined;
}
