#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Contract gate for `air_demo`.
 *
 * `air_demo` exists so an agent can see what `air_current_reading`,
 * `air_aqi_check` and `air_daily_summary` return BEFORE configuring a sensor.
 * That promise only holds if the example matches what the handlers actually
 * emit. A hand-written example nobody compares against reality drifts silently,
 * and an agent that trusts it writes a parser for fields that never arrive —
 * or never learns about a field that does.
 *
 * This gate runs the REAL tool handlers (registered exactly as the server
 * registers them, decorator included) over a synthetic AirGradient fixture, and
 * compares key sets against the `air_demo` payload, failing in BOTH directions:
 *
 *   - a key in the demo that the handlers never emit  -> invented contract
 *   - a key the handlers emit that the demo omits     -> incomplete contract
 *
 * Arrays are compared as the union of their elements' key paths: one element
 * alone under-describes the shape.
 *
 * No network: `globalThis.fetch` is replaced and throws on any URL other than
 * the AirGradient public world feed, so a handler that started calling out
 * would fail here instead of silently passing.
 *
 * If you change a handler's response shape, this gate fails and points at
 * `air_demo` in src/tools/air-tools.ts. Update the demo — do not weaken the gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(here, "..", "fixtures", "airgradient-world-current.json");
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
const FIXTURE_LOCATION_ID = "999001";
const WORLD_FEED_PATH = "/public/api/v1/world/locations/measures/current";

/**
 * Keys the handlers emit only for a specific call shape, so the demo — which
 * depicts the plain call — may legitimately omit them. Each entry needs a
 * reason. Deliberately narrow: adding a key here to silence the gate defeats
 * the gate.
 */
const CONDITIONAL_ON_REQUEST = new Map([
  [
    "privacy_mode",
    "echoed back only when the caller passes privacy_mode; the demo depicts the default call (`air_current_reading {}`).",
  ],
]);

// ---------------------------------------------------------------------------
// Network stub — the fixture IS the provider.
// ---------------------------------------------------------------------------
let fetchCalls = 0;
globalThis.fetch = async (url) => {
  const target = String(url);
  fetchCalls += 1;
  if (!target.includes(WORLD_FEED_PATH)) {
    throw new Error(`demo-contract gate blocked an unexpected network call: ${target}`);
  }
  return new Response(JSON.stringify(FIXTURE), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

// A stray token in the shell env would route reads to the owned-sensor endpoint
// (different URL, real network). Pin the env the gate assumes.
delete process.env.AIRGRADIENT_API_TOKEN;
process.env.WELLNESS_AIR_DEFAULT_PROVIDER = "airgradient";
process.env.WELLNESS_AIR_DEFAULT_LOCATION = FIXTURE_LOCATION_ID;

const { registerAirTools } = await import("../dist/tools/air-tools.js");

// Capture the handlers the way the MCP server receives them: registerAirTools
// wraps server.registerTool with decorateReadToolConfig, so this records the
// same (name, config, handler) triple that reaches the real McpServer.
const registered = new Map();
registerAirTools({
  registerTool(name, config, handler) {
    registered.set(name, { config, handler });
  },
});

async function callTool(name, args = {}) {
  const entry = registered.get(name);
  assert.ok(entry, `tool ${name} is not registered`);
  const res = await entry.handler(args, {});
  // Parse the text content: that is the JSON an agent actually receives, so
  // keys whose value is undefined are dropped here exactly as on the wire.
  return JSON.parse(res.content[0].text);
}

function keyPaths(value, prefix = "", out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
    return out;
  }
  if (value === null || typeof value !== "object") return out;
  for (const key of Object.keys(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.add(p);
    keyPaths(value[key], p, out);
  }
  return out;
}

function diff(demoSet, realSet) {
  const invented = [...demoSet].filter((k) => !realSet.has(k)).sort();
  const missing = [...realSet]
    .filter((k) => !demoSet.has(k) && !CONDITIONAL_ON_REQUEST.has(k))
    .sort();
  return { invented, missing };
}

function report(name, invented, missing) {
  const lines = [];
  if (invented.length > 0) {
    lines.push(
      `\n  ${name}: ${invented.length} key(s) in the demo that the real handler NEVER returns.`,
      `  An agent trusting these writes a parser for data that never arrives:`,
      ...invented.map((k) => `    - ${k}`),
    );
  }
  if (missing.length > 0) {
    lines.push(
      `\n  ${name}: ${missing.length} key(s) the real handler returns but the demo omits.`,
      `  Agents reading the demo will not know these exist:`,
      ...missing.map((k) => `    + ${k}`),
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Real payloads. The default call is the shape the demo depicts; the
// privacy_mode call is unioned in so a field only reachable with that argument
// is still recognised as part of the contract (see CONDITIONAL_ON_REQUEST).
// ---------------------------------------------------------------------------
const real = {
  air_current_reading: [
    await callTool("air_current_reading"),
    await callTool("air_current_reading", { privacy_mode: "structured" }),
  ],
  air_aqi_check: [await callTool("air_aqi_check")],
  air_daily_summary: [await callTool("air_daily_summary")],
};

assert.ok(fetchCalls > 0, "gate made no provider call — the handlers were not exercised");

const demoPayload = await callTool("air_demo");
const demo = demoPayload.sample;

const failures = [];
let checked = 0;

for (const [name, payloads] of Object.entries(real)) {
  assert.ok(demo[name], `air_demo is missing the ${name} sample entirely`);
  const realSet = new Set();
  for (const payload of payloads) keyPaths(payload, "", realSet);
  const demoSet = keyPaths(demo[name]);
  const { invented, missing } = diff(demoSet, realSet);
  checked += demoSet.size;
  if (invented.length > 0 || missing.length > 0) {
    failures.push(report(name, invented, missing));
  } else {
    console.log(`PASS ${name} — ${demoSet.size} key paths match the real handler`);
  }
}

if (failures.length > 0) {
  console.error("\nFAIL air_demo drifted from the real handlers:");
  console.error(failures.join("\n"));
  console.error(
    "\nFix the air_demo sample in src/tools/air-tools.ts so it matches what the handlers return." +
      "\nDo not widen CONDITIONAL_ON_REQUEST to silence this — that is how drift gets in.\n",
  );
  process.exit(1);
}

// The demo must stay honest about being synthetic, whatever the shape says.
assert.equal(demoPayload.is_demo, true, "air_demo payload must be tagged is_demo=true");
assert.ok(
  Array.isArray(demoPayload.notes) && demoPayload.notes.length > 0,
  "air_demo payload must carry notes explaining the sample is synthetic",
);
console.log("PASS demo payload is tagged synthetic");

// The fixture deliberately carries positional / identifying columns that the
// mapper drops. A demo showing them would teach agents a contract the server
// does not have — and would leak shape the privacy posture claims to omit.
const encoded = JSON.stringify(demoPayload).toLowerCase();
for (const needle of ["latitude", "longitude", "serialnumber", "locationname", "deviceid"]) {
  assert.ok(!encoded.includes(needle), `air_demo payload must not contain "${needle}"`);
}
console.log("PASS demo payload carries no positional or device-identifier keys");

console.log(`\ndemo-contract: ${checked} key paths verified against the real handlers`);
console.log(JSON.stringify({ ok: true, suite: "demo-contract", samples: Object.keys(real).length }));
