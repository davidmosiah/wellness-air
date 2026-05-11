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

await client.close();
console.log("\nall smoke checks passed.");
