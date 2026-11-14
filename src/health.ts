import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { WemakedevsError } from './errors.js';
import { fetchPages } from './tinyfish.js';
import {
  WEMMAKEDEVS_ORIGIN,
  parseCareers,
  parseHackathons,
  parseBlogRss,
  parseMeetups,
  parseScholarships,
  parseSectionAst,
  parseFaq,
  parseResources,
  parseSchedule,
} from './parse.js';
import type { HealthReportSchema } from './schemas.js';
import type { z } from 'zod';

export type HealthReport = z.infer<typeof HealthReportSchema>;
type CheckResult = HealthReport['results'][number];

export type HealthTarget =
  | 'hackathons-listing'
  | 'hackathon-detail'
  | 'hackathon-schedule'
  | 'hackathon-resources'
  | 'rules-page'
  | 'meetups-listing'
  | 'careers'
  | 'scholarships'
  | 'blog-rss';

export const ALL_TARGETS: HealthTarget[] = [
  'hackathons-listing',
  'hackathon-detail',
  'hackathon-schedule',
  'hackathon-resources',
  'rules-page',
  'meetups-listing',
  'careers',
  'scholarships',
  'blog-rss',
];

const SENTINEL_SLUG = process.env.HEALTH_SENTINEL_SLUG ?? 'switch';

const FIXTURES: Record<string, string> = {
  [`${WEMMAKEDEVS_ORIGIN}/hackathons`]: 'hackathons.html',
  [`${WEMMAKEDEVS_ORIGIN}/meetups`]: 'meetups.html',
  [`${WEMMAKEDEVS_ORIGIN}/careers`]: 'careers.html',
  [`${WEMMAKEDEVS_ORIGIN}/scholarships`]: 'scholarships.html',
  [`${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}`]: `${SENTINEL_SLUG}.html`,
  [`${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}/rules`]: 'rules.html',
  [`${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}/schedule`]: 'schedule.html',
  [`${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}/resources`]: 'resources.html',
  [`${WEMMAKEDEVS_ORIGIN}/blogs/rss.xml`]: 'blog-rss.xml',
};

const RSS_URL = `${WEMMAKEDEVS_ORIGIN}/blogs/rss.xml`;

export interface HealthOptions {
  /** offline = parse committed fixtures, no network. Used by CI. */
  offline?: boolean;
  fixturesDir?: string;
  targets?: HealthTarget[];
}

