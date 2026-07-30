/**
 * Shared zod input schemas for wellness-air MCP tools.
 *
 * Tools register schemas inline as object-of-zod-fields (per @modelcontextprotocol/sdk),
 * so these constants export those raw shapes (not z.object(...)) for direct spread or reuse.
 */
import { z } from "zod";

/** Per-call privacy override accepted on read tools (scorecard + agent surface). */
export const PrivacyModeSchema = z
  .enum(["summary", "structured", "raw"])
  .optional()
  .describe(
    "Optional privacy mode: summary | structured | raw. summary omits location identifiers and device serials when present; structured/raw return full payload.",
  );

/** Input schema for `air_trend` — windowed trend analysis. */
export const AirTrendInputSchema = {
  hours: z
    .number()
    .min(1)
    .max(168)
    .optional()
    .describe("Analysis window in hours (1-168, default 24)."),
  pollutant: z
    .enum(["pm25", "co2", "voc", "all"])
    .optional()
    .describe("Pollutant to analyze. Default 'all'."),
  response_format: z
    .enum(["json", "markdown"])
    .optional()
    .describe("Output shape. Defaults to json."),
  locationId: z
    .string()
    .optional()
    .describe("AirGradient locationId. Falls back to WELLNESS_AIR_DEFAULT_LOCATION."),
  privacy_mode: PrivacyModeSchema,
} as const;

export type AirTrendPollutant = "pm25" | "co2" | "voc" | "all";
