import { NPM_PACKAGE_NAME, SERVER_VERSION, SUPPORTED_PROVIDERS } from "../constants.js";
import { AirGradientClient, aqiBand } from "../services/airgradient-client.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildPrivacyAudit } from "../services/privacy-audit.js";
import {
  getOnboardingFlow,
  getProfile,
  getProfilePath,
  missingCriticalFields,
} from "../services/profile-store.js";

const COMMANDS = new Set(["status", "doctor", "setup", "current", "onboarding"]);

function printCommunityCTA(): void {
  if (process.env.WELLNESS_AIR_QUIET === "1") return;
  if (!process.stderr.isTTY) return;
  process.stderr.write(
    `\n✨ wellness-air v${SERVER_VERSION} — if this helps your agent, a star ⭐ keeps the project visible to other AI builders.\n` +
      `   ⭐  https://github.com/davidmosiah/wellness-air\n` +
      `   💬  https://github.com/davidmosiah/wellness-air/issues\n` +
      `   🐦  https://x.com/delx369\n` +
      `   (silence with WELLNESS_AIR_QUIET=1)\n\n`,
  );
}

export function isCliCommand(args: string[]): boolean {
  const command = args[0];
  return command !== undefined && COMMANDS.has(command);
}

export async function runCliCommand(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case "status":
        return printStatus();
      case "doctor":
        return await doctor();
      case "setup":
        return setup(rest);
      case "current":
        return await current(rest);
      case "onboarding":
        return await onboarding(rest);
      default:
        return -1;
    }
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}

function printStatus(): number {
  const caps = buildCapabilities();
  console.log(
    JSON.stringify(
      {
        name: NPM_PACKAGE_NAME,
        version: SERVER_VERSION,
        configured_providers: caps.configured,
        supported_providers: SUPPORTED_PROVIDERS,
        default_provider: process.env.WELLNESS_AIR_DEFAULT_PROVIDER ?? "airgradient",
        default_location:
          process.env.WELLNESS_AIR_DEFAULT_LOCATION ?? process.env.AIRGRADIENT_LOCATION_ID ?? null,
      },
      null,
      2,
    ),
  );
  printCommunityCTA();
  return 0;
}

async function doctor(): Promise<number> {
  const caps = buildCapabilities();
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [
    { name: "node", ok: true, detail: process.version },
    { name: "providers_supported", ok: true, detail: SUPPORTED_PROVIDERS.join(", ") },
    {
      name: "providers_configured",
      ok: true,
      detail: caps.configured.length === 0 ? "none (public AirGradient still works)" : caps.configured.join(", "),
    },
  ];
  const recommendations: string[] = [];
  const loc = process.env.WELLNESS_AIR_DEFAULT_LOCATION ?? process.env.AIRGRADIENT_LOCATION_ID;
  if (loc) {
    try {
      const client = new AirGradientClient();
      const reading = client.hasAuth() ? await client.getOwnedCurrent(loc) : await client.getPublicCurrent(loc);
      checks.push({
        name: "airgradient_reach",
        ok: Boolean(reading),
        detail: reading
          ? `aqi=${reading.aqi ?? "?"} band=${reading.aqi !== undefined ? aqiBand(reading.aqi) : "?"} pm25=${reading.pm25 ?? "?"}`
          : "no reading",
      });
      if (!reading) {
        recommendations.push(
          `Sensor '${loc}' returned no reading. Check the location id is correct at https://www.airgradient.com/map/ — copy from the URL.`,
        );
      }
    } catch (err) {
      checks.push({ name: "airgradient_reach", ok: false, detail: (err as Error).message });
      recommendations.push(`AirGradient API call failed: ${(err as Error).message}`);
    }
  } else {
    checks.push({
      name: "airgradient_reach",
      ok: false,
      detail: "no location configured",
    });
    recommendations.push(
      "Open https://www.airgradient.com/map/, click any public sensor near you, and copy the locationId from the URL.",
      "Set WELLNESS_AIR_DEFAULT_LOCATION=<that_id> in your env or MCP client config.",
      "Re-run `wellness-air doctor` to verify connectivity.",
    );
  }
  const ok = checks.every((c) => c.ok);
  console.log(
    JSON.stringify(
      {
        ok,
        package: NPM_PACKAGE_NAME,
        version: SERVER_VERSION,
        privacy: buildPrivacyAudit(),
        checks,
        recommendations,
      },
      null,
      2,
    ),
  );
  printCommunityCTA();
  return ok ? 0 : 1;
}

function setup(args: string[]): number {
  const optional = (args[0] ?? "generic").toLowerCase();
  const config = {
    mcpServers: {
      "wellness-air": {
        command: "npx",
        args: ["-y", NPM_PACKAGE_NAME],
        env: {
          WELLNESS_AIR_DEFAULT_PROVIDER: "airgradient",
          WELLNESS_AIR_DEFAULT_LOCATION: "${WELLNESS_AIR_DEFAULT_LOCATION}",
          AIRGRADIENT_API_TOKEN: "${AIRGRADIENT_API_TOKEN:-}",
          AIRGRADIENT_LOCATION_ID: "${AIRGRADIENT_LOCATION_ID:-}",
        },
      },
    },
  };
  console.log(
    JSON.stringify(
      {
        client: optional,
        config,
        next_steps: [
          "Pick an AirGradient public sensor near you at https://www.airgradient.com/map/",
          "Set WELLNESS_AIR_DEFAULT_LOCATION to that location id (or AIRGRADIENT_LOCATION_ID for owned sensors).",
          "Run wellness-air doctor to verify the agent can reach the sensor.",
        ],
      },
      null,
      2,
    ),
  );
  printCommunityCTA();
  return 0;
}

async function onboarding(args: string[]): Promise<number> {
  const locale = args[0] === "pt-BR" ? "pt-BR" : "en";
  const flow = getOnboardingFlow(locale);
  const profile = await getProfile();
  const missing = missingCriticalFields(profile);
  console.log(
    JSON.stringify(
      {
        ...flow,
        current_profile: profile,
        missing_critical: missing,
      },
      null,
      2,
    ),
  );
  if (process.stderr.isTTY && process.env.WELLNESS_AIR_QUIET !== "1") {
    process.stderr.write(
      `\n## Delx Wellness shared onboarding (${locale})\n` +
        `\nThe agent will ask these 11 questions next so wellness-air (and the rest of the\n` +
        `wellness stack) can personalize responses — non-secret data only, stored at\n` +
        `${getProfilePath()}.\n\n` +
        flow.questions
          .map((q, i) => `${i + 1}. (${q.required ? "required" : "optional"}) ${q.prompt}`)
          .join("\n") +
        `\n\nPrivacy: ${flow.privacy_note}\n\n`,
    );
  }
  return 0;
}

async function current(args: string[]): Promise<number> {
  const loc = args[0] ?? process.env.WELLNESS_AIR_DEFAULT_LOCATION ?? process.env.AIRGRADIENT_LOCATION_ID;
  if (!loc) {
    console.error("usage: wellness-air current <locationId>");
    return 1;
  }
  const client = new AirGradientClient();
  const reading = client.hasAuth() ? await client.getOwnedCurrent(loc) : await client.getPublicCurrent(loc);
  if (!reading) {
    console.error(`no reading for location '${loc}'`);
    return 1;
  }
  console.log(
    JSON.stringify(
      {
        locationId: loc,
        aqi: reading.aqi,
        band: reading.aqi !== undefined ? aqiBand(reading.aqi) : undefined,
        reading,
      },
      null,
      2,
    ),
  );
  return 0;
}
