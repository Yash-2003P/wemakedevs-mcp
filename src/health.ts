import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WemakedevsError } from './errors.js';
import { fetchPages } from './tinyfish.js';
import {
  WEMMAKEDEVS_ORIGIN,
  parseCareers,
  parseHackathons,
  parseMeetups,
  parseScholarships,
  parseSectionAst,
  parseFaq,
} from './parse.js';
import type { HealthReportSchema } from './schemas.js';
import type { z } from 'zod';

export type HealthReport = z.infer<typeof HealthReportSchema>;
type CheckResult = HealthReport['results'][number];

export type HealthTarget =
  | 'hackathons-listing'
  | 'hackathon-detail'
  | 'rules-page'
  | 'meetups-listing'
  | 'careers'
  | 'scholarships';

export const ALL_TARGETS: HealthTarget[] = [
  'hackathons-listing',
  'hackathon-detail',
  'rules-page',
  'meetups-listing',
  'careers',
  'scholarships',
];

const SENTINEL_SLUG = process.env.HEALTH_SENTINEL_SLUG ?? 'switch';

const FIXTURES: Record<string, string> = {
  [`${WEMMAKEDEVS_ORIGIN}/hackathons`]: 'hackathons.html',
  [`${WEMMAKEDEVS_ORIGIN}/meetups`]: 'meetups.html',
  [`${WEMMAKEDEVS_ORIGIN}/careers`]: 'careers.html',
  [`${WEMMAKEDEVS_ORIGIN}/scholarships`]: 'scholarships.html',
  [`${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}`]: `${SENTINEL_SLUG}.html`,
  [`${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}/rules`]: 'rules.html',
};

export interface HealthOptions {
  /** offline = parse committed fixtures, no network. Used by CI. */
  offline?: boolean;
  fixturesDir?: string;
  targets?: HealthTarget[];
}

async function getHtml(url: string, opts: HealthOptions): Promise<string> {
  if (opts.offline) {
    const dir = opts.fixturesDir ?? path.join(process.cwd(), 'test', 'fixtures');
    const file = FIXTURES[url];
    if (!file) throw new WemakedevsError('CONFIG', `No fixture registered for ${url}`);
    return readFile(path.join(dir, file), 'utf8');
  }
  const out = await fetchPages([url], { format: 'html', ttl: 0 });
  const text = out.results[0]?.text;
  if (typeof text !== 'string' || text.length < 1000) {
    throw new WemakedevsError('SITE_CHANGED', `Suspiciously small page returned for ${url}`, { url });
  }
  return text;
}

async function timed(name: string, soft: boolean, fn: () => Promise<string>): Promise<CheckResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, soft, ms: Date.now() - start, detail };
  } catch (err) {
    const msg =
      err instanceof WemakedevsError
        ? `${err.code}: ${err.message}${err.hint ? ` (hint: ${err.hint})` : ''}`
        : String(err instanceof Error ? err.message : err);
    return { name, ok: false, soft, ms: Date.now() - start, detail: msg };
  }
}

export async function runHealthChecks(opts: HealthOptions = {}): Promise<HealthReport> {
  const targets = opts.targets ?? ALL_TARGETS;
  const wanted = new Set(targets);
  const checks: Array<Promise<CheckResult>> = [];

  if (wanted.has('hackathons-listing')) {
    checks.push(timed('hackathons-listing', false, async () => {
      const html = await getHtml(`${WEMMAKEDEVS_ORIGIN}/hackathons`, opts);
      const { items, source } = parseHackathons(html);
      if (items.length < 25) throw new WemakedevsError('SITE_CHANGED', `Only ${items.length} hackathon cards parsed (expected ≥ 25).`);
      const bad = items.find((i) => !i.title || !i.url.startsWith('http'));
      if (bad) throw new WemakedevsError('SITE_CHANGED', `Card with missing title/url: ${JSON.stringify(bad)}`);
      const withDates = items.filter((i) => i.startDate).length;
      return `${items.length} events parsed (${source}); ${withDates} with ISO dates; sentinel present: ${items.some((i) => /switch/i.test(i.url))}`;
    }));
  }

  if (wanted.has('hackathon-detail')) {
    checks.push(timed('hackathon-detail', false, async () => {
      const url = `${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}`;
      const html = await getHtml(url, opts);
      const ast = parseSectionAst(html, WEMMAKEDEVS_ORIGIN);
      if (!ast.title) throw new WemakedevsError('SITE_CHANGED', 'Detail page has no <h1> title.');
      if (ast.sections.length < 4) throw new WemakedevsError('SITE_CHANGED', `Only ${ast.sections.length} sections with ids found (expected ≥ 4).`);
      const prizeSection = ast.sections.find((s) => /prizes/i.test(s.id) || /prizes/i.test(s.heading ?? ''));
      if (!prizeSection) throw new WemakedevsError('SITE_CHANGED', 'No prizes section found on the detail page.');
      const faq = parseFaq(html);
      if (faq.length < 3) throw new WemakedevsError('SITE_CHANGED', `Only ${faq.length} FAQ entries found (expected ≥ 3).`);
      return `title="${ast.title.slice(0, 60)}"; ${ast.sections.length} sections; prizes section ok; ${faq.length} FAQ entries`;
    }));
  }

  if (wanted.has('rules-page')) {
    checks.push(timed('rules-page', false, async () => {
      const url = `${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}/rules`;
      const html = await getHtml(url, opts);
      if (!/Official Rules|NO PURCHASE NECESSARY/i.test(html)) {
        throw new WemakedevsError('SITE_CHANGED', 'Rules page no longer contains the expected legal heading.');
      }
      const ast = parseSectionAst(html, WEMMAKEDEVS_ORIGIN);
      return `title="${(ast.title ?? '(none)').slice(0, 60)}"; ${ast.sections.length} sections; rules markers ok`;
    }));
  }

  if (wanted.has('meetups-listing')) {
    checks.push(timed('meetups-listing', false, async () => {
      const html = await getHtml(`${WEMMAKEDEVS_ORIGIN}/meetups`, opts);
      const items = parseMeetups(html);
      if (items.length < 8) throw new WemakedevsError('SITE_CHANGED', `Only ${items.length} meetup cards parsed (expected ≥ 8).`);
      return `${items.length} meetups parsed; all cards have title+url`;
    }));
  }

  if (wanted.has('careers')) {
    checks.push(timed('careers', false, async () => {
      const html = await getHtml(`${WEMMAKEDEVS_ORIGIN}/careers`, opts);
      const items = parseCareers(html);
      return items.length === 0
        ? '0 open roles (page shows an empty state — valid, not a failure)'
        : `${items.length} open role(s): ${items.map((i) => i.title).join(', ')}`;
    }));
  }

  if (wanted.has('scholarships')) {
    checks.push(timed('scholarships', false, async () => {
      const html = await getHtml(`${WEMMAKEDEVS_ORIGIN}/scholarships`, opts);
      const info = parseScholarships(html);
      return `program="${(info.program ?? '(none)').slice(0, 60)}"; status=${info.status}; ${info.covers.length} coverage items; ${info.winners.length} past winners; ${info.faqs.length} FAQs`;
    }));
  }

  const results = await Promise.all(checks);
  const ok = results.every((r) => r.ok || r.soft);
  const mode = opts.offline ? 'offline' : process.env.TINYFISH_FETCH_BASE_URL ? 'stub' : 'live';
  return { ok, mode, checkedAt: new Date().toISOString(), results };
}
