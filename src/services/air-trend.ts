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

/**
 * Estimate "time above threshold" by treating each sample as the centerpoint
 * of an evenly-spaced bucket within the window.
 *
 * This is a coarse estimator — for AirGradient public sensors that emit ~1
 * sample / few minutes it converges. With one or two samples, returns 0.
 */
function timeAboveThresholdMinutes(values: number[], threshold: number, hours: number): number {
  if (values.length < 2) return 0;
  const above = values.filter((v) => v > threshold).length;
  const totalMinutes = hours * 60;
  const minutesPerSample = totalMinutes / values.length;
  return Math.round(above * minutesPerSample);
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
 *  - VOC: any contiguous 3+ samples in the window where value > 300 → spike note with timestamp
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
      const totalMinutes = hours * 60;
      const minutesPerSample = totalMinutes / values.length;
      const spanMinutes = Math.round(bestRunLen * minutesPerSample);
      const spanHours = Math.max(1, Math.round((spanMinutes / 60) * 10) / 10);
      const peakIso = maxAt ?? timestamps[bestRunStart];
      const peakLabel = peakIso.slice(11, 16); // HH:MM
      return `VOC showed a ${spanHours}-hour spike around ${peakLabel} — check cleaning products / cooking activity`;
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
  const { values, timestamps } = extractSeries(samples, pollutant);

  if (values.length === 0) {
    return {
      pollutant,
      unit: UNIT[pollutant],
      samples_analyzed: 0,
      time_above_threshold_minutes: 0,
      threshold: THRESHOLD[pollutant],
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
    time_above_threshold_minutes: timeAboveThresholdMinutes(values, THRESHOLD[pollutant], hours),
    threshold: THRESHOLD[pollutant],
    observation,
  };
}

/** Pure analysis function — no IO. Use this in tests with synthetic samples. */
export function analyzeAirTrend(
  samples: TrendSample[],
  hours: number,
  pollutant: TrendPollutantOrAll,
): AirTrendResult {
  const notes: string[] = [];
  if (samples.length === 0) {
    notes.push("No samples in window. Trend analysis skipped.");
  }

  if (pollutant === "all") {
    const pollutants: PerPollutantTrend[] = (["pm25", "co2", "voc"] as TrendPollutant[]).map(
      (p) => analyzeOne(samples, p, hours),
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
    return {
      ok: true,
      hours,
      pollutant,
      pollutants,
      worst_pollutant: worst,
      notes,
    };
  }

  const trend = analyzeOne(samples, pollutant, hours);
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

  return lines.join("\n");
}
