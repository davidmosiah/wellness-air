/**
 * air_trend — windowed trend analysis over PM2.5 / CO2 / VOC samples.
 *
 * Splits the analysis window into quartiles, compares last-quarter mean to
 * first-quarter mean, and divides by hours to express the slope as
 * "rate of change per hour". Surfaces a natural-language observation ONLY
 * when the signal is strong enough to defend — never invents a finding.
 *
 * Pure function `analyzeAirTrend(...)` accepts samples + window, returning the
 * structured result. `buildAirTrend(...)` is the IO wrapper that pulls samples
 * from AirGradient (public or owned). `formatAirTrendMarkdown(...)` renders the
 * result for response_format: "markdown".
 *
 * Pollutant thresholds for time_above_threshold_minutes:
 *  - PM2.5: 15 µg/m³ (WHO 2021 24-hour mean guideline)
 *  - CO2: 1000 ppm (ASHRAE 62.1-2019 occupied-space upper bound)
 *  - VOC: 250 index (mid-range threshold consistent with AirGradient / Awair UX)
 *
 * `time_above_threshold_minutes` integrates over the REAL spacing between
 * neighbouring samples (midpoint rule), never over the nominal window. Sensor
 * downtime therefore shrinks the number instead of inflating it, and
 * `coverage_ratio` / `last_sample_at` tell the caller how much of the window
 * the sensor actually observed.
 *
 * The series is sorted chronologically ONCE, at the entry point
 * (`analyzeAirTrend`), and every temporal field is derived from that sorted
 * series — see `sortSamplesChronologically`.
 */

import type { AirReading } from "./airgradient-client.js";
import { AirGradientClient } from "./airgradient-client.js";

export type TrendPollutant = "pm25" | "co2" | "voc";
export type TrendPollutantOrAll = TrendPollutant | "all";

const THRESHOLD: Record<TrendPollutant, number> = {
  pm25: 15,
  co2: 1000,
  voc: 250,
};

const UNIT: Record<TrendPollutant, string> = {
  pm25: "µg/m³",
  co2: "ppm",
  voc: "index",
};

/**
 * Hard ceiling on how much wall-clock time a SINGLE sample may represent.
 * A reading is an instantaneous measurement; without a neighbouring sample to
 * bound it, one hour is the most it can honestly speak for. This is what stops
 * a lone reading either side of a sensor outage from claiming the whole gap.
 *
 * WHY 60 — a chosen bound, not a derived one. Three constraints meet here:
 *  1. Consumer indoor sensors report on the order of 1–10 min (AirGradient
 *     ~5 min, AirThings ~5 min, PurpleAir ~2 min, Awair ~1 min). 60 min is
 *     ~6–60x the widest of those cadences, so it never clips a HEALTHY series —
 *     the cap only ever engages on a real outage.
 *  2. It is the coarsest granularity the tool reports on (`hours`, and the
 *     observation strings), so an error of at most one cap is at most one unit
 *     of the answer.
 *  3. Indoor air events (cooking, cleaning, a closed room filling with CO2)
 *     evolve on a scale of tens of minutes; assuming a reading still holds an
 *     hour later is already generous, and two hours would not be defensible.
 * Raising it makes outage-adjacent readings claim more time (the 0.5.8 defect,
 * in miniature); lowering it starts under-counting sparse-but-honest sensors.
 * Change it only with a fixture that shows which of the two you are trading.
 */
const MAX_SAMPLE_SPAN_MINUTES = 60;

