/**
 * WHO 2021 / EPA / ASHRAE health-band classifier for indoor + outdoor air-quality
 * pollutants. Pure functions, no IO. Bands cite their published source so the
 * agent can defend its advice to the user.
 *
 * Sources:
 *   - PM2.5, PM10:  WHO Global Air Quality Guidelines 2021 (24-hour mean).
 *                   https://www.who.int/publications/i/item/9789240034228
 *   - CO2:          ASHRAE 62.1-2019 ventilation guidance + Persily 2015
 *                   (cognition / drowsiness onset thresholds reported in
 *                   indoor-air research literature; not regulatory limits).
 *   - VOC (tVOC):   German Federal Environment Agency (UBA) indoor air guide
 *                   values (Umweltbundesamt, 2007) — five-band classification
 *                   widely used by consumer indoor-air monitors (Awair,
 *                   AirGradient, Airthings).
 */

export type HealthBandPollutant = "pm25" | "pm10" | "co2" | "voc";

export interface HealthBand {
  label: string;
  /** Range applies when value is in [min, max) (max=Infinity means "and above"). */
  min: number;
  max: number;
  /** What the band means in plain language. */
  description: string;
  /** Suggested action(s) for the user/agent. */
  recommended_actions: string[];
  /** Source attribution for the band threshold. */
  source: string;
}

export interface HealthBandResult extends HealthBand {
  pollutant: HealthBandPollutant;
  value: number;
  unit: string;
}

/** Severity rank — higher means worse. Used to compute the worst signal across pollutants. */
const BAND_RANK: Record<string, number> = {
  good: 0,
  acceptable: 1,
  moderate: 2,
  drowsy: 3,
  sensitive_groups: 3,
  headache_risk: 4,
  unhealthy: 4,
  very_unhealthy: 5,
  action_needed: 6,
  hazardous: 6,
};

/** PM2.5 bands per WHO 2021 24-hour air-quality guideline (µg/m³). */
export const PM25_BANDS: ReadonlyArray<HealthBand> = [
  { label: "good", min: 0, max: 5,
    description: "Within WHO 2021 annual air-quality guideline.",
    recommended_actions: ["No action required."],
    source: "WHO Global Air Quality Guidelines 2021 (annual mean = 5 µg/m³)" },
  { label: "moderate", min: 5, max: 10,
    description: "Above the WHO annual guideline but acceptable for short-term exposure.",
    recommended_actions: ["No urgent action; long-term exposure at this level has known cardiovascular effects."],
    source: "WHO Global Air Quality Guidelines 2021 (annual mean concern band)" },
  { label: "sensitive_groups", min: 10, max: 15,
    description: "Above the WHO 24-hour guideline. People with asthma, COPD, heart disease may notice symptoms.",
    recommended_actions: ["Sensitive groups: limit prolonged outdoor exertion.", "Consider HEPA filtration indoors."],
    source: "WHO Global Air Quality Guidelines 2021 (24-hour guideline = 15 µg/m³)" },
  { label: "unhealthy", min: 15, max: 25,
    description: "Air quality unhealthy. Sustained exposure affects everyone, not just sensitive groups.",
    recommended_actions: ["Close windows.", "Run HEPA air purifier on high.", "Wear an N95 if going outdoors for more than brief errands."],
    source: "WHO 2021 interim target 4" },
  { label: "very_unhealthy", min: 25, max: 50,
    description: "Air quality very unhealthy. Short-term exposure can trigger asthma attacks and cardiac events in vulnerable people.",
    recommended_actions: ["Stay indoors with windows closed.", "Use HEPA filtration on highest setting.", "Avoid outdoor exercise entirely."],
    source: "WHO 2021 interim target 2-3" },
  { label: "hazardous", min: 50, max: Infinity,
    description: "Hazardous. Public-health emergency thresholds typically activated.",
    recommended_actions: ["Remain indoors with sealed windows.", "Use a portable HEPA + N95 indoors if smoke is infiltrating.", "Follow local public-health agency advisories."],
    source: "WHO 2021 / EPA AQI 'hazardous' category" },
];

