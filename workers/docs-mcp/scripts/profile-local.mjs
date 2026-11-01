import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

// Fixed local CPU sample set, two requests per fresh isolate; no load/account test.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../.wrangler/profile-cases/', import.meta.url);
mkdirSync(output, { recursive: true });
process.env.XDG_CONFIG_HOME = fileURLToPath(new URL('../.wrangler/local-config/', import.meta.url));
process.env.WRANGLER_SEND_METRICS = 'false';
execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'check', 'startup', '--outfile', fileURLToPath(new URL('startup.cpuprofile', output))], { cwd: root, stdio: 'inherit', env: process.env });
const bundle = readFileSync(new URL('../dist/worker.js', import.meta.url));
const index = JSON.parse(readFileSync(new URL('../generated/index.json', import.meta.url), 'utf8'));
const largestMethod = Object.values(index.methods).reduce((best, value) => value.documentation.length > best.documentation.length ? value : best);
const largestType = Object.values(index.classes).reduce((best, value) => value.properties.length > best.properties.length ? value : best);
const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'local-profile', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
const call = (name, method, params, legacy = false) => ({ name, request: { signal: undefined, method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': legacy ? '2025-11-25' : '2026-07-28', ...(!legacy ? { 'mcp-method': method } : {}), ...(method === 'tools/call' ? { 'mcp-name': params.name } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: legacy ? params : { ...params, _meta: meta } }) } });
const tool = (label, name, args) => call(label, 'tools/call', { name, arguments: args });
const cases = [
  call('initialize', 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-profile', version: '1' } }, true),
  call('discover', 'server/discover', {}),
  call('tools-list', 'tools/list', {}),
  tool('search-broad-max-page', 'search_api', { query: 'er', kind: 'all', limit: 20, offset: 0 }),
  tool('search-max-length-miss', 'search_api', { query: 'z'.repeat(100), kind: 'all', limit: 20, offset: 0 }),
  tool('search-max-offset', 'search_api', { query: 'er', kind: 'all', limit: 20, offset: 10000 }),
  tool('get-method-longest-doc', 'get_method', { name: largestMethod.name }),
  tool('get-class-max-page', 'get_class', { name: largestType.name, members: 'properties', limit: 20 }),
  tool('get-doc-max-chunk', 'get_doc', { path: 'guide/basics.rst', chunk: 0 }),
];
function summarize(profile) {
  const names = new Map(profile.nodes.map(node => [node.id, node.callFrame.functionName]));
  let sampled = 0, idle = 0, gc = 0;
  for (const [i, us] of (profile.timeDeltas ?? []).entries()) {
    sampled += us;
    const name = names.get(profile.samples?.[i]);
    if (name === '(idle)') idle += us;
    if (name === '(garbage collector)') gc += us;
  }
  return { profileWindowMs: (profile.endTime - profile.startTime) / 1000, sampledMs: sampled / 1000, sampledActiveMs: (sampled - idle) / 1000, idleMs: idle / 1000, gcMs: gc / 1000, samples: profile.samples?.length ?? 0 };
}
const { unstable_dev } = await import('wrangler');
async function profileCase(entry) {
  const reserve = createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const inspectorPort = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const worker = await unstable_dev(fileURLToPath(new URL('../dist/worker.js', import.meta.url)), { config: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)), bundle: false, local: true, envFiles: [], ip: '127.0.0.1', port: 0, inspectorPort, persist: false, logLevel: 'error', experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false, liveReload: false, enableContainers: false } });
  let socket;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    assert.equal(targets.length, 1, 'Expected only this isolated Worker target');
    const wsUrl = new URL(targets[0].webSocketDebuggerUrl);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(wsUrl.hostname));
    socket = new WebSocket(wsUrl, { origin: 'http://localhost', handshakeTimeout: 5000 });
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', event => reject(event.error ?? new Error(event.message)), { once: true }); });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Inspector timeout: ${method}`)); }, 5000);
      pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    await command('Profiler.enable');
    await command('Profiler.setSamplingInterval', { interval: 250 });
    const measure = async label => {
      await command('Profiler.start');
      const response = await worker.fetch('/mcp', { ...entry.request, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      const text = await response.text();
      const body = text.startsWith('event:') ? JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(6)) : JSON.parse(text);
      assert.ok(body.result && !body.error && !body.result.isError, 'Profiled operation must succeed');
      const { profile } = await command('Profiler.stop');
      writeFileSync(new URL(`${entry.name}-${label}.cpuprofile`, output), JSON.stringify(profile));
      return { ...summarize(profile), responseBytes: Buffer.byteLength(text) };
    };
    return { name: entry.name, request: JSON.parse(entry.request.body), cold: await measure('cold'), warm: await measure('warm') };
  } finally { socket?.close(); await worker.stop(); }
}
const summary = { scope: 'Local workerd sampled CPU including profiling/request overhead; not production CPU accounting. One cold and warm request per fresh case isolate; nine cases, eighteen requests, sequential only. No load/account test.', bundleSha256: createHash('sha256').update(bundle).digest('hex'), bundleBytes: bundle.length, startup: summarize(JSON.parse(readFileSync(new URL('startup.cpuprofile', output), 'utf8'))), cases: [] };
for (const entry of cases) {
  const result = await profileCase(entry);
  summary.cases.push(result);
  writeFileSync(new URL('summary.json', output), JSON.stringify(summary, null, 2) + '\n');
  console.log(`${entry.name}: cold active ${result.cold.sampledActiveMs} ms (${result.cold.gcMs} GC), warm active ${result.warm.sampledActiveMs} ms (${result.warm.gcMs} GC)`);
}
console.log(JSON.stringify(summary, null, 2));
