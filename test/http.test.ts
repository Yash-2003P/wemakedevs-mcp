import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../src/http.js';

const silent = () => {};
const opened: Array<{ close: (cb?: () => void) => unknown }> = [];
const servers = new Map<string, { server: typeof opened[number]; port: number }>();

after(() => {
  for (const { server } of servers.values()) server.close();
  servers.clear();
});

async function boot(key: string, options: { token?: string; host?: string } = {}) {
  const { server, port } = await startHttpServer({ port: 0, logger: silent, ...options });
  servers.set(key, { server, port });
  return port;
}

const HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const rpc = (port: number, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { ...HEADERS, ...headers },
    body: JSON.stringify(body),
  });

let anonymousPort: number;
let tokenPort: number;

before(async () => {
  anonymousPort = await boot('anonymous');
  tokenPort = await boot('token', { token: 'test-token' });
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
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  assert.equal(res.status, 403);
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
