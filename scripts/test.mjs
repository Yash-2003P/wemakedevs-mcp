#!/usr/bin/env node
/**
 * Cross-version test runner.
 *
 * Node 20's `node --test` accepts a directory; Node 24 wants explicit files
 * (and shell globs are not portable). Resolve the built tests here and pass
 * the file list, so `npm test` behaves the same on every supported Node.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = path.resolve('dist', 'test');
let entries;
try {
  entries = readdirSync(dir);
} catch {
  console.error(`No built tests at ${dir}. Run "npm run build" first.`);
  process.exit(1);
}

const files = entries
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(dir, name));

if (files.length === 0) {
  console.error(`No *.test.js files in ${dir}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) {
  console.error('Failed to start the test runner:', result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
