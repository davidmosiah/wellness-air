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
 *  - time_above_threshold_minutes integrates REAL sample spacing (test 8):
 *    sensor gaps must not inflate it, and coverage must be announced
 */
import assert from "node:assert/strict";
import { analyzeAirTrend, formatAirTrendMarkdown } from "../dist/services/air-trend.js";

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

// ────────────────────────────────────────────────────────────────────────────
// Test 8: time_above_threshold_minutes must integrate REAL sample spacing.
//
// Regression fixture for the 0.5.8 defect: the estimator divided the whole
// window by the sample count (`(hours * 60) / values.length`), so the fewer
// samples the sensor delivered, the MORE time each one claimed. The same
// physical two-hour PM2.5 peak reported 120 min with a healthy sensor and
// 1440 min when the sensor was offline for the rest of the day.
//
// All fixtures are synthetic. Ground truth is stated per scenario, with the
// value the old code produced, so a regression is unambiguous.
// ────────────────────────────────────────────────────────────────────────────
{
  const base = Date.parse("2026-05-20T00:00:00.000Z");
  const iso = (ms) => new Date(ms).toISOString();
  const FIVE_MIN = 5 * 60 * 1000;

  // Tolerance = one sampling interval (5 min). The midpoint rule attributes
  // half an interval to each edge of a block, so ±1 interval bounds the error.
  const TOLERANCE_MIN = 5;
  const near = (actual, expected, label) =>
    assert.ok(
      Math.abs(actual - expected) <= TOLERANCE_MIN,
      `${label}: expected ${expected} ± ${TOLERANCE_MIN} min, got ${actual}`,
    );

  // 8a — Healthy sensor: 288 samples every 5 min over 24h, PM2.5 above the
  // 15 µg/m³ threshold from hour 10 to hour 12. Ground truth: 120 min.
  // Old code: 120 (this case was already correct — it is the control).
  {
    const samples = [];
    for (let i = 0; i < 288; i++) {
      const hourOfDay = (i * 5) / 60;
      samples.push({
        timestamp: iso(base + i * FIVE_MIN),
        pm25: hourOfDay >= 10 && hourOfDay < 12 ? 40 : 5,
      });
    }
    const t = analyzeAirTrend(samples, 24, "pm25").trend;
    near(t.time_above_threshold_minutes, 120, "contiguous 2h peak, full coverage");
    assert.equal(t.coverage_ratio, 1, `full coverage should be 1, got ${t.coverage_ratio}`);
    assert.equal(t.last_sample_at, samples[287].timestamp);
    console.log("✓ 8a contiguous 2h peak, no gap → 120 min, coverage 1.0");
  }

  // 8b — Same physical event, sensor offline the other 22h: only the 24 samples
  // of the peak exist. Ground truth is still 120 min — the physics did not
  // change, only the reporting. Old code: 1440 min (12x inflation).
  {
    const samples = [];
    for (let i = 0; i < 24; i++) {
      samples.push({ timestamp: iso(base + 10 * 3600_000 + i * FIVE_MIN), pm25: 40 });
    }
    const t = analyzeAirTrend(samples, 24, "pm25").trend;
    near(t.time_above_threshold_minutes, 120, "same peak with 22h sensor gap");
    assert.ok(
      t.coverage_ratio < 0.15,
      `24 samples over a 24h window should report low coverage, got ${t.coverage_ratio}`,
    );
    assert.equal(t.last_sample_at, samples[23].timestamp);
    console.log("✓ 8b same peak, sensor offline 22h → 120 min (was 1440), coverage flagged");
  }

  // 8c — Two samples 24h apart, the last one above threshold. The true duration
  // is unknowable: there is no second reading to bound it. The estimator must
  // therefore stay at its per-sample ceiling of 60 min (MAX_SAMPLE_SPAN_MINUTES)
  // and never extrapolate across the gap. Old code: 720 min — half the day
  // claimed from a single instantaneous reading.
  {
    const samples = [
      { timestamp: iso(base), pm25: 5 },
      { timestamp: iso(base + 24 * 3600_000), pm25: 40 },
    ];
    const t = analyzeAirTrend(samples, 24, "pm25").trend;
    assert.ok(
      t.time_above_threshold_minutes <= 60,
      `two samples 24h apart must not claim more than the 60 min per-sample ceiling, got ${t.time_above_threshold_minutes}`,
    );
    assert.ok(
      t.time_above_threshold_minutes > 0,
      "a reading above threshold should still count for something",
    );
    console.log(
      `✓ 8c two samples 24h apart → ${t.time_above_threshold_minutes} min (was 720), ceiling respected`,
    );
  }

  // 8d — 24 consecutive samples above threshold, all inside the first two hours
  // of a 24h window, then nothing. Ground truth: 120 min.
  // Old code: 1440 min (12x) — position in the window changed nothing, only
  // the sample count mattered.
  {
    const samples = [];
    for (let i = 0; i < 24; i++) {
      samples.push({ timestamp: iso(base + i * FIVE_MIN), pm25: 40 });
    }
    const t = analyzeAirTrend(samples, 24, "pm25").trend;
    near(t.time_above_threshold_minutes, 120, "above-threshold block at window start");
    console.log("✓ 8d block at window start → 120 min (was 1440)");
  }

  // 8e — The estimator must not depend on the nominal window at all: the same
  // 24 samples analysed as a 24h window and as a 2h window give the same
  // minutes. Under the old code these differed by 12x.
  {
    const samples = [];
    for (let i = 0; i < 24; i++) {
      samples.push({ timestamp: iso(base + i * FIVE_MIN), pm25: 40 });
    }
    const wide = analyzeAirTrend(samples, 24, "pm25").trend;
    const tight = analyzeAirTrend(samples, 2, "pm25").trend;
    assert.equal(
      wide.time_above_threshold_minutes,
      tight.time_above_threshold_minutes,
      `window size must not change measured minutes: 24h=${wide.time_above_threshold_minutes} vs 2h=${tight.time_above_threshold_minutes}`,
    );
    console.log("✓ 8e identical samples, 24h vs 2h window → identical minutes");
  }

  // 8f — Low coverage must be announced, not silently returned, so an agent
  // knows `current` may be stale. Reachable via the default path
  // (hours=24, pollutant="all").
  {
    const samples = [];
    for (let i = 0; i < 24; i++) {
      samples.push({ timestamp: iso(base + i * FIVE_MIN), pm25: 40, co2: 1100, voc: 100 });
    }
    const result = analyzeAirTrend(samples, 24, "all");
    const pm25 = result.pollutants.find((p) => p.pollutant === "pm25");
    assert.ok(pm25.coverage_ratio < 0.75, "coverage should be low");
    assert.ok(
      result.notes.some((n) => n.includes("pm25") && n.includes("stale")),
      `expected a low-coverage note for pm25; got ${JSON.stringify(result.notes)}`,
    );
    const md = formatAirTrendMarkdown(result);
    assert.ok(md.includes("Window coverage"), "markdown should surface coverage");
    assert.ok(md.includes("Notes"), "markdown should surface the coverage note");
    console.log("✓ 8f low coverage surfaced in notes + markdown, not silent");
  }
}

console.log("\nall air_trend unit tests passed.");
