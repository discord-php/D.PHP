import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import lock from '../source-lock.json' with { type: 'json' };

// Local runtime only. No account configuration, environment files or remote bindings.
process.env.XDG_CONFIG_HOME = fileURLToPath(new URL('../.wrangler/local-config/', import.meta.url));
process.env.WRANGLER_SEND_METRICS = 'false';
const { unstable_dev } = await import('wrangler');
const worker = await unstable_dev(fileURLToPath(new URL('../dist/worker.js', import.meta.url)), {
  config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
  bundle: false, local: true, envFiles: [], ip: '127.0.0.1', port: 0,
  persist: false, logLevel: 'error',
  experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false, liveReload: false, enableContainers: false },
});
try {
  const health = await worker.fetch('/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).revision, lock.revision);
  const notice = await worker.fetch('/license');
  assert.equal(notice.status, 200);
  assert.equal(await notice.text(), readFileSync(new URL('../generated/DiscordPHP-LICENSE.md', import.meta.url), 'utf8'));
  const rpc = async (method, params, modern = false) => {
    const response = await worker.fetch('/mcp', {
      method: 'POST', headers: {
        'content-type': 'application/json', accept: 'application/json, text/event-stream',
        'mcp-protocol-version': modern ? '2026-07-28' : '2025-11-25',
        ...(modern ? { 'mcp-method': method, 'mcp-name': 'get_method' } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    return text.startsWith('event:') ? JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(6)) : JSON.parse(text);
  };
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-workerd-smoke', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'dphp-docs-mcp');
  assert.equal((await rpc('tools/list', {})).result.tools.length, 4);
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'local-workerd-smoke', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
  const call = await rpc('tools/call', { _meta: meta, name: 'get_method', arguments: { name: 'Discord\\Builders\\MessageBuilder::setContent' } }, true);
  assert.match(JSON.parse(call.result.content[0].text).data.signature, /setContent/);
  const denied = await worker.fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert.equal(denied.status, 403);
  console.log('Local workerd smoke passed: health, full bundled MIT notice, legacy initialization/discovery, modern method lookup, Origin rejection.');
} finally {
  await worker.stop();
}
