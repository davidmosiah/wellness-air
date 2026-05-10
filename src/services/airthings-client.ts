/**
 * AirThings Consumer API client.
 * Docs: https://developer.airthings.com/consumer-api-docs/
 *
 * Auth: OAuth 2.0 client_credentials flow (server-to-server).
 *  - Sign in at https://dashboard.airthings.com → API → Request access (Consumer API).
 *  - Get client_id + client_secret.
 *  - Exchange via POST https://accounts-api.airthings.com/v1/token (form: grant_type=client_credentials, scope="read:device:current_values").
 *  - Tokens are short-lived (~3h); the client refreshes lazily.
 */
import { AIRTHINGS_API_BASE, USER_AGENT } from "../constants.js";
import type { AirReading } from "./airgradient-client.js";
import { pm25ToAqi } from "./airgradient-client.js";

const AIRTHINGS_TOKEN_URL = "https://accounts-api.airthings.com/v1/token";

export interface AirThingsDevice {
  /** AirThings serial number, e.g. "2960123456". */
  serialNumber: string;
  deviceType?: string;
  segment?: { name?: string };
  location?: { name?: string };
}

interface CachedToken {
  access_token: string;
  expires_at: number; // ms epoch
}

export interface AirThingsClientOptions {
  clientId?: string;
  clientSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class AirThingsClient {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private cachedToken?: CachedToken;

  constructor(opts: AirThingsClientOptions = {}) {
    this.clientId = opts.clientId ?? process.env.AIRTHINGS_CLIENT_ID;
    this.clientSecret = opts.clientSecret ?? process.env.AIRTHINGS_CLIENT_SECRET;
    this.baseUrl = opts.baseUrl ?? AIRTHINGS_API_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  hasAuth(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  private async getAccessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("AIRTHINGS_CLIENT_ID and AIRTHINGS_CLIENT_SECRET required");
    }
    if (this.cachedToken && this.cachedToken.expires_at > Date.now() + 30_000) {
      return this.cachedToken.access_token;
    }
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: "read:device:current_values",
    });
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(AIRTHINGS_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basic}`,
        "User-Agent": USER_AGENT,
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`AirThings token exchange failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("AirThings token response missing access_token");
    this.cachedToken = {
      access_token: json.access_token,
      expires_at: Date.now() + (Number(json.expires_in ?? 3600) * 1000),
    };
    return json.access_token;
  }

  async listDevices(): Promise<AirThingsDevice[]> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/v1/devices`;
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (!res.ok) throw new Error(`AirThings /v1/devices failed: HTTP ${res.status}`);
    const json = (await res.json()) as { devices?: Array<Record<string, unknown>> };
    const devices = json.devices ?? [];
    return devices.map((d) => ({
      serialNumber: String(d.serialNumber ?? d.id ?? ""),
      deviceType: typeof d.deviceType === "string" ? d.deviceType : undefined,
      segment: (d.segment as AirThingsDevice["segment"]) ?? undefined,
      location: (d.location as AirThingsDevice["location"]) ?? undefined,
    }));
  }

  async getLatestSamples(serialNumber: string): Promise<AirReading | null> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/v1/devices/${encodeURIComponent(serialNumber)}/latest-samples`;
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`AirThings latest-samples failed: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Record<string, unknown> };
    const data = json.data ?? {};
    return mapAirThingsResponse(data);
  }
}

function mapAirThingsResponse(data: Record<string, unknown>): AirReading {
  const pm25 = pickNumber(data, "pm25", "pm2_5");
  const reading: AirReading = {
    timestamp: typeof data.time === "string" ? data.time : new Date().toISOString(),
    pm25,
    pm10: pickNumber(data, "pm10"),
    co2: pickNumber(data, "co2"),
    tvoc: pickNumber(data, "voc"),
    temperature_c: pickNumber(data, "temp"),
    humidity: pickNumber(data, "humidity"),
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