async function getHtml(
  url: string,
  opts: HealthOptions,
  selectors: string[] | null = ['body'],
): Promise<string> {
  if (opts.offline) {
    const dir = opts.fixturesDir ?? path.join(process.cwd(), 'test', 'fixtures');
    const file = FIXTURES[url];
    if (!file) throw new WemakedevsError('CONFIG', `No fixture registered for ${url}`);
    return readFile(path.join(dir, file), 'utf8');
  }
  const out = await fetchPages([url], {
    format: 'html',
    ttl: 0,
    includeSelectors: selectors ?? undefined,
  });
  const text = out.results[0]?.text;
  if (typeof text !== 'string' || text.length < 100) {
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
      if (items.length < 10) throw new WemakedevsError('SITE_CHANGED', `Only ${items.length} hackathon cards parsed (expected ≥ 10).`);
      const bad = items.find((i) => !i.title || !i.url.startsWith('http'));
      if (bad) throw new WemakedevsError('SITE_CHANGED', `Card with missing title/url: ${JSON.stringify(bad)}`);
      const withDates = items.filter((i) => i.startDate).length;
      if (withDates === 0) throw new WemakedevsError('SITE_CHANGED', 'No hackathon card yielded a machine-readable start date.');
      const hasSentinel = items.some((i) => {
        try {
          return new URL(i.url).pathname === `/hackathons/${SENTINEL_SLUG}`;
        } catch {
          return false;
        }
      });
      if (!hasSentinel) {
        throw new WemakedevsError(
          'SITE_CHANGED',
          `Sentinel hackathon "${SENTINEL_SLUG}" is missing from the listing.`,
          { hint: `If that event was retired, set HEALTH_SENTINEL_SLUG to a current event slug.` },
        );
      }
      return `${items.length} events parsed (${source}); ${withDates} with ISO dates; sentinel "${SENTINEL_SLUG}" present`;
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

  if (wanted.has('hackathon-schedule')) {
    checks.push(timed('hackathon-schedule', false, async () => {
      const url = `${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}/schedule`;
      const html = await getHtml(url, opts);
      const items = parseSchedule(html);
      if (items.length < 4) throw new WemakedevsError('SITE_CHANGED', `Only ${items.length} schedule milestones parsed (expected ≥ 4).`);
      const withDates = items.filter((i) => i.date).length;
      if (withDates === 0) throw new WemakedevsError('SITE_CHANGED', 'No schedule milestone carries a machine-readable <time datetime>.');
      return `${items.length} milestones; ${withDates} with ISO dates; first="${items[0].title}"`;
    }));
  }

  if (wanted.has('hackathon-resources')) {
    checks.push(timed('hackathon-resources', false, async () => {
      const url = `${WEMMAKEDEVS_ORIGIN}/hackathons/${SENTINEL_SLUG}/resources`;
      const html = await getHtml(url, opts);
      const page = parseResources(html, WEMMAKEDEVS_ORIGIN);
      const links = page.groups.reduce((n, g) => n + g.links.length, 0);
      if (page.groups.length < 3) throw new WemakedevsError('SITE_CHANGED', `Only ${page.groups.length} resource group(s) parsed (expected ≥ 3).`);
      if (links < 8) throw new WemakedevsError('SITE_CHANGED', `Only ${links} resource links parsed (expected ≥ 8).`);
      return `${page.groups.length} groups; ${links} links; ${page.commands.length} CLI snippet(s)`;
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
      if (items.length === 0 && !/no (?:upcoming )?meetups|check back|nothing scheduled/i.test(html)) {
        throw new WemakedevsError('SITE_CHANGED', 'Zero meetups parsed and the page shows no explicit empty state.');
      }
      return `${items.length} meetup(s) parsed${items.length === 0 ? ' (valid empty state)' : '; all cards have title+url'}`;
    }));
  }

  if (wanted.has('careers')) {
    checks.push(timed('careers', false, async () => {
      const html = await getHtml(`${WEMMAKEDEVS_ORIGIN}/careers`, opts);
      const items = parseCareers(html);
      if (items.length === 0 && !/No open roles right now|check back soon/i.test(html)) {
        throw new WemakedevsError('SITE_CHANGED', 'Zero roles parsed and the page shows no explicit empty state.');
      }
      return items.length === 0
        ? '0 open roles (page shows an empty state — valid, not a failure)'
        : `${items.length} open role(s): ${items.map((i) => i.title).join(', ')}`;
    }));
  }

  if (wanted.has('scholarships')) {
    checks.push(timed('scholarships', false, async () => {
      const html = await getHtml(`${WEMMAKEDEVS_ORIGIN}/scholarships`, opts);
      const info = parseScholarships(html);
      if (!info.program) throw new WemakedevsError('SITE_CHANGED', 'Could not identify the scholarship program name.');
      if (info.covers.length === 0) throw new WemakedevsError('SITE_CHANGED', 'Could not parse the "What it covers" list.');
      if (info.faqs.length === 0) throw new WemakedevsError('SITE_CHANGED', 'Could not parse any scholarship FAQs.');
      const answers = info.faqs.filter((f) => f.answer).length;
      return `program="${(info.program ?? '(none)').slice(0, 60)}"; status=${info.status}; ${info.covers.length} coverage items; ${info.winners.length} past winners; ${info.faqs.length} FAQ questions; ${answers} answers exposed by Fetch`;
    }));
  }

  if (wanted.has('blog-rss')) {
    checks.push(timed('blog-rss', false, async () => {
      let xml: string;
      try {
        xml = await getHtml(RSS_URL, opts, ['rss']);
      } catch {
        // Some fetches reject an XML selector scope; read the raw document instead.
        xml = await getHtml(RSS_URL, opts, null);
      }
      const posts = parseBlogRss(xml);
      const typedDates = posts.filter((p) => p.pubDate && !Number.isNaN(Date.parse(p.pubDate))).length;
      if (typedDates === 0) throw new WemakedevsError('SITE_CHANGED', 'RSS items carry no parseable pubDate.');
      return `${posts.length} posts; ${typedDates} with parseable pubDate; newest="${posts[0]?.title.slice(0, 60)}"`;
    }));
  }

  const results = await Promise.all(checks);
  const ok = results.every((r) => r.ok || r.soft);
  const mode = opts.offline ? 'offline' : process.env.TINYFISH_FETCH_BASE_URL ? 'stub' : 'live';
  return { ok, mode, checkedAt: new Date().toISOString(), results };
}
