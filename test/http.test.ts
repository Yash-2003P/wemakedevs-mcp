import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer, type HttpOptions } from '../src/http.js';

const silent = () => {};
const opened: Array<{ close: (cb?: () => void) => unknown }> = [];
const servers = new Map<string, { server: typeof opened[number]; port: number }>();

after(() => {
  for (const { server } of servers.values()) server.close();
  servers.clear();
});

async function boot(key: string, options: Omit<HttpOptions, 'port' | 'logger'> = {}) {
  const { server, port } = await startHttpServer({ port: 0, logger: silent, ...options });
  servers.set(key, { server, port });
  return port;
}

const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize' };
const rpc = (port: number, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { ...HEADERS, ...headers },
    body: JSON.stringify(body),
  });

/** Send a request whose Host header the caller controls (fetch would override it). */
function rawRpc(
  port: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { ...HEADERS, ...headers } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

let anonymousPort: number;
let tokenPort: number;
let extraHostPort: number;

before(async () => {
  anonymousPort = await boot('anonymous');
  tokenPort = await boot('token', { token: 'test-token' });
  extraHostPort = await boot('extra-host', { allowedHosts: ['mcp.example.test'] });
});

test('http: /health reports the Streamable HTTP transport', async () => {
  const res = await fetch(`http://127.0.0.1:${anonymousPort}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.transport, 'streamable-http');
  assert.equal(body.tinyfishKeyPresent, Boolean(process.env.TINYFISH_API_KEY));
});

test('http: an MCP client lists all 16 tools over Streamable HTTP', async () => {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${anonymousPort}/mcp`));
  const client = new Client({ name: 'http-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 16);
    assert.ok(tools.some((t) => t.name === 'list_hackathons'));
  } finally {
    await client.close();
  }
});

test('http: a modern 2026-07-28 request lists tools without initialize', async () => {
  const res = await fetch(`http://127.0.0.1:${anonymousPort}/mcp`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'http-test', version: '0.0.0' },
        },
      },
    }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result?: { tools?: unknown[] } };
  assert.equal(body.result?.tools?.length, 16);
});

test('http: routing rejects unknown paths and non-POST on /mcp', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${anonymousPort}/nope`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${anonymousPort}/mcp`)).status, 405);
  assert.equal(
    (
      await fetch(`http://127.0.0.1:${anonymousPort}/mcp`, {
        method: 'PUT',
        headers: HEADERS,
        body: '{}',
      })
    ).status,
    405,
  );
});

test('http: a cross-origin browser request is refused', async () => {
  const res = await fetch(`http://127.0.0.1:${anonymousPort}/mcp`, {
    method: 'POST',
    headers: { ...HEADERS, origin: 'http://evil.example' },
    body: JSON.stringify(INITIALIZE),
  });
  assert.equal(res.status, 403);
});

test('http: origin lookalikes are refused, not prefix-matched', async () => {
  for (const origin of [
    'http://localhost.evil.com',
    'http://127.0.0.1.evil.com',
    'http://evil.com/localhost',
    'http://evil.com?http://localhost',
    'null',
  ]) {
    const res = await rpc(anonymousPort, INITIALIZE, { origin });
    assert.equal(res.status, 403, `expected 403 for Origin: ${origin}`);
  }
});

test('http: an allowed loopback origin is echoed in CORS headers', async () => {
  const origin = 'http://localhost:5173';
  const res = await rpc(anonymousPort, INITIALIZE, { origin });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), origin);
  assert.match(res.headers.get('vary') ?? '', /origin/i);
});

test('http: a spoofed Host header is refused before the body is handled', async () => {
  const res = await rawRpc(anonymousPort, INITIALIZE, { host: 'evil.example' });
  assert.equal(res.status, 403);
  assert.match(res.body, /Host not allowed/);

  const rawHealth = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: anonymousPort, path: '/health', method: 'GET', headers: { host: 'evil.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(rawHealth, 403);
});

test('http: a configured extra Host header is accepted verbatim', async () => {
  const res = await rawRpc(extraHostPort, INITIALIZE, { host: 'mcp.example.test' });
  assert.equal(res.status, 200);
});

test('http: bearer token is enforced when configured', async () => {
  const without = await rpc(tokenPort, { jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(without.status, 401);
  assert.match(without.headers.get('www-authenticate') ?? '', /Bearer/);

  const wrong = await rpc(tokenPort, { jsonrpc: '2.0', id: 1, method: 'initialize' }, { authorization: 'Bearer nope' });
  assert.equal(wrong.status, 401);

  const good = await rpc(
    tokenPort,
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { authorization: 'Bearer test-token' },
  );
  assert.equal(good.status, 200);
});

test('http: a non-loopback bind is refused without a token', async () => {
  await assert.rejects(
    () => startHttpServer({ host: '127.0.0.2', port: 0, logger: silent }),
    /Refusing to bind .*MCP_HTTP_TOKEN/,
  );
});
