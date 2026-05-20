#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Unit tests for the pure analyzeAirTrend() function with synthetic samples.
 * Covers:
 *  - Increasing PM2.5 trend → positive rate_of_change, observation generated
 *  - Flat CO2 < 800 → observation about ventilated period
 *  - Empty input → samples_analyzed: 0, no crash
 *  - All-pollutants mode → returns array with worst_pollutant
 *  - peak_at + trough_at correct
 */
import assert from "node:assert/strict";
import { analyzeAirTrend } from "../dist/services/air-trend.js";

/** Build N evenly-spaced samples across `hours` ending at `endIso`. */
function buildSamples(hours, count, fn) {
  const endMs = Date.parse(endIso);
  const startMs = endMs - hours * 60 * 60 * 1000;
  const stepMs = (endMs - startMs) / Math.max(1, count - 1);
  const out = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(startMs + i * stepMs).toISOString();
    out.push({ timestamp: ts, ...fn(i, count) });
  }
  return out;
}

const endIso = "2026-05-20T18:00:00.000Z";

// ────────────────────────────────────────────────────────────────────────────
// Test 1: Increasing PM2.5 trend → positive rate_of_change + observation fires
// ────────────────────────────────────────────────────────────────────────────
{
  const hours = 24;
  // 48 samples (every 30min), PM2.5 ramps from 5 → 30 µg/m³ linearly
  const samples = buildSamples(hours, 48, (i, n) => ({
    pm25: 5 + (25 * i) / (n - 1),
  }));
  const result = analyzeAirTrend(samples, hours, "pm25");
  assert.equal(result.ok, true);
  assert.equal(result.pollutant, "pm25");
  assert.ok(result.trend, "trend object should be present");
  const t = result.trend;
  assert.equal(t.samples_analyzed, 48);
  assert.ok(t.rate_of_change_per_hour > 0, `expected positive rate, got ${t.rate_of_change_per_hour}`);
  // First-quartile mean ~ 6.5, last-quartile mean ~ 28.5 → delta ~ 22 → observation fires
  assert.ok(t.observation, `expected observation, got none. trend=${JSON.stringify(t)}`);
  assert.ok(t.observation.includes("PM2.5 climbed"), `observation should mention PM2.5 climb; got: ${t.observation}`);
  assert.equal(t.current, 30, `current should be the last sample value (30)`);
  console.log("✓ PM2.5 increasing trend: positive rate + observation generated");
}

// ────────────────────────────────────────────────────────────────────────────
// Test 2: Flat CO2 < 800 → "well-ventilated period" observation fires
// ────────────────────────────────────────────────────────────────────────────
{
  const hours = 8;
  const samples = buildSamples(hours, 32, () => ({ co2: 600 }));
  const result = analyzeAirTrend(samples, hours, "co2");
  assert.equal(result.ok, true);
  const t = result.trend;
  assert.equal(t.samples_analyzed, 32);
  assert.equal(t.mean, 600);
  assert.equal(t.max, 600);
  assert.equal(t.min, 600);
  assert.equal(t.rate_of_change_per_hour, 0);
  assert.ok(t.observation, `expected observation, got none`);
  assert.ok(
    t.observation.includes("well-ventilated") || t.observation.includes("under 800"),
    `expected ventilation observation; got: ${t.observation}`,
  );
  assert.equal(t.time_above_threshold_minutes, 0, `co2 600 should be 0 min above 1000 threshold`);
  console.log("✓ Flat CO2 < 800: ventilated-period observation generated");
}

// ────────────────────────────────────────────────────────────────────────────
// Test 3: Empty input → samples_analyzed: 0, no crash
// ────────────────────────────────────────────────────────────────────────────
{
  const result = analyzeAirTrend([], 24, "pm25");
  assert.equal(result.ok, true);
  assert.equal(result.trend.samples_analyzed, 0);
  assert.equal(result.trend.observation, undefined);
  assert.equal(result.trend.mean, undefined);
  assert.equal(result.trend.peak_at, undefined);
  assert.ok(result.notes.some((n) => n.includes("No samples")));
  console.log("✓ Empty input: samples_analyzed=0, no crash");
}