/**
 * Below this fraction of window coverage, `time_above_threshold_minutes` is a
 * floor rather than a measurement and `current` may be stale — say so in notes.
 *
 * WHY 0.75 — a chosen threshold, not a derived one. It is the point at which a
 * caller's default reading of the output ("this describes the window I asked
 * for") stops being safe. At 0.75 the sensor missed a quarter of the window: on
 * the default 24h call that is 6 hours unobserved, enough to hide a whole
 * cooking or cleaning event, so the caveat is warranted. Above it, the gaps are
 * short enough that the midpoint rule interpolates them within the per-sample
 * cap and the number reads as a measurement.
 * It is deliberately loose: a sensor dropping the odd sample (0.95+) should not
 * emit a caveat on every call — a note that always fires is a note nobody
 * reads. Tightening it towards 0.95 trades false calm for note fatigue.
 * This gates only the NOTE. The numbers themselves are always honest about
 * coverage: `coverage_ratio` is reported unconditionally, at every level.
 */
const LOW_COVERAGE_RATIO = 0.75;

/** WHO/ASHRAE "current band severity rank" used to pick worst pollutant for 'all' mode. */
function currentBandRank(pollutant: TrendPollutant, value: number): number {
  if (pollutant === "pm25") {
    if (value < 5) return 0;
    if (value < 10) return 1;
    if (value < 15) return 2;
    if (value < 25) return 3;
    if (value < 50) return 4;
    return 5;
  }
  if (pollutant === "co2") {
    if (value < 800) return 0;
    if (value < 1000) return 1;
    if (value < 1400) return 2;
    if (value < 2000) return 3;
    return 4;
  }
  // voc
  if (value < 150) return 0;
  if (value < 250) return 1;
  if (value < 400) return 2;
  return 3;
}

export interface TrendSample {
  timestamp: string;
  pm25?: number;
  co2?: number;
  voc?: number;
}

export interface PerPollutantTrend {
  pollutant: TrendPollutant;
  unit: string;
  samples_analyzed: number;
  mean?: number;
  median?: number;
  min?: number;
  max?: number;
  current?: number;
  rate_of_change_per_hour?: number;
  peak_at?: string;
  trough_at?: string;
  time_above_threshold_minutes: number;
  threshold: number;
  /**
   * Fraction (0–1) of the requested window actually covered by samples,
   * integrating real sample spacing. 1 = continuous coverage; 0.08 = the sensor
   * only reported for ~8% of the window. Low values mean
   * `time_above_threshold_minutes` is a floor and `current` may be stale.
   */
  coverage_ratio: number;
  /**
   * ISO timestamp of the most recent sample backing `current`. Derived from the
   * chronologically sorted series, so it is the newest reading regardless of
   * the order the provider returned rows in.
   */
  last_sample_at?: string;
  observation?: string;
}

export interface AirTrendResult {
  ok: true;
  hours: number;
  pollutant: TrendPollutantOrAll;
  pollutants?: PerPollutantTrend[];
  trend?: PerPollutantTrend;
  worst_pollutant?: TrendPollutant;
  notes: string[];
}

/** Map raw AirReading to the slim TrendSample shape. */
export function readingToTrendSample(r: AirReading): TrendSample {
  return {
    timestamp: r.timestamp,
    pm25: r.pm25,
    co2: r.co2,
    voc: r.tvoc,
  };
}

