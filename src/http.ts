#!/usr/bin/env node
/**
 * Streamable HTTP transport for wemakedevs-mcp.
 *
 * The stdio entry point (src/index.ts) remains the default. This entry point
 * adds the transport Claude Code / OpenAI Agents SDK / remote hosts expect,
 * without changing any tool.
 *
 *   node dist/src/http.js                       # loopback, no auth
 *   PORT=3000 node dist/src/http.js
 *   HOST=0.0.0.0 MCP_HTTP_TOKEN=secret node dist/src/http.js
 *
 * Safety defaults:
 *   - Binds 127.0.0.1 unless HOST is set explicitly.
 *   - Refuses to bind a non-loopback address without MCP_HTTP_TOKEN.
 *   - Rejects requests whose Origin header is not allowlisted.
 *   - The transport enforces Host allowlisting (DNS-rebinding protection)
 *     using the address this process actually listens on, plus MCP_HTTP_HOSTS.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { realpathSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools.js';

export const SERVER_NAME = 'wemakedevs-mcp';
export const SERVER_VERSION = '0.1.0';

export interface HttpOptions {
  /** Address to bind. Defaults to 127.0.0.1. */
  host?: string;
  /** Port to bind. Defaults to PORT (3000) or 0 for an ephemeral port. */
  port?: number;
  /** Shared secret required as `Authorization: Bearer <token>`. */
  token?: string;
  /** Extra allowed Origin values (comma-separated env MCP_HTTP_ORIGINS). */
  allowedOrigins?: string[];
  /** Extra allowed Host values (comma-separated env MCP_HTTP_HOSTS). */
  allowedHosts?: string[];
  /** Log sink. Defaults to stderr. Pass a no-op in tests. */
  logger?: (message: string) => void;
}

export type HttpRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => void | Promise<void>;

const MAX_BODY_BYTES = Number(process.env.MCP_HTTP_MAX_BODY_BYTES ?? 4 * 1024 * 1024);

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function hostHeaderForm(host: string): string {
  const bare = stripBrackets(host);
  return bare.includes(':') ? `[${bare}]` : bare;
}

function resolveBindHost(value?: string): string {
  const candidate = (value ?? process.env.HOST ?? '127.0.0.1').trim();
  return candidate === '' ? '127.0.0.1' : candidate;
}

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(stripBrackets(host).toLowerCase());
}

/** Parse an Origin header into its canonical serialization, or null if invalid. */
function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const hostname = stripBrackets(new URL(normalized).hostname).toLowerCase();
  return LOOPBACK_HOSTS.has(hostname);
}

/** Host header values this process will answer to, exact match including port. */
function allowedHostValues(bindHost: string, port: number, extraHosts: string[]): string[] {
  const values = new Set<string>();
  const add = (host: string, appendPort: boolean) => {
    const normalized = host.trim().toLowerCase();
    if (!normalized) return;
    values.add(normalized);
    if (appendPort && port > 0) values.add(`${hostHeaderForm(normalized)}:${port}`);
  };

  add(bindHost, true);
  if (isLoopback(bindHost)) {
    add('127.0.0.1', true);
    add('localhost', true);
    add('::1', true);
  }
  // Extra hosts are matched verbatim: include the port if the Host header has one.
  for (const host of extraHosts) add(host, false);
  return [...values];
}

