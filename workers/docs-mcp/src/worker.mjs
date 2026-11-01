import { createMcpHandler } from 'agents/mcp/server';
import { JSONRPCRequestSchema, JSONRPCNotificationSchema } from '@modelcontextprotocol/core';
import { createServer } from './server.mjs';
import { provenance, adapterSource } from './reference.mjs';
import upstreamLicense from '../generated/DiscordPHP-LICENSE.json' with { type: 'json' };

const MAX_REQUEST_BYTES = 16 * 1024;
const messageSchema = JSONRPCRequestSchema.or(JSONRPCNotificationSchema);
const handler = createMcpHandler(createServer, { route: '/mcp', corsOptions: false });
const methods = new Set(['server/discover', 'initialize', 'ping', 'tools/list', 'tools/call', 'notifications/initialized', 'notifications/cancelled']);
const json = (data, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/license' && request.method === 'GET') return new Response(upstreamLicense, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' },
    });
    if (url.pathname === '/health' && request.method === 'GET') return json({ service: 'dphp-docs-mcp', version: '0.1.0', revision: provenance.revision, adapterSource });
    if (url.pathname !== '/mcp') return json({ error: 'Not found. MCP endpoint: /mcp' }, 404);
    // Public reference service. No cross-origin browser access; origin-less MCP
    // clients and same-origin requests work. Validate before parsing any body.
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== url.origin) return json({ error: 'Origin not allowed' }, 403);
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'Expected application/json' }, 415);
    const encoding = request.headers.get('content-encoding');
    if (encoding && encoding !== 'identity') return json({ error: 'Encoded bodies are not supported' }, 415);
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) return json({ error: 'Request body exceeds 16 KiB' }, 413);
    // Enforce the actual streamed byte count as Content-Length can be absent.
    let body;
    try {
      const reader = request.body?.getReader();
      const chunks = [];
      let bytes = 0;
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_REQUEST_BYTES) {
            await reader.cancel();
            return json({ error: 'Request body exceeds 16 KiB' }, 413);
          }
          chunks.push(value);
        }
      }
      const buffer = new Uint8Array(bytes);
      let at = 0;
      for (const chunk of chunks) { buffer.set(chunk, at); at += chunk.byteLength; }
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    } catch {
      return json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, 400);
    }
    if (Array.isArray(body)) return json({ jsonrpc: '2.0', error: { code: -32600, message: 'Batch requests are not supported' }, id: null }, 400);
    // Validate the envelope before handling any method ourselves. In particular,
    // malformed IDs/params are invalid requests, never method-not-found replies
    // or silently accepted notifications. Reuse the SDK's public schemas.
    if (!messageSchema.safeParse(body).success) return json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null }, 400);
    // An immutable reference index needs no subscription streams or protocol
    // sessions. Keep every exchange finite, including in the modern MCP lane.
    if (body?.jsonrpc === '2.0' && typeof body.method === 'string' && !methods.has(body.method)) {
      if (!Object.hasOwn(body, 'id')) return new Response(null, { status: 202 });
      return json({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: body.id }, 400);
    }
    // The SDK handles protocol negotiation, JSON-RPC validation and tool input
    // schemas. Give it the bounded parsed object so the request is not read twice.
    const response = await handler.fetch(request, { parsedBody: body });
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  },
};
