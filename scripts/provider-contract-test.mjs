import assert from "node:assert/strict";

import { AirGradientClient } from "../dist/services/airgradient-client.js";
import { AirThingsClient } from "../dist/services/airthings-client.js";
import { PurpleAirClient } from "../dist/services/purpleair-client.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

{
  const calls = [];
  const client = new AirGradientClient({
    baseUrl: "https://air.example",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse([
        { locationId: 7, pm02: "12.3", rco2: 721, tvoc_index: 44, nox_index: 2, atmp: 25.4, rhum: 61, timestamp: "2026-07-16T10:00:00Z" },
      ]);
    },
  });
  const reading = await client.getPublicCurrent("7");
  assert.equal(calls[0].url, "https://air.example/public/api/v1/world/locations/measures/current");
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(reading, {
    timestamp: "2026-07-16T10:00:00Z",
    pm25: 12.3,
    pm10: undefined,
    co2: 721,
    tvoc: 44,
    nox: 2,
    temperature_c: 25.4,
    humidity: 61,
    aqi: 51,
  });
}

{
  let call;
  const client = new AirGradientClient({
    apiToken: "air-secret",
    baseUrl: "https://air.example",
    fetchImpl: async (url, init = {}) => {
      call = { url: String(url), init };
      return jsonResponse({ pm02: 5, timestamp: "2026-07-16T10:00:00Z" });
    },
  });
  await client.getOwnedCurrent("room/a");
  assert.equal(call.url, "https://air.example/api/v1/locations/room%2Fa/measures/current");
  assert.equal(call.init.headers.Authorization, "Bearer air-secret");
}

{
  let fetchCount = 0;
  const client = new AirGradientClient({
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse([]);
    },
  });
  for (const hours of [0, -1, 1.5, Number.NaN, 169]) {
    await assert.rejects(client.getPublicPast("7", hours), /hours must be an integer from 1 to 168/);
  }
  assert.equal(fetchCount, 0, "invalid windows must fail before network I/O");
}

{
  const calls = [];
  const client = new AirThingsClient({
    clientId: "client",
    clientSecret: "secret",
    baseUrl: "https://airthings.example",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("accounts-api")) return jsonResponse({ access_token: "access", expires_in: 3600 });
      return jsonResponse({ data: { time: "2026-07-16T10:00:00Z", pm25: 8, co2: 630, temp: 23, humidity: 55 } });
    },
  });
  const reading = await client.getLatestSamples("serial/a");
  assert.equal(calls[1].url, "https://airthings.example/v1/devices/serial%2Fa/latest-samples");
  assert.equal(calls[1].init.headers.Authorization, "Bearer access");
  assert.equal(reading.co2, 630);
  assert.equal(reading.temperature_c, 23);
}

{
  let call;
  const client = new PurpleAirClient({
    apiKey: "purple-secret",
    baseUrl: "https://purple.example",
    fetchImpl: async (url, init = {}) => {
      call = { url: String(url), init };
      return jsonResponse({ sensor: { "pm2.5_atm": 9, "pm10.0_atm": 13, temperature: 77, humidity: 50, last_seen: 1_784_198_400 } });
    },
  });
  const reading = await client.getSensor("12/3");
  assert.match(call.url, /^https:\/\/purple\.example\/v1\/sensors\/12%2F3\?fields=/);
  assert.equal(call.init.headers["X-API-Key"], "purple-secret");
  assert.equal(reading.temperature_c, 25);
  assert.equal(reading.pm10, 13);
}

console.log("provider contract test passed (AirGradient, AirThings, PurpleAir)");