function median(sorted: number[]): number | undefined {
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(value: number | undefined, digits = 2): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

interface TimeIntegration {
  /** Minutes attributable to samples above the threshold. */
  minutesAbove: number;
  /** Fraction (0–1) of the window covered by samples. */
  coverageRatio: number;
}

/**
 * Sort the sample series chronologically. Called ONCE, at the entry point
 * (`analyzeAirTrend`), so every downstream field is derived from an ordered
 * series.
 *
 * Chronological order is a PRECONDITION of every temporal field this module
 * emits — `current`, `last_sample_at`, `rate_of_change_per_hour`,
 * `peak_at`/`trough_at` tie-breaks, and the VOC run detection all read position
 * in the array as position in time. The provider contract never promised it.
 * AirGradient happens to return ascending today, but a descending page (or a
 * future provider, or a merge of two pages) would have made `current` the
 * OLDEST reading, flipped the sign of `rate_of_change_per_hour`, and — since
 * 0.6.0 — had `last_sample_at` and the low-coverage note state the oldest
 * timestamp as "Last sample" with full confidence. Measured on the 0.6.0 build
 * with a 24-sample series fed newest-first: minutes 120 (correct — the
 * integrator sorts internally), but current 40 instead of 17, rate +0.75
 * instead of -0.75, and last_sample_at 00:00 instead of 01:55.
 *
 * Samples whose timestamp cannot be parsed cannot be placed in time. They are
 * kept — their values still count towards mean/median/min/max/samples_analyzed,
 * and dropping readings silently would be its own defect — but sorted to the
 * FRONT, so an unplaceable sample can never be reported as the most recent one.
 * Equal timestamps keep input order (the sort is made stable explicitly rather
 * than relying on the engine's).
 */
function sortSamplesChronologically(samples: TrendSample[]): TrendSample[] {
  return samples
    .map((sample, index) => ({ sample, index, t: Date.parse(sample.timestamp ?? "") }))
    .sort((a, b) => {
      const aDated = Number.isFinite(a.t);
      const bDated = Number.isFinite(b.t);
      if (aDated !== bDated) return aDated ? 1 : -1; // undated first
      if (aDated && a.t !== b.t) return a.t - b.t;
      return a.index - b.index; // stable
    })
    .map((entry) => entry.sample);
}

/**
 * Parse the series into time points. `analyzeAirTrend` already ordered the
 * samples; the re-sort here is belt-and-braces for direct callers of the
 * integrator and costs nothing on an already-sorted array.
 */
function toTimePoints(values: number[], timestamps: string[]): { t: number; v: number }[] {
  const points: { t: number; v: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const t = Date.parse(timestamps[i] ?? "");
    if (Number.isFinite(t)) points.push({ t, v: values[i] });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/**
 * Midpoint rule over a chronologically ordered block of instants: how much
 * wall-clock time each sample stands for.
 *
 * Each point is credited half the gap to the previous point plus half the gap
 * to the next. The two outer edges have no neighbour and are credited half a
 * typical cadence each (the block's own median gap). Every half-gap is clamped
 * to `capMs / 2`, where `capMs = min(2 × median gap, MAX_SAMPLE_SPAN_MINUTES)`,
 * so a reading sitting beside a sensor outage cannot claim the outage.
 *
 * Shared by `integrateTimeAboveThreshold` (whole series) and the VOC
 * observation (one run), so the two can never disagree about how long a block
 * of samples lasted. Returns [] when the cadence is unknowable (<2 usable
 * points) — deliberately conservative.
 */
function perPointSpansMs(timesMs: number[]): number[] {
  if (timesMs.length < 2) return [];
  const gaps: number[] = [];
  for (let i = 1; i < timesMs.length; i++) {
    const delta = timesMs[i] - timesMs[i - 1];
    if (delta > 0) gaps.push(delta);
  }
  if (gaps.length === 0) return [];

  const medianGapMs = median([...gaps].sort((a, b) => a - b)) ?? 0;
  const ceilingMs = MAX_SAMPLE_SPAN_MINUTES * 60_000;
  // No sample may represent more than 2× the median cadence, nor more than the
  // absolute ceiling. Applied per side as capMs / 2.
  const capMs = Math.min(2 * medianGapMs, ceilingMs);
  // Block edges have no outer neighbour: credit one typical cadence, capped.
  const edgeMs = Math.min(medianGapMs, capMs);

  const spans: number[] = [];
  for (let i = 0; i < timesMs.length; i++) {
    const before = i > 0 ? timesMs[i] - timesMs[i - 1] : edgeMs;
    const after = i < timesMs.length - 1 ? timesMs[i + 1] - timesMs[i] : edgeMs;
    spans.push(Math.min(before, capMs) / 2 + Math.min(after, capMs) / 2);
  }
  return spans;
}

/**
 * Integrate "time above threshold" over the REAL spacing between samples
 * (midpoint / trapezoidal rule), not over the nominal window.
 *
 * Each sample is credited half the gap to the previous sample plus half the gap
 * to the next one, so 24 samples five minutes apart total 120 minutes whether
 * they sit inside a 24-hour window or a 2-hour one. No sample may be credited
 * more than `capMs = min(2 × median cadence, MAX_SAMPLE_SPAN_MINUTES)` in
 * total — each half-gap is clamped to `capMs / 2` — so a reading adjacent to a
 * sensor outage cannot claim the outage as time above threshold. Series edges
 * have no outer neighbour and are credited one median cadence (also capped).
 *
 * The previous implementation divided the whole window by the sample count,
 * which inflated the result by the inverse of sensor coverage: the same
 * two-hour PM2.5 peak read 120 min with a healthy sensor and 1440 min when the
 * sensor was offline for the other 22 hours.
 *
 * With fewer than two usable samples the cadence is unknowable and the result
 * is 0 with `coverage_ratio: 0` — deliberately conservative.
 */
function integrateTimeAboveThreshold(
  values: number[],
  timestamps: string[],
  threshold: number,
  hours: number,
): TimeIntegration {
  const windowMinutes = hours > 0 ? hours * 60 : 0;
  const points = toTimePoints(values, timestamps);
  const spans = perPointSpansMs(points.map((p) => p.t));
  if (spans.length === 0) return { minutesAbove: 0, coverageRatio: 0 };

  let aboveMs = 0;
  let coveredMs = 0;
  for (let i = 0; i < points.length; i++) {
    coveredMs += spans[i];
    if (points[i].v > threshold) aboveMs += spans[i];
  }

  const coveredMinutes = coveredMs / 60_000;
  const minutesAbove = Math.round(
    windowMinutes > 0 ? Math.min(aboveMs / 60_000, windowMinutes) : aboveMs / 60_000,
  );
  const coverageRatio =
    windowMinutes > 0 ? Math.min(1, coveredMinutes / windowMinutes) : 0;

  return {
    minutesAbove,
    coverageRatio: round(coverageRatio, 4) ?? 0,
  };
}

interface ExtractedSeries {
  values: number[];
  timestamps: string[];
}

function extractSeries(samples: TrendSample[], pollutant: TrendPollutant): ExtractedSeries {
  const values: number[] = [];
  const timestamps: string[] = [];
  for (const s of samples) {
    const v = s[pollutant];
    if (typeof v === "number" && Number.isFinite(v)) {
      values.push(v);
      timestamps.push(s.timestamp);
    }
  }
  return { values, timestamps };
}

/**
 * Generate a natural-language observation ONLY when the data supports a
 * defendable finding. Returns undefined otherwise.
 *
 * Rules (intentionally conservative — never invent):
 *  - PM2.5: monotonic-ish climb > 5 µg/m³ across last quartile vs first → combustion / smoke note
 *  - CO2: max < 800 ppm across the whole window → ventilated-period note
 *  - VOC: any contiguous 3+ samples in the window where value > 300 → spike note
 *    with timestamp, spanning the run's own observed duration
 *
 * `values`/`timestamps` must be in chronological order — `analyzeAirTrend`
 * guarantees it. Quartile comparisons and run detection read array position as
 * position in time.
 */
function generateObservation(
  pollutant: TrendPollutant,
  values: number[],
  timestamps: string[],
  firstQMean: number | undefined,
  lastQMean: number | undefined,
  maxValue: number | undefined,
  maxAt: string | undefined,
  hours: number,
): string | undefined {
  if (values.length < 4) return undefined;

  if (pollutant === "pm25") {
    if (firstQMean !== undefined && lastQMean !== undefined) {
      const delta = lastQMean - firstQMean;
      if (delta >= 5) {
        const rounded = Math.round(delta);
        return `PM2.5 climbed ${rounded} µg/m³ over the last ${Math.round(hours / 4)} hours — likely combustion source or external smoke event`;
      }
    }
    return undefined;
  }

  if (pollutant === "co2") {
    if (maxValue !== undefined && maxValue < 800) {
      return "CO2 stayed under 800 ppm for the full window — well-ventilated period";
    }
    return undefined;
  }

  // VOC: detect contiguous spike of 3+ samples above 300
  if (pollutant === "voc") {
    let runStart = -1;
    let runLen = 0;
    let bestRunStart = -1;
    let bestRunLen = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > 300) {
        if (runStart === -1) runStart = i;
        runLen++;
        if (runLen > bestRunLen) {
          bestRunLen = runLen;
          bestRunStart = runStart;
        }
      } else {
        runStart = -1;
        runLen = 0;
      }
    }
    if (bestRunLen >= 3 && bestRunStart >= 0) {
      // Span the run with the midpoint rule over the RUN'S OWN sample spacing.
      //
      // 0.6.0 used the run's real elapsed time plus the GLOBAL median cadence,
      // which is only the run's cadence when the sensor sampled evenly across
      // the whole window. Test 7's fixture is hourly outside the spike and
      // half-hourly inside it: a run genuinely spanning 14:30–15:30 was padded
      // by the global 60 min cadence and announced as a "2-hour spike".
      // perPointSpansMs derives the padding from the run itself (30 min here),
      // giving the honest 90 min — and it is the same primitive that produces
      // time_above_threshold_minutes, so the two can no longer disagree.
      const runTimes: number[] = [];
      for (let i = bestRunStart; i < bestRunStart + bestRunLen; i++) {
        const t = Date.parse(timestamps[i] ?? "");
        if (!Number.isFinite(t)) return undefined;
        runTimes.push(t);
      }
      const spanMinutes = perPointSpansMs(runTimes).reduce((a, b) => a + b, 0) / 60_000;
      if (spanMinutes <= 0) return undefined;

      const peakIso = maxAt ?? timestamps[bestRunStart];
      const peakLabel = peakIso.slice(11, 16); // HH:MM
      // Report the unit the span actually supports. 0.6.0 floored every span to
      // "1-hour" (Math.max(1, …)), so a 15-minute spike at a 5-minute cadence
      // was announced as an hour long — the same class of overstatement as the
      // padding above, and just as invisible to the caller.
      const label =
        spanMinutes < 60
          ? `${Math.max(1, Math.round(spanMinutes))}-minute`
          : `${Math.round((spanMinutes / 60) * 10) / 10}-hour`;
      return `VOC showed a ${label} spike around ${peakLabel} — check cleaning products / cooking activity`;
    }
    return undefined;
  }

  return undefined;
}

function analyzeOne(
  samples: TrendSample[],
  pollutant: TrendPollutant,
  hours: number,
): PerPollutantTrend {
  // PRECONDITION: `samples` is chronologically ordered (analyzeAirTrend sorts
  // once at entry). Every temporal field below reads array position as position
  // in time — `current`, `last_sample_at`, the quartile rate of change, the
  // peak/trough tie-break, and the VOC run detection.
  const { values, timestamps } = extractSeries(samples, pollutant);

  if (values.length === 0) {
    return {
      pollutant,
      unit: UNIT[pollutant],
      samples_analyzed: 0,
      time_above_threshold_minutes: 0,
      threshold: THRESHOLD[pollutant],
      coverage_ratio: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const minValue = sorted[0];
  const maxValue = sorted[sorted.length - 1];
  const minIdx = values.indexOf(minValue);
  const maxIdx = values.indexOf(maxValue);
  const meanValue = mean(values);
  const medianValue = median(sorted);
  const currentValue = values[values.length - 1];

  // Rate of change per hour:  (mean of last 25% - mean of first 25%) / hours
  let rateOfChangePerHour: number | undefined;
  let firstQMean: number | undefined;
  let lastQMean: number | undefined;
  if (values.length >= 4) {
    const qSize = Math.max(1, Math.floor(values.length / 4));
    firstQMean = mean(values.slice(0, qSize));
    lastQMean = mean(values.slice(-qSize));
    if (firstQMean !== undefined && lastQMean !== undefined && hours > 0) {
      rateOfChangePerHour = (lastQMean - firstQMean) / hours;
    }
  }

  const peakAt = timestamps[maxIdx];
  const troughAt = timestamps[minIdx];

  // Integrate over real sample spacing — timestamps were always available here,
  // they simply were not being passed down.
  const integration = integrateTimeAboveThreshold(
    values,
    timestamps,
    THRESHOLD[pollutant],
    hours,
  );

  const observation = generateObservation(
    pollutant,
    values,
    timestamps,
    firstQMean,
    lastQMean,
    maxValue,
    peakAt,
    hours,
  );

  return {
    pollutant,
    unit: UNIT[pollutant],
    samples_analyzed: values.length,
    mean: round(meanValue),
    median: round(medianValue),
    min: round(minValue),
    max: round(maxValue),
    current: round(currentValue),
    rate_of_change_per_hour: round(rateOfChangePerHour, 4),
    peak_at: peakAt,
    trough_at: troughAt,
    time_above_threshold_minutes: integration.minutesAbove,
    threshold: THRESHOLD[pollutant],
    coverage_ratio: integration.coverageRatio,
    last_sample_at: timestamps[timestamps.length - 1],
    observation,
  };
}

/**
 * Note emitted when a pollutant series covers too little of the window for
 * `time_above_threshold_minutes` to be read as a measurement — and for
 * `current` to be read as "now".
 */
function lowCoverageNote(t: PerPollutantTrend, hours: number): string | undefined {
  if (t.samples_analyzed === 0 || t.coverage_ratio >= LOW_COVERAGE_RATIO) return undefined;
  const pct = Math.round(t.coverage_ratio * 100);
  const lastPart = t.last_sample_at ? ` Last sample: ${t.last_sample_at}.` : "";
  return (
    `${t.pollutant}: samples cover only ~${pct}% of the ${hours}h window ` +
    `(${t.samples_analyzed} samples). time_above_threshold_minutes is a floor, ` +
    `not a full-window measurement, and "current" may be stale.${lastPart}`
  );
}

/**
 * Pure analysis function — no IO. Use this in tests with synthetic samples.
 *
 * Accepts samples in ANY order: the series is sorted chronologically here, once,
 * and every temporal field is derived from the sorted series. The input array is
 * not mutated.
 */
export function analyzeAirTrend(
  samples: TrendSample[],
  hours: number,
  pollutant: TrendPollutantOrAll,
): AirTrendResult {
  const notes: string[] = [];
  if (samples.length === 0) {
    notes.push("No samples in window. Trend analysis skipped.");
  }

  // Sort ONCE, here. Provider order is not part of any contract, and every
  // temporal field downstream depends on it. See sortSamplesChronologically.
  const ordered = sortSamplesChronologically(samples);

  if (pollutant === "all") {
    const pollutants: PerPollutantTrend[] = (["pm25", "co2", "voc"] as TrendPollutant[]).map(
      (p) => analyzeOne(ordered, p, hours),
    );
    // Worst pollutant = highest current band rank. Skip pollutants with no current.
    let worst: TrendPollutant | undefined;
    let worstRank = -1;
    for (const t of pollutants) {
      if (t.current === undefined) continue;
      const r = currentBandRank(t.pollutant, t.current);
      if (r > worstRank) {
        worstRank = r;
        worst = t.pollutant;
      }
    }
    for (const t of pollutants) {
      const note = lowCoverageNote(t, hours);
      if (note) notes.push(note);
    }
    return {
      ok: true,
      hours,
      pollutant,
      pollutants,
      worst_pollutant: worst,
      notes,
    };
  }

  const trend = analyzeOne(ordered, pollutant, hours);
  const note = lowCoverageNote(trend, hours);
  if (note) notes.push(note);
  return {
    ok: true,
    hours,
    pollutant,
    trend,
    notes,
  };
}

export interface BuildAirTrendInput {
  hours?: number;
  pollutant?: TrendPollutantOrAll;
  locationId?: string;
}

export interface BuildAirTrendError {
  ok: false;
  error: string;
  hint?: string;
  message?: string;
}

/** IO wrapper — fetches samples from AirGradient (public or owned) and runs analyzeAirTrend. */
export async function buildAirTrend(
  input: BuildAirTrendInput,
): Promise<AirTrendResult | BuildAirTrendError> {
  const hours = input.hours ?? 24;
  const pollutant: TrendPollutantOrAll = input.pollutant ?? "all";
  const loc =
    input.locationId ??
    process.env.WELLNESS_AIR_DEFAULT_LOCATION ??
    process.env.AIRGRADIENT_LOCATION_ID;

  if (!loc) {
    return {
      ok: false,
      error: "missing_location",
      hint: "Pass locationId or set WELLNESS_AIR_DEFAULT_LOCATION (AirGradient public location id).",
    };
  }

  const client = new AirGradientClient();
  let readings: AirReading[];
  try {
    readings = client.hasAuth()
      ? await client.getOwnedPast(loc, hours)
      : await client.getPublicPast(loc, hours);
  } catch (err) {
    return {
      ok: false,
      error: "airgradient_error",
      message: (err as Error).message,
    };
  }

  const samples = readings.map(readingToTrendSample);
  return analyzeAirTrend(samples, hours, pollutant);
}

/** Render an AirTrendResult as compact Markdown for chat-friendly responses. */
export function formatAirTrendMarkdown(result: AirTrendResult): string {
  const lines: string[] = [];
  lines.push(`# Air trend — last ${result.hours}h`);
  lines.push("");

  const renderOne = (t: PerPollutantTrend): void => {
    lines.push(`## ${t.pollutant.toUpperCase()} (${t.unit})`);
    if (t.samples_analyzed === 0) {
      lines.push(`- No samples in window.`);
      lines.push("");
      return;
    }
    lines.push(`- Samples analyzed: ${t.samples_analyzed}`);
    if (t.current !== undefined) lines.push(`- Current: ${t.current}`);
    if (t.mean !== undefined) lines.push(`- Mean: ${t.mean}`);
    if (t.median !== undefined) lines.push(`- Median: ${t.median}`);
    if (t.min !== undefined && t.max !== undefined) lines.push(`- Range: ${t.min} – ${t.max}`);
    if (t.rate_of_change_per_hour !== undefined) {
      const arrow = t.rate_of_change_per_hour > 0 ? "↑" : t.rate_of_change_per_hour < 0 ? "↓" : "→";
      lines.push(`- Rate of change: ${arrow} ${t.rate_of_change_per_hour} ${t.unit}/h`);
    }
    if (t.peak_at) lines.push(`- Peak at: ${t.peak_at}`);
    if (t.trough_at) lines.push(`- Trough at: ${t.trough_at}`);
    lines.push(
      `- Time above ${t.threshold} ${t.unit}: ${t.time_above_threshold_minutes} min`,
    );
    lines.push(`- Window coverage: ${Math.round(t.coverage_ratio * 100)}%`);
    if (t.last_sample_at) lines.push(`- Last sample: ${t.last_sample_at}`);
    if (t.observation) {
      lines.push("");
      lines.push(`> ${t.observation}`);
    }
    lines.push("");
  };

  if (result.pollutant === "all" && result.pollutants) {
    for (const t of result.pollutants) renderOne(t);
    if (result.worst_pollutant) {
      lines.push(`**Worst pollutant:** \`${result.worst_pollutant}\``);
    }
  } else if (result.trend) {
    renderOne(result.trend);
  }

  // Notes carry the coverage caveats — they must not be json-only.
  if (result.notes.length > 0) {
    lines.push("");
    lines.push("## Notes");
    for (const n of result.notes) lines.push(`- ${n}`);
  }

  return lines.join("\n");
}
