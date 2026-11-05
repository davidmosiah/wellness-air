// Optional credential forwarding is an explicit, narrow contract with Hermes.
// Do not replace ${NAME} with shell defaults: Hermes omits unresolved whole refs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('agent-plugin/mcp.json'));
const expectedKeys = ["AIRGRADIENT_API_TOKEN", "AIRTHINGS_CLIENT_ID", "AIRTHINGS_CLIENT_SECRET", "PURPLEAIR_API_KEY"];
assert.deepEqual(Object.keys(manifest.mcpServers), ["wellness-air"]);
const server = manifest.mcpServers["wellness-air"];
assert.deepEqual(Object.keys(server.env).sort(), [...expectedKeys].sort(),
  'Forward only supported provider credentials; no unrelated secrets');
for (const key of expectedKeys) {
  assert.equal(server.env[key], '${' + key + '}',
    key + ' must remain an optional whole-variable reference');
}
assert.equal(server.type, 'stdio');
assert.equal(server.command, 'npx');
assert.deepEqual(server.args, ['-y', "wellness-air@0.7.3"]);
assert.equal(server.cwd, '${PLUGIN_DATA}');
console.log('Agent plugin optional credential and launch contracts passed');
