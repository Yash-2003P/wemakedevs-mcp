#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

async function main() {
  const server = new McpServer({ name: 'wemakedevs-mcp', version: '0.1.0' });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('wemakedevs-mcp: running on stdio (set TINYFISH_API_KEY to enable live fetches)');
}

main().catch((err) => {
  console.error('wemakedevs-mcp failed to start:', err);
  process.exit(1);
});