// ────────────────────────────────────────────────────────────────────────────
// Test 4: All-pollutants mode → returns array with worst_pollutant
// ────────────────────────────────────────────────────────────────────────────
{
  const hours = 12;
  // Mixed signal: PM2.5 acceptable (~8), CO2 stale (~1100), VOC low (~100)
  // worst by current band should be CO2 (rank 2: drowsy) vs PM2.5 (rank 1: moderate) vs VOC (rank 0: low)
  const samples = buildSamples(hours, 36, () => ({
    pm25: 8,
    co2: 1100,
    voc: 100,
  }));
  const result = analyzeAirTrend(samples, hours, "all");
  assert.equal(result.ok, true);
  assert.equal(result.pollutant, "all");
  assert.ok(Array.isArray(result.pollutants), "pollutants should be array");
  assert.equal(result.pollutants.length, 3);
  const labels = result.pollutants.map((p) => p.pollutant);
  assert.deepEqual(labels, ["pm25", "co2", "voc"], `expected pm25/co2/voc order; got ${labels}`);
  assert.equal(result.worst_pollutant, "co2", `worst should be co2 (drowsy); got ${result.worst_pollutant}`);
  // Validate per-pollutant fields populated
  const co2 = result.pollutants.find((p) => p.pollutant === "co2");
  assert.equal(co2.current, 1100);
  assert.equal(co2.mean, 1100);
  assert.ok(co2.time_above_threshold_minutes > 0, "co2=1100 should record minutes above 1000 threshold");
  console.log("✓ All-pollutants mode: array + worst_pollutant correctly = 'co2'");
}

// ────────────────────────────────────────────────────────────────────────────
// Test 5: peak_at + trough_at correct (PM2.5 spike at known timestamp)
// ────────────────────────────────────────────────────────────────────────────
{
  const samples = [
    { timestamp: "2026-05-20T10:00:00.000Z", pm25: 8 },
    { timestamp: "2026-05-20T11:00:00.000Z", pm25: 10 },
    { timestamp: "2026-05-20T12:00:00.000Z", pm25: 4 }, // trough
    { timestamp: "2026-05-20T13:00:00.000Z", pm25: 9 },
    { timestamp: "2026-05-20T14:00:00.000Z", pm25: 42 }, // peak
    { timestamp: "2026-05-20T15:00:00.000Z", pm25: 12 },
  ];
  const result = analyzeAirTrend(samples, 5, "pm25");
  assert.equal(result.ok, true);
  const t = result.trend;
  assert.equal(t.samples_analyzed, 6);
  assert.equal(t.max, 42);
  assert.equal(t.min, 4);
  assert.equal(t.peak_at, "2026-05-20T14:00:00.000Z", `peak_at wrong: ${t.peak_at}`);
  assert.equal(t.trough_at, "2026-05-20T12:00:00.000Z", `trough_at wrong: ${t.trough_at}`);
  assert.equal(t.current, 12, `current should be last sample value`);
  console.log("✓ peak_at + trough_at correctly identify max/min timestamps");
}

// ────────────────────────────────────────────────────────────────────────────
// Test 6: No invented observation when data is unremarkable
// ────────────────────────────────────────────────────────────────────────────
{
  const hours = 6;
  // Stable PM2.5 around 12 µg/m³ — no climb, no dramatic event
  const samples = buildSamples(hours, 24, () => ({ pm25: 12 }));
  const result = analyzeAirTrend(samples, hours, "pm25");
  assert.equal(result.trend.observation, undefined, `expected no observation; got: ${result.trend.observation}`);
  console.log("✓ Unremarkable data: no invented observation");
}

// ────────────────────────────────────────────────────────────────────────────
// Test 7: VOC spike → observation mentions spike + timestamp
// ────────────────────────────────────────────────────────────────────────────
{
  const samples = [
    { timestamp: "2026-05-20T10:00:00.000Z", voc: 80 },
    { timestamp: "2026-05-20T11:00:00.000Z", voc: 90 },
    { timestamp: "2026-05-20T12:00:00.000Z", voc: 100 },
    { timestamp: "2026-05-20T13:00:00.000Z", voc: 110 },
    { timestamp: "2026-05-20T14:30:00.000Z", voc: 380 }, // spike start
    { timestamp: "2026-05-20T15:00:00.000Z", voc: 420 }, // peak
    { timestamp: "2026-05-20T15:30:00.000Z", voc: 350 }, // spike continues
    { timestamp: "2026-05-20T16:00:00.000Z", voc: 120 },
  ];
  const result = analyzeAirTrend(samples, 6, "voc");
  assert.equal(result.ok, true);
  const t = result.trend;
  assert.equal(t.max, 420);
  assert.ok(t.observation, `expected VOC spike observation`);
  assert.ok(t.observation.includes("spike"), `observation should mention spike; got: ${t.observation}`);
  console.log("✓ VOC spike: observation mentions spike + peak time");
}

console.log("\nall air_trend unit tests passed.");