/** PM10 bands per WHO 2021 24-hour air-quality guideline (µg/m³). */
export const PM10_BANDS: ReadonlyArray<HealthBand> = [
  { label: "good", min: 0, max: 15,
    description: "Within WHO 2021 annual air-quality guideline for PM10.",
    recommended_actions: ["No action required."],
    source: "WHO Global Air Quality Guidelines 2021 (annual mean = 15 µg/m³)" },
  { label: "moderate", min: 15, max: 30,
    description: "Above the WHO annual guideline. Acceptable for short-term exposure.",
    recommended_actions: ["No urgent action; reduce long-term exposure if possible."],
    source: "WHO 2021 PM10 moderate band" },
  { label: "sensitive_groups", min: 30, max: 45,
    description: "Above the WHO 24-hour guideline. Asthma, COPD, heart-disease patients may notice symptoms.",
    recommended_actions: ["Sensitive groups: limit prolonged outdoor exertion."],
    source: "WHO Global Air Quality Guidelines 2021 (24-hour guideline = 45 µg/m³)" },
  { label: "unhealthy", min: 45, max: 75,
    description: "Unhealthy. Coarse-particle exposure aggravates asthma and bronchitis.",
    recommended_actions: ["Close windows.", "Run HEPA filtration indoors."],
    source: "WHO 2021 PM10 interim target 4" },
  { label: "very_unhealthy", min: 75, max: 100,
    description: "Very unhealthy. Visibility may be reduced.",
    recommended_actions: ["Stay indoors. Use HEPA filtration. Avoid outdoor exercise."],
    source: "WHO 2021 PM10 interim target 2-3" },
  { label: "hazardous", min: 100, max: Infinity,
    description: "Hazardous PM10 levels.",
    recommended_actions: ["Remain indoors with sealed windows and HEPA filtration. Follow local public-health advisories."],
    source: "WHO 2021 / EPA AQI" },
];

/** CO2 bands (ppm) — ASHRAE / indoor-air research (Persily 2015, Allen et al. 2016). */
export const CO2_BANDS: ReadonlyArray<HealthBand> = [
  { label: "good", min: 0, max: 800,
    description: "Well within ASHRAE-recommended fresh-air standards.",
    recommended_actions: ["No action required."],
    source: "ASHRAE 62.1-2019 (outdoor baseline ~420 ppm + healthy occupancy)" },
  { label: "acceptable", min: 800, max: 1000,
    description: "Acceptable but at the upper bound of ASHRAE guidance for occupied spaces.",
    recommended_actions: ["No urgent action; monitor."],
    source: "ASHRAE 62.1-2019 default ventilation guidance" },
  { label: "drowsy", min: 1000, max: 1400,
    description: "Drowsiness and reduced cognitive performance observed in controlled studies.",
    recommended_actions: ["Open a window.", "Increase HVAC fresh-air intake.", "If at a desk, take a 5-min break in well-ventilated space."],
    source: "Satish 2012; Allen et al. 2016 (cognition decline at 1000-1400 ppm)" },
  { label: "headache_risk", min: 1400, max: 2000,
    description: "Headache, eye/throat irritation, and noticeable cognitive decline reported in this range.",
    recommended_actions: ["Open windows immediately.", "Reduce occupant density.", "Run mechanical ventilation if available."],
    source: "OSHA / NIOSH indoor-air guidance" },
  { label: "action_needed", min: 2000, max: Infinity,
    description: "Action needed. Sustained exposure at this level is unsuitable for sleep, work, or exercise.",
    recommended_actions: ["Open all windows and ventilate aggressively.", "Investigate ventilation failure (HVAC, sealed room, gas appliance).", "Leave the space if symptoms appear (headache, nausea)."],
    source: "OSHA short-term exposure limit precursor; ASHRAE comfort threshold" },
];

/** VOC (tVOC) bands per UBA (Umweltbundesamt) German indoor-air guide values, in ppb. */
export const VOC_BANDS: ReadonlyArray<HealthBand> = [
  { label: "good", min: 0, max: 220,
    description: "Hygienically harmless (UBA-1).",
    recommended_actions: ["No action required."],
    source: "UBA / Umweltbundesamt 2007 (TVOC indoor air guide value 1)" },
  { label: "acceptable", min: 220, max: 660,
    description: "No-objection indoor air (UBA-2). Acceptable for permanent occupancy.",
    recommended_actions: ["No urgent action."],
    source: "UBA / Umweltbundesamt 2007 (TVOC guide value 2)" },
  { label: "moderate", min: 660, max: 2200,
    description: "Hygienic concerns (UBA-3). Increase ventilation. Look for VOC sources (new furniture, cleaners, candles).",
    recommended_actions: ["Open windows.", "Identify and remove VOC source if possible."],
    source: "UBA / Umweltbundesamt 2007 (TVOC guide value 3)" },
  { label: "unhealthy", min: 2200, max: 5500,
    description: "Major hygienic concern (UBA-4). Not suitable for permanent occupancy.",
    recommended_actions: ["Ventilate aggressively.", "Locate and remove the dominant VOC source.", "Limit occupancy to <8h/day until levels drop."],
    source: "UBA / Umweltbundesamt 2007 (TVOC guide value 4)" },
  { label: "hazardous", min: 5500, max: Infinity,
    description: "Unacceptable (UBA-5). Stay-away level.",
    recommended_actions: ["Vacate the space until source is removed and air is replaced."],
    source: "UBA / Umweltbundesamt 2007 (TVOC guide value 5)" },
];

