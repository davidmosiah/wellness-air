#!/usr/bin/env node
/* eslint-disable no-console */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const server = JSON.parse(readFileSync("server.json", "utf8"));

const errors = [];
if (server.version !== pkg.version) {
  errors.push(`server.json version ${server.version} does not match package.json ${pkg.version}`);
}
const npmPkg = server.packages?.[0];
if (!npmPkg) errors.push("server.json missing packages[0]");
else {
  if (npmPkg.identifier !== pkg.name) {
    errors.push(`server.json package identifier ${npmPkg.identifier} does not match ${pkg.name}`);
  }
  if (npmPkg.version !== pkg.version) {
    errors.push(`server.json package version ${npmPkg.version} does not match ${pkg.version}`);
  }
}

// The runtime version lives in a third place (src/constants.ts) and has drifted
// from package.json before. Check it here so a bump cannot land half-applied.
const constants = readFileSync("src/constants.ts", "utf8");
const serverVersionMatch = constants.match(/SERVER_VERSION\s*=\s*"([^"]+)"/);
if (!serverVersionMatch) {
  errors.push("src/constants.ts does not export a parseable SERVER_VERSION");
} else if (serverVersionMatch[1] !== pkg.version) {
  errors.push(
    `src/constants.ts SERVER_VERSION ${serverVersionMatch[1]} does not match package.json ${pkg.version}`,
  );
}

if (errors.length > 0) {
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, package: pkg.name, version: pkg.version }, null, 2));
