import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import upstreamLicense from '../generated/DiscordPHP-LICENSE.json' with { type: 'json' };

const endpoint = 'https://dphp-docs-mcp.example.workers.dev/mcp';
const MAX_REQUEST_BYTES = 16 * 1024;
let id = 0;
const request = (body, headers = {}) => new Request(endpoint, {
  method: 'POST', headers: { host: new URL(endpoint).host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
async function rpc(method, params = {}, headers = {}) {
  const response = await worker.fetch(request({ jsonrpc: '2.0', id: ++id, method, params }, headers), {}, {});
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) < 64 * 1024);
  const message = text.startsWith('event:') ? JSON.parse(text.split('\n').find(line => line.startsWith('data:')).slice(6)) : JSON.parse(text);
  return { response, message };
}
const call = (name, args) => rpc('tools/call', { name, arguments: args });
const payload = message => JSON.parse(message.result.content[0].text);

test('MCP initialize, tool discovery and stateless tool calls interoperate', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'offline-test', version: '1' } });
  assert.equal(init.response.status, 200);
  assert.equal(init.message.result.serverInfo.name, 'dphp-docs-mcp');
  assert.match(init.message.result.instructions, /Untrusted/);
  assert.equal(init.response.headers.get('mcp-session-id'), null);
  const { message } = await rpc('tools/list');
  assert.deepEqual(message.result.tools.map(tool => tool.name).sort(), ['get_class', 'get_doc', 'get_method', 'search_api']);
  for (const tool of message.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  // No session is shared with initialize, or needed on another isolate.
  const method = await call('get_method', { name: '\\Discord\\Builders\\MessageBuilder::setContent()' });
  const data = payload(method.message);
  assert.match(data.data.signature, /setContent\(string \$content\): self/);
  assert.match(data.data.documentation, /Maximum 2000 characters/);
  assert.ok(data.data.sourceUrl.includes(data.provenance.revision));
  assert.match(data.trustBoundary, /not instructions/);
});

test('bounded search and class/property pagination with explicit declared-member scope', async () => {
  const search = payload((await call('search_api', { query: 'Message', limit: 2 })).message).data;
  assert.equal(search.results.length, 2);
  assert.ok(search.total > 2);
  assert.equal(search.nextOffset, 2);
  const page2 = payload((await call('search_api', { query: 'Message', limit: 2, offset: 2 })).message).data;
  assert.notDeepEqual(page2.results, search.results);
  const cls = payload((await call('get_class', { name: 'discord\\builders\\messagebuilder', limit: 1 })).message).data;
  assert.deepEqual(cls.traits, ['Discord\\Builders\\ComponentsTrait']);
  assert.equal(cls.results.length, 1);
  assert.equal(cls.nextOffset, 1);
  assert.match(cls.memberScope, /Declared/);
  const properties = payload((await call('get_class', { name: 'Discord\\Parts\\User\\User', members: 'properties' })).message).data;
  assert.ok(properties.results.some(value => /\$id\b/.test(value)));
});

