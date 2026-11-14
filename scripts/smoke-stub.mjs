#!/usr/bin/env node
/**
 * Offline end-to-end smoke test: starts the local TinyFish stub, then runs the
 * same stdio smoke client against all 16 tools (including the Agent tool).
 *
 *   npm run smoke:stub
 *
 * This is not a live-web test. It proves handler wiring, schemas and error
 * envelopes without network access or a TinyFish key.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

const stub = spawn(process.execPath, [path.join(root, 'scripts', 'stub-tinyfish.mjs')], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'inherit', 'inherit'],
});

async function waitForStub() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fetch(base, { method: 'GET' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('TinyFish stub did not start within 10 s');
}

let code = 1;
let stateDir;
try {
  stateDir = await mkdtemp(path.join(tmpdir(), 'wemakedevs-smoke-'));
  await waitForStub();
  const smoke = spawn(process.execPath, [path.join(root, 'scripts', 'smoke.mjs'), '--all'], {
    cwd: root,
    env: {
      ...process.env,
      TINYFISH_API_KEY: 'stub',
      TINYFISH_FETCH_BASE_URL: base,
      TINYFISH_AGENT_RUN_URL: `${base}/v1/automation/run`,
      WEMAKEDEVS_MCP_STATE_DIR: stateDir,
    },
    stdio: 'inherit',
  });
  code = await new Promise((resolve, reject) => {
    smoke.on('error', reject);
    smoke.on('exit', (exitCode) => resolve(exitCode ?? 1));
  });
} finally {
  stub.kill('SIGTERM');
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
}

process.exit(code);
