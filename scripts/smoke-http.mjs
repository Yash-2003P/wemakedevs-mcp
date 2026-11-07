#!/usr/bin/env node
/**
 * Live smoke test for the Streamable HTTP transport.
 *
 *   TINYFISH_API_KEY=... npm run smoke:http
 *
 * Starts `node dist/src/http.js` the same way a deployment would, then talks to
 * it with the SDK's StreamableHTTPClientTransport:
 *   1. /health reports the transport
 *   2. a request without the bearer token is rejected with 401
 *   3. the authenticated client lists all 16 tools
 *   4. one live tool call (skipped without TINYFISH_API_KEY)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn } from 'node:child_process';
import { createServer, get } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const entry = path.join(root, 'dist', 'src', 'http.js');
const token = randomUUID();
let failures = 0;

function ok(label, condition, detail = '') {
  if (condition) console.log(`PASS ${label}${detail ? `  ${detail}` : ''}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}  ${detail}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

const port = await freePort();
const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: { ...process.env, PORT: String(port), MCP_HTTP_TOKEN: token },
  stdio: ['ignore', 'ignore', 'pipe'],
});

child.stderr.on('data', (chunk) => process.stderr.write(`  [server] ${chunk}`));
let done = false;
const shutdown = () => {
  if (done) return;
  done = true;
  child.kill('SIGTERM');
};
process.on('exit', shutdown);
process.on('SIGINT', () => {
  shutdown();
  process.exit(failures === 0 ? 0 : 1);
});

const base = `http://127.0.0.1:${port}`;
const authHeaders = { authorization: `Bearer ${token}` };

try {
  ok('server reports /health', await waitForHealth(base), base);
  const health = await (await fetch(`${base}/health`)).json();
  ok('health advertises the transport', health.transport === 'streamable-http' && health.auth === 'bearer', JSON.stringify(health));

  const unauthenticated = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  ok('missing token → 401', unauthenticated.status === 401, `got ${unauthenticated.status}`);

  const wrongToken = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer not-the-token',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });
  ok('wrong token → 401', wrongToken.status === 401, `got ${wrongToken.status}`);

  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: authHeaders },
  });
  const client = new Client({ name: 'wemakedevs-smoke-http', version: '0.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  ok('authenticated client lists 16 tools', tools.length === 16, `got ${tools.length}`);

  if (process.env.TINYFISH_API_KEY) {
    const res = await client.callTool(
      { name: 'list_hackathons', arguments: { status: 'upcoming', limit: 3 } },
      undefined,
      { timeout: 120_000 },
    );
    const sc = res.structuredContent;
    ok('live tool call over HTTP', !res.isError && typeof sc?.count === 'number', `${sc?.count} upcoming; source=${sc?.source}`);
  } else {
    console.log('SKIP live tool call over HTTP — set TINYFISH_API_KEY');
  }

  await client.close();
} finally {
  shutdown();
}

console.log(`\n${failures === 0 ? 'http smoke: all checks passed' : `http smoke: ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);

// silence unused import lint in some setups
void get;
