#!/usr/bin/env node
/**
 * Reproducible MCP smoke test.
 *
 *   TINYFISH_API_KEY=... npm run smoke          # every fast tool (live)
 *   TINYFISH_API_KEY=... npm run smoke -- --all # also the slow Agent call (~40 s)
 *
 * Starts the built server over stdio, asserts the tool surface, then calls each
 * tool once against the live site. Exits non-zero on the first failure.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const includeAgent = process.argv.includes('--all');

if (!process.env.TINYFISH_API_KEY) {
  console.error('TINYFISH_API_KEY is required (this script only does live calls).');
  process.exit(2);
}

const EXPECTED_TOOLS = [
  'check_registration_status',
  'get_blog_post',
  'get_hackathon',
  'get_hackathon_changes',
  'get_hackathon_resources',
  'get_hackathon_rules',
  'get_hackathon_schedule',
  'health_check',
  'latest_updates',
  'list_blog_posts',
  'list_hackathons',
  'list_meetups',
  'list_open_roles',
  'list_scholarships',
  'search_blog',
  'upcoming_deadlines',
];

/** @type {Array<[string, Record<string, unknown>, (sc: any) => string]>} */
const CASES = [
  ['list_hackathons', { status: 'upcoming', limit: 3 }, (sc) => `${sc.count} upcoming; source=${sc.source}`],
  ['get_hackathon', { hackathon: 'switch', sections: ['prizes'] }, (sc) => `${sc.title}; prizePool=${sc.prizePool}; ${sc.sections.length} section(s)`],
  ['get_hackathon_rules', { hackathon: 'switch' }, (sc) => `${sc.title}; ${sc.sections.length} section(s); ${sc.links.length} link(s)`],
  ['get_hackathon_schedule', { hackathon: 'switch' }, (sc) => `${sc.items.length} milestone(s); ${sc.items.filter((i) => i.date).length} with ISO dates`],
  ['get_hackathon_resources', { hackathon: 'switch' }, (sc) => `${sc.groups.length} group(s); ${sc.groups.reduce((n, g) => n + g.links.length, 0)} link(s)`],
  ['list_meetups', { limit: 3 }, (sc) => `${sc.count} meetup(s)`],
  ['list_open_roles', { limit: 3 }, (sc) => `${sc.count} role(s)${sc.count === 0 ? ' (empty state)' : ''}`],
  ['list_scholarships', {}, (sc) => `${sc.program ?? '(none)'}; status=${sc.status}`],
  ['list_blog_posts', { limit: 3 }, (sc) => `${sc.count} post(s)`],
  ['search_blog', { query: 'switch', limit: 3 }, (sc) => `${sc.count} match(es)`],
  ['get_blog_post', { post: 'wispr' }, (sc) => `${sc.title}; ${sc.paragraphs.length} paragraph(s); ${sc.links.length} link(s)`],
  ['upcoming_deadlines', { within_days: 30 }, (sc) => `${sc.items.length} deadline(s)`],
  ['latest_updates', { within_days: 30 }, (sc) => `${sc.items.length} update(s)`],
  ['get_hackathon_changes', { update_baseline: false }, (sc) =>
    sc.baselineCreated
      ? `no prior baseline; ${sc.compared} event(s) observed`
      : `${sc.added.length} added / ${sc.removed.length} removed / ${sc.changed.length} changed`],
  ['health_check', { target: 'hackathons-listing' }, (sc) => `${sc.results.filter((r) => r.ok).length}/${sc.results.length} check(s) ok; mode=${sc.mode}`],
];

if (includeAgent) {
  CASES.push([
    'check_registration_status',
    { hackathon: 'switch' },
    (sc) => `state=${sc.state}; registered=${sc.registeredCount ?? 'n/a'}; ${sc.observedAt}`,
  ]);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist', 'src', 'index.js')],
  cwd: root,
  env: { ...process.env },
});

const client = new Client({ name: 'wemakedevs-smoke', version: '0.0.0' });
let failures = 0;

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
  const extra = names.filter((n) => !EXPECTED_TOOLS.includes(n));
  console.log(`tools: ${names.length}/${EXPECTED_TOOLS.length}${missing.length ? ` | missing: ${missing.join(', ')}` : ''}${extra.length ? ` | unexpected: ${extra.join(', ')}` : ''}`);
  if (missing.length || extra.length) failures += 1;

  console.log(`cases: ${CASES.length}${includeAgent ? ' (including Agent)' : ' (Agent skipped; use --all)'}\n`);

  for (const [name, args, summarise] of CASES) {
    const started = Date.now();
    try {
      const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
      const ms = Date.now() - started;
      if (res.isError) {
        failures += 1;
        const text = res.content?.find?.((c) => c.type === 'text')?.text ?? '';
        console.log(`FAIL ${name.padEnd(26)} ${ms} ms  ${String(text).slice(0, 300)}`);
        continue;
      }
      const sc = res.structuredContent;
      if (!sc) {
        failures += 1;
        console.log(`FAIL ${name.padEnd(26)} ${ms} ms  no structuredContent`);
        continue;
      }
      console.log(`PASS ${name.padEnd(26)} ${String(ms).padStart(5)} ms  ${summarise(sc)}`);
    } catch (err) {
      failures += 1;
      console.log(`FAIL ${name.padEnd(26)} ${Date.now() - started} ms  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
} finally {
  await client.close();
}

console.log(`\n${failures === 0 ? 'smoke: all checks passed' : `smoke: ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
