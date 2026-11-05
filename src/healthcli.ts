#!/usr/bin/env node
/**
 * CLI health check.
 *   npm run health                  # live, requires TINYFISH_API_KEY
 *   WEMAKEDEVS_MCP_HEALTH_OFFLINE=1 npm run health   # parse committed fixtures, no network
 *   npm run health -- --offline hackathons-listing careers   # subset
 */
import { runHealthChecks, ALL_TARGETS, type HealthTarget } from './health.js';

async function main() {
  const args = process.argv.slice(2);
  const offline = process.env.WEMAKEDEVS_MCP_HEALTH_OFFLINE === '1' || args.includes('--offline');
  const picked = args.filter((a) => !a.startsWith('--'));
  const targets = picked.length
    ? (picked.filter((a) => (ALL_TARGETS as string[]).includes(a)) as HealthTarget[])
    : undefined;
  if (picked.length && targets?.length === 0) {
    console.error(`Unknown target(s): ${picked.join(', ')}\nKnown: ${ALL_TARGETS.join(', ')}`);
    process.exit(2);
  }
  const report = await runHealthChecks({ offline, targets });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('health check crashed:', err);
  process.exit(1);
});
