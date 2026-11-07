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

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function hostHeaderForm(host: string): string {
  const bare = stripBrackets(host);
  return bare.includes(':') ? `[${bare}]` : bare;
}

function originForm(host: string): string {
  const bare = stripBrackets(host);
  return bare.includes(':') ? `http://[${bare}]` : `http://${bare}`;
}

function isLoopback(host: string): boolean {
  const bare = stripBrackets(host).toLowerCase();
  return bare === '127.0.0.1' || bare === 'localhost' || bare === '::1' || bare === '';
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
  sendJson(res, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

/** Build the MCP Streamable HTTP request handler. */
export function buildMcpHttpHandler(options: HttpOptions = {}): HttpRequestHandler {
  const logger = options.logger ?? ((message: string) => console.error(message));
  const bindHost = options.host ?? process.env.HOST ?? '127.0.0.1';
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
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

    // CORS preflight, only for allowlisted browser origins.
    if (req.method === 'OPTIONS') {
      if (!origin || !isOriginAllowed(origin)) {
        jsonRpcError(403, res, -32603, 'Origin not allowed');
        return;
      }
      res.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-session-id',
        'access-control-max-age': '86400',
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

    if (origin && !isOriginAllowed(origin)) {
      jsonRpcError(403, res, -32603, 'Origin not allowed');
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

    const localPort = options.port ?? 0;

    const hostHeaderValue = req.headers.host ?? '';
    const allowedHosts = [
      bindHost.toLowerCase(),
      hostHeaderValue.trim().toLowerCase(),
      ...extraHosts.map((h) => h.toLowerCase()),
    ].filter(Boolean);

    const allowedOrigins = [
      `${originForm(bindHost)}${localPort ? `:${localPort}` : ''}`,
      `http://127.0.0.1${localPort ? `:${localPort}` : ''}`,
      `http://localhost${localPort ? `:${localPort}` : ''}`,
      `http://[::1]${localPort ? `:${localPort}` : ''}`,
      ...extraOrigins,
    ].filter(Boolean);

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
      allowedHosts: Array.from(new Set(allowedHosts)),
      allowedOrigins: Array.from(new Set(allowedOrigins)),
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

  function isOriginAllowed(origin: string): boolean {
    const normalized = origin.toLowerCase();
    const extras = new Set(extraOrigins.map((o) => o.toLowerCase()));
    // No Origin header at all is the normal case for MCP clients and curl.
    const defaultAllowed = [
      'http://127.0.0.1',
      'http://localhost',
      'http://[::1]',
      'http://127.0.0.1:',
      'http://localhost:',
      'http://[::1]:',
      'https://127.0.0.1',
      'https://localhost',
    ];
    if (extras.has(normalized)) return true;
    if (defaultAllowed.some((prefix) => normalized === prefix || normalized.startsWith(prefix))) return true;
    // Also allow any explicit http(s) entry in the extras list.
    return [...extras].some((entry) => entry.startsWith(normalized) || normalized.startsWith(entry));
  }
}

/** Start the HTTP server. Returns the bound port (useful in tests). */
export async function startHttpServer(
  options: HttpOptions = {},
): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
  const host = options.host ?? process.env.HOST ?? '127.0.0.1';
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