test('modern MCP discovery and calls work without sessions; envelope mismatches are rejected', async () => {
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'modern-test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} };
  const headers = method => ({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': method });
  const discovery = await rpc('server/discover', { _meta: meta }, headers('server/discover'));
  assert.equal(discovery.response.status, 200);
  assert.ok(discovery.message.result.supportedVersions.includes('2026-07-28'));
  assert.equal(discovery.message.result.capabilities.tools.listChanged, false);
  const list = await rpc('tools/list', { _meta: meta }, headers('tools/list'));
  assert.equal(list.message.result.tools.length, 4);
  const method = await rpc('tools/call', { _meta: meta, name: 'get_method', arguments: { name: 'Discord\\Builders\\MessageBuilder::setContent' } }, { ...headers('tools/call'), 'mcp-name': 'get_method' });
  assert.equal(method.response.status, 200);
  assert.match(payload(method.message).data.signature, /setContent/);
  assert.equal((await rpc('tools/list', { _meta: meta }, headers('tools/call'))).response.status, 400);
  assert.equal((await rpc('tools/list', { _meta: meta }, { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' })).response.status, 400);
  assert.equal((await rpc('subscriptions/listen', { _meta: meta }, headers('subscriptions/listen'))).message.error.code, -32601);
});

test('guide chunks stay bounded, carry citations and report out-of-range/missing names', async () => {
  const doc = payload((await call('get_doc', { path: 'guide/basics.rst' })).message).data;
  assert.ok(Buffer.byteLength(doc.text) <= 4000);
  assert.ok(doc.sourceUrl.includes('/blob/'));
  assert.equal((await call('get_doc', { path: 'guide/basics.rst', chunk: 10000 })).message.result.isError, true);
  for (const [name, args] of [['get_class', { name: 'Missing' }], ['get_method', { name: 'Missing::test' }], ['get_doc', { path: 'guide/missing.rst' }]]) {
    assert.equal((await call(name, args)).message.result.isError, true);
  }
  assert.equal(payload((await call('search_api', { query: 'no-such-symbol-12345' })).message).data.total, 0);
});

test('tool schema rejects bounds, control characters, extra arguments and arbitrary paths/URLs', async () => {
  const invalid = [
    ['search_api', { query: '' }], ['search_api', { query: 'a' }], ['search_api', { query: 'x'.repeat(101) }],
    ['search_api', { query: 'ab\u0000' }], ['search_api', { query: 'ab', limit: 21 }],
    ['search_api', { query: 'ab', offset: -1 }], ['search_api', { query: 'ab', offset: 1.5 }],
    ['search_api', { query: 'ab', offset: 10001 }], ['search_api', { query: 'ab', kind: 'anything' }],
    ['get_class', { name: '__proto__', url: 'https://example.com' }],
    ['get_method', { name: 'Discord\\Discord' }],
    ['get_doc', { path: '../../.env' }], ['get_doc', { path: 'https://example.com' }],
    ['get_doc', { path: 'guide/../../.env.rst' }], ['get_doc', { path: 'README.md', chunk: -1 }],
  ];
  for (const [name, args] of invalid) {
    const { message } = await call(name, args);
    assert.ok(message.error || message.result?.isError, `${name}: ${JSON.stringify(args)}`);
  }
  assert.equal((await call('send_message', { channel: '123', content: 'no' })).message.error.code, -32602);
});

test('HTTP enforces streamed/declared body limits, encoding, Origin and route/method bounds', async () => {
  for (const body of ['{bad json', JSON.stringify([{ jsonrpc: '2.0', method: 'tools/list', id: 1 }])]) {
    assert.equal((await worker.fetch(request(body), {}, {})).status, 400);
  }
  assert.equal((await worker.fetch(request(' '.repeat(MAX_REQUEST_BYTES + 1)), {}, {})).status, 413);
  assert.equal((await worker.fetch(request('{}', { 'content-length': String(MAX_REQUEST_BYTES + 1) }), {}, {})).status, 413);
  assert.equal((await worker.fetch(request('{}', { 'content-type': 'text/plain' }), {}, {})).status, 415);
  assert.equal((await worker.fetch(request('{}', { 'content-encoding': 'gzip' }), {}, {})).status, 415);
  for (const origin of ['https://evil.example', 'null', 'file://local', 'https://dphp-docs-mcp.example.workers.dev:4430']) {
    assert.equal((await worker.fetch(request('{}', { origin }), {}, {})).status, 403);
  }
  const sameOrigin = await rpc('tools/list', {}, { origin: new URL(endpoint).origin });
  assert.equal(sameOrigin.response.status, 200);
  assert.equal(sameOrigin.response.headers.get('access-control-allow-origin'), null);
  const wrongHost = await rpc('tools/list', {}, { host: 'attacker.example' });
  assert.equal(wrongHost.response.status, 403);
  assert.equal((await worker.fetch(new Request(endpoint), {}, {})).status, 405);
  assert.equal((await worker.fetch(new Request(endpoint.replace('/mcp', '/missing')), {}, {})).status, 404);
  assert.equal((await worker.fetch(new Request(endpoint.replace('/mcp', '/health')), {}, {})).status, 200);
  const license = await worker.fetch(new Request(endpoint.replace('/mcp', '/license')), {}, {});
  assert.equal(license.status, 200);
  assert.match(license.headers.get('content-type'), /^text\/plain/);
  assert.equal(await license.text(), upstreamLicense);
});

test('invalid JSON-RPC, unknown methods and notifications have protocol responses', async () => {
  assert.equal((await rpc('not/a/method')).message.error.code, -32601);
  const malformed = await worker.fetch(request({ nonsense: true }), {}, {});
  assert.ok(malformed.status >= 400);
  const notification = await worker.fetch(request({ jsonrpc: '2.0', method: 'notifications/initialized' }), {}, {});
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
});

test('invalid JSON-RPC envelopes are rejected before the method filter, including notifications', async () => {
  const invalidRequest = async body => {
    const response = await worker.fetch(request(body), {}, {});
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null,
    });
  };
  for (const method of ['unsupported', 'subscriptions/listen', 'tools/list']) {
    for (const badId of [{ bad: 1 }, [], null, true, 1.5]) {
      await invalidRequest({ jsonrpc: '2.0', id: badId, method });
    }
    for (const params of [null, [], 'bad', 1, false]) {
      await invalidRequest({ jsonrpc: '2.0', id: 1, method, params });
      await invalidRequest({ jsonrpc: '2.0', method, params });
    }
  }
  for (const method of ['unsupported', 'subscriptions/listen']) {
    const notification = await worker.fetch(request({ jsonrpc: '2.0', method, params: {} }), {}, {});
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), '');
    const response = await worker.fetch(request({ jsonrpc: '2.0', id: 0, method, params: {} }), {}, {});
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, -32601);
  }
});

test('lookups perform no outbound fetches and prototype names remain plain missing data', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No network permitted'); };
  try {
    assert.equal((await call('get_class', { name: '__proto__' })).message.result.isError, true);
    assert.equal((await call('get_method', { name: 'Discord\\Builders\\MessageBuilder::setContent' })).response.status, 200);
  } finally { globalThis.fetch = original; }
});
