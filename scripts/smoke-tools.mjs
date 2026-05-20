#!/usr/bin/env node
/* eslint-disable no-console */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOLS = new Set([
  "air_agent_manifest",
  "air_capabilities",
  "air_connection_status",
  "air_privacy_audit",
  "air_data_inventory",
  "air_quickstart",
  "air_demo",
  "air_current_reading",
  "air_aqi_check",
  "air_daily_summary",
  "air_compare_locations",
  "air_search_public_sensors",
  "air_list_devices",
  "air_profile_get",
  "air_profile_update",
  "air_onboarding",
  "air_health_bands",
  "air_health_recommendation",
  "air_trend",
]);

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, WELLNESS_AIR_QUIET: "1" },
});
const client = new Client({ name: "wellness-air-smoke", version: "0.0.1" }, { capabilities: {} });

await client.connect(transport);
const { tools } = await client.listTools();

const got = new Set(tools.map((t) => t.name));
for (const expected of EXPECTED_TOOLS) {
  assert.ok(got.has(expected), `missing tool: ${expected}`);
}
console.log(`✓ all ${EXPECTED_TOOLS.size} tools registered`);

const manifest = await client.callTool({ name: "air_agent_manifest", arguments: {} });
const manifestPayload = JSON.parse(manifest.content[0].text);
assert.equal(manifestPayload.name, "wellness-air-mcp");
assert.ok(Array.isArray(manifestPayload.tools));
assert.ok(manifestPayload.community.repo.includes("wellness-air"));
console.log("✓ air_agent_manifest returns expected shape");

const status = await client.callTool({ name: "air_connection_status", arguments: {} });
const statusPayload = JSON.parse(status.content[0].text);
assert.equal(statusPayload.ok, true);
console.log("✓ air_connection_status reports ok");

const caps = await client.callTool({ name: "air_capabilities", arguments: {} });
const capsPayload = JSON.parse(caps.content[0].text);
assert.ok(Array.isArray(capsPayload.providers));
assert.ok(capsPayload.providers.includes("airgradient"));
console.log("✓ air_capabilities lists airgradient");

const privacy = await client.callTool({ name: "air_privacy_audit", arguments: {} });
const privacyPayload = JSON.parse(privacy.content[0].text);
assert.ok(privacyPayload.local_storage.includes("wellness-air"));
console.log("✓ air_privacy_audit returns local-storage path");

const inventory = await client.callTool({ name: "air_data_inventory", arguments: {} });
const inventoryPayload = JSON.parse(inventory.content[0].text);
assert.ok(inventoryPayload.metrics.length >= 5);
console.log("✓ air_data_inventory lists ≥5 metrics");

const search = await client.callTool({ name: "air_search_public_sensors", arguments: {} });
const searchPayload = JSON.parse(search.content[0].text);
assert.ok(searchPayload.guidance.includes("airgradient.com/map"));
console.log("✓ air_search_public_sensors returns guidance to AirGradient map");

const reading = await client.callTool({ name: "air_current_reading", arguments: {} });
const readingPayload = JSON.parse(reading.content[0].text);
assert.equal(readingPayload.ok, false, "current reading without location should report ok=false");
assert.equal(readingPayload.error, "missing_location");
console.log("✓ air_current_reading without location returns missing_location");

const quickstart = JSON.parse((await client.callTool({ name: "air_quickstart", arguments: {} })).content[0].text);
assert.equal(quickstart.ok, true);
assert.ok(Array.isArray(quickstart.steps) && quickstart.steps.length === 3, `expected 3 steps, got ${quickstart.steps?.length}`);
assert.ok(quickstart.next, "quickstart should suggest a next step");
console.log(`✓ air_quickstart returns 3-step walkthrough (next: '${quickstart.next.title}')`);

const demo = JSON.parse((await client.callTool({ name: "air_demo", arguments: {} })).content[0].text);
assert.equal(demo.is_demo, true);
assert.ok(demo.sample.air_current_reading, "demo should include air_current_reading sample");
assert.ok(demo.sample.air_aqi_check, "demo should include air_aqi_check sample");
console.log(`✓ air_demo returns sample payloads`);

// air_list_devices without AIRTHINGS_CLIENT_ID should return missing_credentials cleanly
const listAirthings = JSON.parse(
  (await client.callTool({ name: "air_list_devices", arguments: { provider: "airthings" } })).content[0].text,
);
assert.equal(listAirthings.ok, false);
assert.equal(listAirthings.error, "missing_credentials");
console.log(`✓ air_list_devices reports missing_credentials when AIRTHINGS_CLIENT_ID absent`);

// air_current_reading with airthings provider but no creds should report missing_credentials
const airthingsRead = JSON.parse(
  (await client.callTool({ name: "air_current_reading", arguments: { provider: "airthings", locationId: "2960123456" } })).content[0].text,
);
assert.equal(airthingsRead.ok, false);
assert.equal(airthingsRead.error, "missing_credentials");
console.log(`✓ air_current_reading routes to AirThings client when provider=airthings`);

