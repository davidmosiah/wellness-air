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
 *  - temporal fields survive any input order (test 9): provider row order is
 *    not a contract, and current / last_sample_at / rate_of_change assumed it
 *  - VOC spike span is measured with the RUN's cadence (test 10), not the
 *    window's global one, and short spikes are not inflated to "1-hour"
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

// ────────────────────────────────────────────────────────────────────────────
// Test 9: temporal fields must not depend on the order the provider returned
// rows in.
//
// 0.6.0 read array position as position in time — `current` was
// `values[values.length - 1]`, `last_sample_at` was `timestamps[last]`, and the
// rate of change compared the first quarter of the ARRAY to the last quarter.
// The integrator sorts internally, so minutes and coverage were already robust;
// nothing else was. AirGradient happens to return ascending, but that was never
// a contract, and 0.6.0 additionally began STATING the assumption out loud
// ("Last sample: X", "current may be stale") — a wrong claim made with
// confidence is worse than the silence it replaced.
//
// Measured on the 0.6.0 build with this exact fixture fed newest-first:
//   time_above_threshold_minutes  120        (correct — integrator sorts)
//   current                        40        (should be 17 — that is the OLDEST)
//   rate_of_change_per_hour     +0.75        (should be -0.75 — sign flipped)
//   last_sample_at    ...T00:00:00Z          (should be ...T01:55:00Z)
//   low-coverage note quotes that same oldest timestamp as "Last sample"
// ────────────────────────────────────────────────────────────────────────────
{
  const base = Date.parse("2026-05-20T00:00:00.000Z");
  const iso = (ms) => new Date(ms).toISOString();
  const FIVE_MIN = 5 * 60 * 1000;

  // 24 samples every 5 min, PM2.5 falling 40 → 17. Strictly decreasing, so the
  // true newest reading (17) and the true oldest (40) can never be confused.
  const ascending = [];
  for (let i = 0; i < 24; i++) {
    ascending.push({ timestamp: iso(base + i * FIVE_MIN), pm25: 40 - i });
  }
  const OLDEST = ascending[0].timestamp; // 00:00
  const NEWEST = ascending[23].timestamp; // 01:55

  const descending = [...ascending].reverse();
  // Also shuffle deterministically: "sorted enough to look fine" is the failure
  // mode a merged/paged response actually produces.
  const shuffled = [...ascending];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1); // deterministic, no RNG
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const expected = analyzeAirTrend(ascending, 24, "pm25");

  for (const [label, samples] of [
    ["newest-first", descending],
    ["shuffled", shuffled],
  ]) {
    const result = analyzeAirTrend(samples, 24, "pm25");
    const t = result.trend;

    assert.equal(
      t.last_sample_at,
      NEWEST,
      `${label}: last_sample_at must be the NEWEST sample (${NEWEST}), got ${t.last_sample_at}`,
    );
    assert.notEqual(t.last_sample_at, OLDEST, `${label}: last_sample_at is the oldest sample`);
    assert.equal(
      t.current,
      17,
      `${label}: current must be the newest reading (17), got ${t.current}`,
    );
    assert.ok(
      t.rate_of_change_per_hour < 0,
      `${label}: series falls over time, rate must be negative; got ${t.rate_of_change_per_hour}`,
    );
    assert.equal(
      t.peak_at,
      OLDEST,
      `${label}: peak (40) is the oldest sample; got ${t.peak_at}`,
    );
    assert.equal(
      t.trough_at,
      NEWEST,
      `${label}: trough (17) is the newest sample; got ${t.trough_at}`,
    );

    // Whole-object equality: order must not change ANY field, not just the ones
    // enumerated above — that is what stops the next temporal field from
    // silently inheriting the same assumption.
    assert.deepEqual(
      t,
      expected.trend,
      `${label}: analysis must be identical to the ascending series`,
    );

    // The coverage note quotes last_sample_at — the note must not assert the
    // oldest timestamp as the most recent reading.
    const note = result.notes.find((n) => n.includes("pm25"));
    assert.ok(note, `${label}: expected a low-coverage note`);
    assert.ok(
      note.includes(NEWEST),
      `${label}: note must quote the newest sample; got "${note}"`,
    );
    assert.ok(
      !note.includes(OLDEST),
      `${label}: note quotes the OLDEST sample as "Last sample"; got "${note}"`,
    );
    console.log(`✓ 9 ${label} series → identical analysis, last_sample_at = newest`);
  }

  // Unparseable timestamps must still be counted, but must never be reported as
  // the most recent sample — they cannot be placed in time at all.
  {
    const withBadTs = [
      { timestamp: "not-a-timestamp", pm25: 999 },
      ...descending,
    ];
    const t = analyzeAirTrend(withBadTs, 24, "pm25").trend;
    assert.equal(t.samples_analyzed, 25, "undated sample should still be counted");
    assert.equal(t.max, 999, "undated sample's value should still reach min/max/mean");
    assert.equal(
      t.last_sample_at,
      NEWEST,
      `undated sample must not become last_sample_at; got ${t.last_sample_at}`,
    );
    console.log("✓ 9 undated sample counted but never reported as the latest");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Test 10: the VOC spike observation must span the RUN, measured with the run's
// own sampling cadence.
//
// 0.6.0 padded the run's real elapsed time with the GLOBAL median cadence,
// which equals the run's cadence only when the sensor sampled evenly across the
// whole window. Measured on the 0.6.0 build:
//   run 14:30→15:30 (30-min cadence) in an hourly window  → "2-hour spike"
//   the same run in a 10-min-cadence window               → "1.2-hour spike"
// One physical event, two different durations, both wrong. And every span below
// an hour was floored to "1-hour" by a Math.max(1, …), so a 15-minute spike was
// announced as an hour long.
// ────────────────────────────────────────────────────────────────────────────
{
  const base = Date.parse("2026-05-20T00:00:00.000Z");
  const iso = (ms) => new Date(ms).toISOString();

  // The run itself: three samples above 300, spanning 14:30 → 15:30. Midpoint
  // rule over its own 30-min cadence = 60 min elapsed + 30 min of edges = 90 min.
  const RUN = [
    { timestamp: "2026-05-20T14:30:00.000Z", voc: 380 },
    { timestamp: "2026-05-20T15:00:00.000Z", voc: 420 },
    { timestamp: "2026-05-20T15:30:00.000Z", voc: 350 },
  ];

  // 10a — sparse baseline (hourly). Global median cadence 60 min.
  const sparse = [
    { timestamp: "2026-05-20T10:00:00.000Z", voc: 80 },
    { timestamp: "2026-05-20T11:00:00.000Z", voc: 90 },
    { timestamp: "2026-05-20T12:00:00.000Z", voc: 100 },
    { timestamp: "2026-05-20T13:00:00.000Z", voc: 110 },
    ...RUN,
    { timestamp: "2026-05-20T16:00:00.000Z", voc: 120 },
  ];

  // 10b — dense baseline (every 10 min, 08:00–13:00), IDENTICAL run.
  // Global median cadence 10 min.
  const dense = [];
  for (let m = 0; m <= 300; m += 10) {
    dense.push({ timestamp: iso(Date.parse("2026-05-20T08:00:00.000Z") + m * 60_000), voc: 100 });
  }
  dense.push(...RUN, { timestamp: "2026-05-20T16:00:00.000Z", voc: 120 });

  const sparseObs = analyzeAirTrend(sparse, 6, "voc").trend.observation;
  const denseObs = analyzeAirTrend(dense, 8, "voc").trend.observation;

  assert.ok(sparseObs, "sparse fixture should produce a VOC observation");
  assert.ok(denseObs, "dense fixture should produce a VOC observation");

  // Numeric assertion on the span itself, not just "mentions spike".
  const spanOf = (obs) => {
    const m = obs.match(/a ([\d.]+)-(hour|minute) spike/);
    assert.ok(m, `could not parse a span out of: ${obs}`);
    return m[2] === "hour" ? Number(m[1]) * 60 : Number(m[1]);
  };

  assert.equal(
    spanOf(sparseObs),
    90,
    `run 14:30→15:30 at 30-min cadence spans 90 min (was 120 — global cadence padding); got: ${sparseObs}`,
  );
  assert.equal(
    spanOf(denseObs),
    spanOf(sparseObs),
    `same physical run must report the same span regardless of baseline cadence: ` +
      `sparse="${sparseObs}" dense="${denseObs}"`,
  );
  assert.ok(
    sparseObs.includes("1.5-hour spike"),
    `expected "1.5-hour spike"; got: ${sparseObs}`,
  );
  console.log("✓ 10a/b VOC span = 90 min from the run's own cadence, baseline-independent");

  // 10c — a short spike must not be inflated to an hour. Three samples at a
  // 5-min cadence span 15 min (10 min elapsed + 5 min of edges).
  {
    const samples = [];
    for (let i = 0; i < 12; i++) {
      samples.push({ timestamp: iso(base + i * 5 * 60_000), voc: i >= 4 && i <= 6 ? 380 : 100 });
    }
    const obs = analyzeAirTrend(samples, 1, "voc").trend.observation;
    assert.ok(obs, "expected a VOC observation for the short spike");
    assert.equal(
      spanOf(obs),
      15,
      `three samples 5 min apart span 15 min, not an hour (was "1-hour"); got: ${obs}`,
    );
    assert.ok(obs.includes("15-minute spike"), `expected "15-minute spike"; got: ${obs}`);
    console.log("✓ 10c 15-minute spike reported in minutes, not floored to '1-hour'");
  }

  // 10d — the observation must not depend on input order either.
  {
    const reversed = [...sparse].reverse();
    assert.equal(
      analyzeAirTrend(reversed, 6, "voc").trend.observation,
      sparseObs,
      "VOC observation must survive a newest-first series",
    );
    console.log("✓ 10d VOC observation identical on a newest-first series");
  }
}

console.log("\nall air_trend unit tests passed.");
