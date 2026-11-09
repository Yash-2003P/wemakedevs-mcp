#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { registerTools } from './tools.js';

// serveStdio owns the protocol-era decision: legacy (2025) clients get the
// initialize handshake, modern (2026-07-28) clients get server/discover, and
// both are backed by the same tool registrations.
serveStdio(() => {
  const server = new McpServer(
    { name: 'wemakedevs-mcp', version: '0.1.0' },
    // The tool schemas accept at most a 300-char slug and a 20-item section
    // list; 256 combined input elements is far above anything legitimate.
    { maxToolInputElements: 256 },
  );
  registerTools(server);
  return server;
}, {
  onerror: (err) => console.error('wemakedevs-mcp transport error:', err),
});

console.error('wemakedevs-mcp: running on stdio (set TINYFISH_API_KEY to enable live fetches)');