/** Same-origin value for the address this process is bound to. */
function selfOrigin(bindHost: string, port: number): string | null {
  const bare = stripBrackets(bindHost);
  if (!bare || bare === '0.0.0.0' || bare === '::') return null;
  return `http://${hostHeaderForm(bare)}${port > 0 ? `:${port}` : ''}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function jsonRpcError(status: number, res: ServerResponse, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

/** Build the MCP Streamable HTTP request handler. */
export function buildMcpHttpHandler(options: HttpOptions = {}): HttpRequestHandler {
  const logger = options.logger ?? ((message: string) => console.error(message));
  const bindHost = resolveBindHost(options.host);
  const token = options.token ?? process.env.MCP_HTTP_TOKEN ?? '';
  const extraOrigins = splitList(process.env.MCP_HTTP_ORIGINS).concat(options.allowedOrigins ?? []);
  const extraHosts = splitList(process.env.MCP_HTTP_HOSTS).concat(options.allowedHosts ?? []);

  return async (req, res) => {
    const started = Date.now();
    try {
      await handle(req, res);
    } catch (err) {
      logger(`${req.method ?? '?'} ${req.url ?? '?'} failed: ${String(err)}`);
      if (!res.headersSent) {
        jsonRpcError(500, res, -32603, 'Internal error');
      } else if (!res.writableEnded) {
        res.end();
      }
    } finally {
      logger(`${req.method ?? '?'} ${req.url ?? '?'} → ${res.statusCode} (${Date.now() - started} ms)`);
    }
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // DNS-rebinding protection: answer only to Host values we expect. This is
    // checked before the body is read, so a spoofed Host cannot reach the SDK.
    const hostHeader = typeof req.headers.host === 'string' ? req.headers.host.trim().toLowerCase() : '';
    if (!hostHeader || !requestHosts().includes(hostHeader)) {
      jsonRpcError(403, res, -32603, 'Host not allowed');
      return;
    }

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (origin && !isOriginAllowed(origin)) {
      jsonRpcError(403, res, -32603, 'Origin not allowed');
      return;
    }
    if (origin) {
      // Echo only the validated origin; never reflect arbitrary input.
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-expose-headers', 'mcp-protocol-version');
    }

    // CORS preflight, only for allowlisted browser origins.
    if (req.method === 'OPTIONS') {
      if (!origin) {
        jsonRpcError(403, res, -32603, 'Origin not allowed');
        return;
      }
      res.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
        'access-control-max-age': '86400',
        'vary': 'origin',
        'content-length': '0',
      });
      res.end();
      return;
    }

    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD');
        jsonRpcError(405, res, -32603, 'Method not allowed');
        return;
      }
      sendJson(res, 200, {
        ok: true,
        name: SERVER_NAME,
        version: SERVER_VERSION,
        transport: 'streamable-http',
        auth: token ? 'bearer' : 'none-loopback-only',
        tinyfishKeyPresent: Boolean(process.env.TINYFISH_API_KEY),
      });
      return;
    }

    if (path !== '/mcp' && path !== '/') {
      jsonRpcError(404, res, -32600, 'Not found');
      return;
    }

    if (token) {
      const header = req.headers.authorization ?? '';
      const supplied = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      if (!safeEqual(supplied, token)) {
        res.setHeader('www-authenticate', 'Bearer error="invalid_token"');
        jsonRpcError(401, res, -32001, 'Missing or invalid bearer token');
        return;
      }
    }

    if (req.method !== 'POST') {
      // Stateless mode: no standalone SSE stream, no session to delete.
      res.setHeader('allow', 'POST');
      jsonRpcError(405, res, -32600, 'Method not allowed; this stateless MCP endpoint accepts POST only');
      return;
    }

    const transportHosts = requestHosts();
    const transportOrigins = requestOrigins();
    if (origin) {
      // The origin already passed isOriginAllowed (loopback origins on any
      // port are allowed), so include its exact value for the SDK's own check.
      const normalized = normalizeOrigin(origin);
      if (normalized && !transportOrigins.includes(normalized)) transportOrigins.push(normalized);
    }

    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    registerTools(server);
    const transport = new StreamableHTTPServerTransport({
      // Stateless: one server per request keeps this deployable on any host
      // without sticky sessions, and matches a read-only tool surface.
      sessionIdGenerator: undefined,
      // Plain JSON bodies are easier for non-SSE clients and curl.
      enableJsonResponse: true,
      maxRequestBodySize: MAX_BODY_BYTES,
      enableDnsRebindingProtection: true,
      allowedHosts: transportHosts,
      allowedOrigins: transportOrigins,
    });

    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    };
    res.on('close', cleanup);

    await server.connect(transport);
    await transport.handleRequest(req, res);
    cleanup();
  }

  /** Exact Host header values accepted by this process. */
  function requestHosts(): string[] {
    return allowedHostValues(bindHost, options.port ?? 0, extraHosts);
  }

  /** Exact origins accepted beyond loopback, which is always allowed. */
  function requestOrigins(): string[] {
    const origins = new Set<string>();
    const own = selfOrigin(bindHost, options.port ?? 0);
    if (own) origins.add(own);
    for (const raw of extraOrigins) {
      const normalized = normalizeOrigin(raw);
      if (normalized) origins.add(normalized);
    }
    return [...origins];
  }

  function isOriginAllowed(origin: string): boolean {
    if (isLoopbackOrigin(origin)) return true;
    const normalized = normalizeOrigin(origin);
    return normalized !== null && requestOrigins().includes(normalized);
  }
}

/** Start the HTTP server. Returns the bound port (useful in tests). */
export async function startHttpServer(
  options: HttpOptions = {},
): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const host = resolveBindHost(options.host);
  const requestedPort = options.port ?? Number(process.env.PORT ?? 3000);
  const token = options.token ?? process.env.MCP_HTTP_TOKEN ?? '';
  const logger = options.logger ?? ((message: string) => console.error(message));

  if (!token && !isLoopback(host)) {
    throw new Error(
      `Refusing to bind ${host} without MCP_HTTP_TOKEN. Set HOST=127.0.0.1, or provide MCP_HTTP_TOKEN.`,
    );
  }

  const handlerOptions: HttpOptions = { ...options };
  const server = createServer(buildMcpHttpHandler(handlerOptions));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      const address = server.address();
      const boundPort = address && typeof address === 'object' ? address.port : requestedPort;
      // The handler reads options.port per request, so a bound ephemeral
      // port (0) still yields correct Host/Origin allowlists.
      handlerOptions.port = boundPort;
      logger(
        `${SERVER_NAME} ${SERVER_VERSION}: Streamable HTTP on http://${hostHeaderForm(host)}:${boundPort}/mcp ` +
          `(${isLoopback(host) ? 'loopback' : 'external'}${token ? '; bearer auth required' : '; no token — loopback only'})`,
      );
      resolve({ server, port: boundPort });
    });
  });
}

async function main(): Promise<void> {
  const { server } = await startHttpServer();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    });
  }
}

const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  (() => {
    try {
      return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
      return false;
    }
  })();

if (invokedDirectly) {
  main().catch((err) => {
    console.error('wemakedevs-mcp (http) failed to start:', err);
    process.exit(1);
  });
}
