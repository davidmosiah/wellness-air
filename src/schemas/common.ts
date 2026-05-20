/**
 * Shared zod input schemas for wellness-air MCP tools.
 *
 * Tools register schemas inline as object-of-zod-fields (per @modelcontextprotocol/sdk),
 * so these constants export those raw shapes (not z.object(...)) for direct spread or reuse.
 */
import { z } from "zod";

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
} as const;

export type AirTrendPollutant = "pm25" | "co2" | "voc" | "all";