const POLLUTANT_BANDS: Record<HealthBandPollutant, ReadonlyArray<HealthBand>> = {
  pm25: PM25_BANDS,
  pm10: PM10_BANDS,
  co2: CO2_BANDS,
  voc: VOC_BANDS,
};

const POLLUTANT_UNIT: Record<HealthBandPollutant, string> = {
  pm25: "µg/m³",
  pm10: "µg/m³",
  co2: "ppm",
  voc: "ppb",
};

/** Classify a single pollutant value into a band. Returns undefined if value is non-finite. */
export function classifyPollutant(pollutant: HealthBandPollutant, value: number): HealthBandResult | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const bands = POLLUTANT_BANDS[pollutant];
  for (const band of bands) {
    if (value >= band.min && value < band.max) {
      return { ...band, pollutant, value, unit: POLLUTANT_UNIT[pollutant] };
    }
  }
  // Should never reach (last band is open-ended), but fall back to highest band.
  const last = bands[bands.length - 1];
  return last ? { ...last, pollutant, value, unit: POLLUTANT_UNIT[pollutant] } : undefined;
}

export interface HealthBandsReadings {
  pm25?: number;
  pm10?: number;
  co2?: number;
  voc?: number;
}

export interface HealthBandsClassification {
  /** Per-pollutant classification. Pollutants with no reading are absent. */
  pollutants: Partial<Record<HealthBandPollutant, HealthBandResult>>;
  /** The single worst pollutant + band across the inputs. */
  worst_signal?: HealthBandResult;
  /** Deduplicated, prioritized list of recommended actions across all pollutants. */
  recommended_actions: string[];
  /** Source citations across all classified pollutants (deduplicated). */
  sources: string[];
}

/** Run all available readings through their respective band classifiers + aggregate. */
export function classifyHealthBands(readings: HealthBandsReadings): HealthBandsClassification {
  const pollutants: Partial<Record<HealthBandPollutant, HealthBandResult>> = {};
  const orderedPollutants: HealthBandPollutant[] = ["pm25", "pm10", "co2", "voc"];
  for (const p of orderedPollutants) {
    const value = readings[p];
    if (value === undefined) continue;
    const result = classifyPollutant(p, value);
    if (result) pollutants[p] = result;
  }

  // worst_signal = pollutant whose band rank is highest.
  let worst: HealthBandResult | undefined;
  for (const result of Object.values(pollutants)) {
    if (!result) continue;
    const rank = BAND_RANK[result.label] ?? 0;
    const worstRank = worst ? (BAND_RANK[worst.label] ?? 0) : -1;
    if (rank > worstRank) worst = result;
  }

  // Dedupe actions while preserving order; worst signal first, then the rest.
  const actions: string[] = [];
  const seen = new Set<string>();
  const pushActions = (arr: ReadonlyArray<string>): void => {
    for (const a of arr) {
      if (!seen.has(a)) {
        seen.add(a);
        actions.push(a);
      }
    }
  };
  if (worst) pushActions(worst.recommended_actions);
  for (const result of Object.values(pollutants)) {
    if (!result || result === worst) continue;
    pushActions(result.recommended_actions);
  }

  // Dedupe sources.
  const sources: string[] = [];
  const sourceSeen = new Set<string>();
  for (const result of Object.values(pollutants)) {
    if (!result) continue;
    if (!sourceSeen.has(result.source)) {
      sourceSeen.add(result.source);
      sources.push(result.source);
    }
  }

  return { pollutants, worst_signal: worst, recommended_actions: actions, sources };
}