// air_health_bands: classify provided readings
const bandsResult = JSON.parse(
  (
    await client.callTool({
      name: "air_health_bands",
      arguments: { pm25: 18.5, pm10: 38, co2: 1200, voc: 350 },
    })
  ).content[0].text,
);
assert.equal(bandsResult.ok, true, "air_health_bands should succeed with provided readings");
assert.equal(bandsResult.pollutants.pm25.label, "unhealthy", `pm25=18.5 should band as 'unhealthy' (WHO 2021); got '${bandsResult.pollutants.pm25.label}'`);
assert.equal(bandsResult.pollutants.pm10.label, "sensitive_groups", `pm10=38 should band as 'sensitive_groups'; got '${bandsResult.pollutants.pm10.label}'`);
assert.equal(bandsResult.pollutants.co2.label, "drowsy", `co2=1200 should band as 'drowsy'; got '${bandsResult.pollutants.co2.label}'`);
assert.equal(bandsResult.pollutants.voc.label, "acceptable", `voc=350 should band as 'acceptable' (UBA-2); got '${bandsResult.pollutants.voc.label}'`);
assert.equal(bandsResult.worst_signal.pollutant, "pm25", `worst signal should be pm25 (unhealthy); got '${bandsResult.worst_signal?.pollutant}'`);
assert.ok(Array.isArray(bandsResult.recommended_actions) && bandsResult.recommended_actions.length > 0, "recommended_actions must be non-empty");
assert.ok(bandsResult.sources.some((s) => /WHO/.test(s)), "sources should cite WHO");
console.log(`✓ air_health_bands classifies PM2.5/PM10/CO2/VOC; worst=${bandsResult.worst_signal?.pollutant}/${bandsResult.worst_signal?.label}`);

// air_health_recommendation: PM2.5 unhealthy + CO2 stale + VOC moderate
const rec = JSON.parse(
  (
    await client.callTool({
      name: "air_health_recommendation",
      arguments: { pm25_ug_m3: 60, co2_ppm: 1200, voc_index: 200 },
    })
  ).content[0].text,
);
assert.equal(rec.ok, true);
assert.equal(rec.pm25_band, "unhealthy", `pm25=60 should be 'unhealthy'; got '${rec.pm25_band}'`);
assert.equal(rec.co2_band, "stale", `co2=1200 should be 'stale'; got '${rec.co2_band}'`);
assert.equal(rec.voc_band, "moderate", `voc=200 should be 'moderate'; got '${rec.voc_band}'`);
assert.equal(rec.overall_quality, "unhealthy", "worst should be PM2.5 unhealthy");
assert.ok(Array.isArray(rec.recommendations) && rec.recommendations.length > 0, "recommendations must be non-empty");
assert.ok(rec.who_thresholds_url.includes("who.int"), "WHO URL should be present");
console.log(`✓ air_health_recommendation bands PM2.5/CO2/VOC; worst=${rec.overall_quality}`);

// air_health_recommendation: clean air → empty-action fallback message
const clean = JSON.parse(
  (
    await client.callTool({
      name: "air_health_recommendation",
      arguments: { pm25_ug_m3: 3, co2_ppm: 500, voc_index: 50 },
    })
  ).content[0].text,
);
assert.equal(clean.pm25_band, "good");
assert.equal(clean.co2_band, "fresh");
assert.equal(clean.voc_band, "low");
assert.ok(clean.recommendations[0].includes("clean"), "clean-air fallback message should appear");
console.log(`✓ air_health_recommendation clean-air fallback`);

// air_health_recommendation: markdown response_format
const md = await client.callTool({
  name: "air_health_recommendation",
  arguments: { pm25_ug_m3: 30, co2_ppm: 900, response_format: "markdown" },
});
const mdText = md.content[0].text;
assert.ok(mdText.startsWith("# Air health recommendation"), "markdown should start with heading");
assert.ok(mdText.includes("`unhealthy_sensitive`"), "markdown should include the pm25 band code");
console.log(`✓ air_health_recommendation markdown format`);

// air_trend: missing_location without env is graceful (no network call)
const trendNoLoc = JSON.parse(
  (await client.callTool({ name: "air_trend", arguments: { hours: 6, pollutant: "all" } })).content[0].text,
);
assert.equal(trendNoLoc.ok, false);
assert.equal(trendNoLoc.error, "missing_location");
console.log(`✓ air_trend reports missing_location when no env/locationId provided`);

// air_health_bands: 'good' band edges
const goodBands = JSON.parse(
  (
    await client.callTool({
      name: "air_health_bands",
      arguments: { pm25: 3, co2: 600 },
    })
  ).content[0].text,
);
assert.equal(goodBands.pollutants.pm25.label, "good", "pm25=3 should be 'good'");
assert.equal(goodBands.pollutants.co2.label, "good", "co2=600 should be 'good'");
console.log(`✓ air_health_bands 'good' edges (PM2.5=3, CO2=600)`);

await client.close();
console.log("\nall smoke checks passed.");
