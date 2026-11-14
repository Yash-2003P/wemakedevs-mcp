import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { WemakedevsError } from './errors.js';

export const WEMMAKEDEVS_ORIGIN = 'https://www.wemakedevs.org';
export const WEMMAKEDEVS_ARCHIVE_ORIGIN = 'https://archive.wemakedevs.org';

export function absoluteUrl(href: string | undefined, origin: string = WEMMAKEDEVS_ORIGIN): string | null {
  if (!href) return null;
  const t = href.trim();
  if (t === '') return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('//')) return 'https:' + t;
  if (t.startsWith('/')) return origin + t;
  return null;
}

function cleanText(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

// ---------- Hackathons ----------

export type HackathonStatus = 'upcoming' | 'ongoing' | 'past' | 'unknown';

export interface HackathonSummary {
  title: string;
  url: string;
  location: string | null;
  formats: string[];
  kind: 'online' | 'in-person' | 'hybrid' | 'unknown';
  prize: string | null;
  dateText: string | null;
  startDate: string | null;
  endDate: string | null;
  status: HackathonStatus;
  external: boolean;
}

export function hackathonKind(formats: string[]): HackathonSummary['kind'] {
  const f = new Set(formats.map((x) => x.toLowerCase()));
  const online = f.has('online');
  const offline = f.has('offline') || f.has('in-person') || f.has('in_person');
  if (online && offline) return 'hybrid';
  if (online) return 'online';
  if (offline) return 'in-person';
  return 'unknown';
}

function parseEndInclusive(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return NaN;
  // Date-only values mean "through the end of that day", not midnight.
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? t + 86_400_000 - 1 : t;
}

export function computeStatus(startDate: string | null, endDate: string | null, now: Date = new Date()): HackathonStatus {
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? parseEndInclusive(endDate) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return 'unknown';
  const t = now.getTime();
  if (!Number.isNaN(start) && t < start) return 'upcoming';
  if (!Number.isNaN(end) && t > end) return 'past';
  return 'ongoing';
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function monthIndex(name: string): number {
  return MONTH_INDEX[name.slice(0, 3).toLowerCase()] ?? -1;
}

function isoUtc(year: number, month: number, day: number): string {
  // Date.UTC normalizes overflow/underflow (day 0 = last day of previous month).
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/**
 * Parse the display date on a server-rendered event card, e.g.
 *   "Nov 25", "Nov 9–10", "Sep 30 – Oct 31", "December 15–21, 2025", "February 2026".
 * The site prints a year only for events outside the current year, so a missing
 * year is assumed to be the current year.
 */
export function parseDisplayDate(
  input: string,
  now: Date = new Date(),
): { startDate: string | null; endDate: string | null } {
  const text = cleanText(input).replace(/[\u2013\u2014\u2212]/g, '-');
  if (!text) return { startDate: null, endDate: null };
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const explicitYear = yearMatch ? Number(yearMatch[1]) : null;
  const withoutYear = yearMatch ? text.replace(yearMatch[0], ' ') : text;
  const monthRe =
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s*(\d{1,2})?/gi;
  const matches = [...withoutYear.matchAll(monthRe)];
  if (matches.length === 0) return { startDate: null, endDate: null };

  const m1 = monthIndex(matches[0][1]);
  if (m1 < 0) return { startDate: null, endDate: null };
  const year = explicitYear ?? now.getUTCFullYear();

  // Month-only range, e.g. "February 2026".
  if (matches.length === 1 && matches[0][2] === undefined) {
    return { startDate: isoUtc(year, m1, 1), endDate: isoUtc(year, m1 + 1, 0) };
  }

  const d1 = matches[0][2] ? Number(matches[0][2]) : 1;
  let m2 = m1;
  let d2 = d1;
  if (matches.length >= 2 && matches[1][2] !== undefined) {
    m2 = monthIndex(matches[1][1]);
    d2 = Number(matches[1][2]);
  } else {
    // Same-month range: "Nov 9–10" → the bare second day follows the first match.
    const after = withoutYear.slice((matches[0].index ?? 0) + matches[0][0].length);
    const bare = after.match(/^\s*-\s*(\d{1,2})\b/);
    if (bare) d2 = Number(bare[1]);
  }
  if (m2 < 0) return { startDate: null, endDate: null };

  let y1 = year;
  let y2 = year;
  if (m2 < m1) {
    if (explicitYear) {
      // Year written at the end applies to the closing date: "Dec 29 – Jan 2, 2026".
      y1 = explicitYear - 1;
      y2 = explicitYear;
    } else {
      y2 = year + 1;
    }
  }
  return { startDate: isoUtc(y1, m1, d1), endDate: isoUtc(y2, m2, d2) };
}

/** DOM fallback: read the server-rendered event cards (Fetch strips scripts). */
function parseHackathonCardsDom(html: string, origin: string, now: Date): HackathonSummary[] {
  const $ = cheerio.load(html);
  const items: HackathonSummary[] = [];
  $('a[href]').each((_, a) => {
    const $a = $(a);
    const h3 = $a.find('h3').first();
    if (!h3.length) return; // event cards always carry an <h3>; skips nav/footer links
    const chips = $a
      .find('span.translate-y-\\[1px\\]')
      .map((_, s) => cleanText($(s).text()))
      .get()
      .filter(Boolean);
    const dateText = chips.find((c) => /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i.test(c)) ?? null;
    if (!dateText) return; // not an event card
    const title = cleanText(h3.text());
    const url = absoluteUrl($a.attr('href'), origin);
    if (!title || !url) return;
    const location = chips.find((c) => c !== dateText) ?? null;
    const loc = (location ?? '').toLowerCase();
    const kind: HackathonSummary['kind'] =
      loc.includes('remote') || loc.includes('online')
        ? 'online'
        : loc.includes('hybrid')
          ? 'hybrid'
          : location
            ? 'in-person'
            : 'unknown';
    const formats =
      kind === 'online' ? ['online'] : kind === 'hybrid' ? ['online', 'offline'] : kind === 'in-person' ? ['offline'] : [];
    const prize = cleanText($a.find('p').first().text()) || null;
    const { startDate, endDate } = parseDisplayDate(dateText, now);
    const host = (() => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    items.push({
      title,
      url,
      location,
      formats,
      kind,
      prize,
      dateText,
      startDate,
      endDate,
      status: computeStatus(startDate, endDate, now),
      external: !host.endsWith('wemakedevs.org'),
    });
  });
  return items;
}

export interface HackathonParseResult {
  items: HackathonSummary[];
  /** Kept in the public shape for compatibility; TinyFish Fetch strips scripts, so this is always DOM. */
  source: 'dom';
}

export function parseHackathons(html: string, origin: string = WEMMAKEDEVS_ORIGIN, now: Date = new Date()): HackathonParseResult {
  let items = parseHackathonCardsDom(html, origin, now);
  // De-duplicate by url, preserving order.
  const seen = new Set<string>();
  items = items.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
  if (items.length === 0) {
    throw new WemakedevsError('SITE_CHANGED', 'No hackathon cards found on the listing page.', {
      url: origin + '/hackathons',
      hint: 'The page structure likely changed. Run `npm run health` and report the failure output.',
    });
  }
  return { items, source: 'dom' };
}

// ---------- Meetups ----------

export interface MeetupSummary {
  title: string;
  url: string;
  location: string | null;
  dateText: string | null;
  description: string | null;
}

export function parseMeetups(html: string, origin: string = WEMMAKEDEVS_ORIGIN): MeetupSummary[] {
  const $ = cheerio.load(html);
  const items: MeetupSummary[] = [];
  $('a[href]').each((_, a) => {
    const $a = $(a);
    const h3 = $a.find('h3').first();
    if (!h3.length) return; // skip nav/footer links
    const img = $a.find('img').first();
    const title = cleanText(h3.text()) || cleanText(img.attr('alt'));
    if (!title) return;
    const url = absoluteUrl($a.attr('href'), origin);
    if (!url) return;
    const chips = $a.find('span.translate-y-\\[1px\\]').map((_, s) => cleanText($(s).text())).get().filter(Boolean);
    const description = cleanText($a.find('p').first().text()) || null;
    // Chips are [location/venue, date] in source order on this page.
    const location = chips[0] ?? null;
    const dateText = chips.length > 1 ? chips[chips.length - 1] : null;
    items.push({ title, url, location, dateText, description });
  });
  const seen = new Set<string>();
  return items.filter((x) => (seen.has(x.url + x.title) ? false : (seen.add(x.url + x.title), true)));
  // Zero meetups listed is a valid state (nothing scheduled right now), not a breakage.
}

// ---------- Careers ----------

export interface CareerRole {
  title: string;
  url: string;
  postedAt: string | null;
  tags: string[];
  location: string | null;
  kind: string | null;
  compensation: string | null;
}

const COMP_RE = /(₹|\$|€|£)|per\s+(month|year|hour)|a\s+year|lpa|stipend/i;
const KIND_RE = /^(internship|full[- ]?time|part[- ]?time|contract|fellowship)/i;

export function parseCareers(html: string, origin: string = WEMMAKEDEVS_ORIGIN): CareerRole[] {
  const $ = cheerio.load(html);
  const items: CareerRole[] = [];
  $('a[href]').each((_, a) => {
    const $a = $(a);
    const href = $a.attr('href') ?? '';
    if (!href.startsWith('/careers/')) return;
    const h3 = $a.find('h3').first();
    if (!h3.length) return;
    const title = cleanText(h3.text());
    const url = absoluteUrl(href, origin);
    if (!title || !url) return;
    const postedAt = $a.find('time[datetime]').attr('datetime') ?? null;
    const tags = $a.find('ul li span').map((_, s) => cleanText($(s).text())).get().filter(Boolean);
    const compensation = tags.find((t) => COMP_RE.test(t)) ?? null;
    const kind = tags.find((t) => KIND_RE.test(t)) ?? null;
    const location = tags.find((t) => t !== compensation && t !== kind) ?? null;
    items.push({ title, url, postedAt, tags, location, kind, compensation });
  });
  if (items.length === 0) {
    const bodyText = cleanText($('body').text());
    const emptyState = /(no open roles|0 open roles|not hiring right now|nothing open right now)/i.test(bodyText);
    if (!emptyState) {
      throw new WemakedevsError('SITE_CHANGED', 'No open roles found on the careers page.', {
        url: origin + '/careers',
        hint: 'Either the markup changed or the empty-state copy changed. Check the page; see `npm run health`.',
      });
    }
  }
  return items;
}

// ---------- Shared: section AST for detail / legal pages ----------

export interface SectionBlock {
  type: 'heading' | 'paragraph' | 'list' | 'pre';
  text?: string;
  level?: number;
  items?: string[];
  truncated?: boolean;
}

export interface PageSection {
  id: string;
  heading: string | null;
  blocks: SectionBlock[];
}

export interface SectionAst {
  title: string | null;
  sections: PageSection[];
  links: Array<{ text: string; href: string }>;
}

const TEXT_CAP = 4000;
const BLOCK_CAP = 120;

function cap(text: string): { text: string; truncated?: true } {
  if (text.length <= TEXT_CAP) return { text };
  return { text: text.slice(0, TEXT_CAP) + '…', truncated: true };
}

function extractFaqItems($: CheerioAPI, root: cheerio.Cheerio<any>): Array<{ question: string; answer: string }> {
  const faqs: Array<{ question: string; answer: string }> = [];
  const seen = new Set<string>();
  const push = (q: string, a: string) => {
    const key = q.toLowerCase();
    if (!q || !a || seen.has(key)) return;
    seen.add(key);
    faqs.push({ question: q, answer: a });
  };
  // Native <details>/<summary> (hackathon detail pages)
  root.find('details').each((_, d) => {
    const $d = $(d);
    const q = cleanText($d.find('summary').first().text());
    const answerClone = $d.clone();
    answerClone.find('summary').remove();
    push(q, cleanText(answerClone.text()));
  });
  // Radix accordion (scholarships page): <button aria-controls> + hidden region
  root.find('button[aria-controls]').each((_, b) => {
    const $b = $(b);
    const id = $b.attr('aria-controls');
    if (!id) return;
    const q = cleanText($b.text());
    const panel = root.find(`[id="${id.replace(/"/g, '\\"')}"]`).first();
    push(q, cleanText(panel.text()));
  });
  return faqs;
}

export function parseSectionAst(html: string, origin: string = WEMMAKEDEVS_ORIGIN, opts: { maxBlocks?: number } = {}): SectionAst {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, footer, header, form').remove();
  const main = $('main').first();
  const root = main.length ? main : $('body');
  if (!root.length) {
    throw new WemakedevsError('SITE_CHANGED', 'No <main> or <body> content found.', { url: origin });
  }
  const title = cleanText(root.find('h1').first().text()) || null;
  const maxBlocks = opts.maxBlocks ?? BLOCK_CAP;

  const links: Array<{ text: string; href: string }> = [];
  root.find('a[href]').each((_, a) => {
    if (links.length >= 100) return;
    const t = cleanText($(a).text());
    const href = absoluteUrl($(a).attr('href'), origin);
    if (t && href) links.push({ text: t.slice(0, 120), href });
  });

  const sections: PageSection[] = [];
  const sectionEls = root.find('section[id]').toArray();
  const pushSection = (id: string, el: unknown) => {
    const s$ = $(el as never);
    const heading = cleanText(s$.find('h1,h2,h3').first().text()) || null;
    const blocks: SectionBlock[] = [];
    s$.find('h2,h3,h4,p,li,pre').each((_, node) => {
      if (blocks.length >= maxBlocks) return;
      const el2 = node as { tagName?: string };
      const tag = (el2.tagName ?? '').toLowerCase();
      const text = cleanText($(node as never).text());
      if (!text) return;
      if (/^h[234]$/.test(tag)) {
        blocks.push({ type: 'heading', level: Number(tag[1]), ...cap(text) });
      } else if (tag === 'p') {
        blocks.push({ type: 'paragraph', ...cap(text) });
      } else if (tag === 'li') {
        blocks.push({ type: 'list', items: [cap(text).text], truncated: text.length > TEXT_CAP ? true : undefined });
      } else if (tag === 'pre') {
        blocks.push({ type: 'pre', ...cap(text) });
      }
    });
    // Merge consecutive single-item list blocks.
    const merged: SectionBlock[] = [];
    for (const b of blocks) {
      const last = merged[merged.length - 1];
      if (b.type === 'list' && last?.type === 'list') {
        last.items = [...(last.items ?? []), ...(b.items ?? [])];
      } else {
        merged.push(b);
      }
    }
    sections.push({ id, heading, blocks: merged });
  };

  if (sectionEls.length > 0) {
    for (const el of sectionEls) pushSection($(el).attr('id') ?? 'section', el);
  } else {
    pushSection('content', root.get(0));
  }
  return { title, sections, links };
}

export function parseFaq(html: string): Array<{ question: string; answer: string }> {
  const $ = cheerio.load(html);
  const main = $('main').first();
  return extractFaqItems($, main.length ? main : $('body'));
}

// ---------- Scholarships ----------

export interface ScholarshipInfo {
  program: string | null;
  status: 'open' | 'closed' | 'unknown';
  statusText: string | null;
  covers: Array<{ name: string; detail: string | null }>;
  winners: Array<{ name: string; event: string | null; profileUrl: string | null }>;
  faqs: Array<{ question: string; answer: string | null }>;
}

export function parseScholarships(html: string): ScholarshipInfo {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const bodyText = cleanText($('body').text());

  const closedMatch = bodyText.match(/Applications?\s+for\s+([^.]{5,200}?)\s+are\s+now\s+closed/i);
  const openMatch = bodyText.match(/Applications?\s+for\s+([^.]{5,200}?)\s+are\s+(?:now\s+)?open/i);
  const status = closedMatch ? 'closed' : openMatch ? 'open' : 'unknown';
  const statusText = cleanText((closedMatch ?? openMatch)?.[0] ?? null) || null;

  const program = cleanText($('h1').first().text()) || null;

  // Covers: h3 headings between the "What it covers" h2 and the next h2.
  const covers: ScholarshipInfo['covers'] = [];
  let coversActive = false;
  for (const el of $('h2, h3').toArray()) {
    const tag = (el as unknown as { tagName?: string }).tagName?.toUpperCase();
    const text = cleanText($(el).text());
    if (tag === 'H2') {
      coversActive = /what it covers/i.test(text);
      continue;
    }
    if (tag === 'H3' && coversActive && text) {
      const detail =
        cleanText($(el).parent().find('p').first().text()) ||
        cleanText($(el).nextAll('p').first().text()) ||
        null;
      covers.push({ name: text, detail });
    }
  }
  if (covers.length === 0) {
    throw new WemakedevsError('SITE_CHANGED', 'Could not find the "What it covers" section on the scholarships page.', {
      url: WEMMAKEDEVS_ORIGIN + '/scholarships',
      hint: 'The page structure likely changed. Run `npm run health` and report the failure output.',
    });
  }

  // Previous winners: cards with <img alt="Name profile photo">.
  const winners: ScholarshipInfo['winners'] = [];
  $('img[alt$=" profile photo"]').each((_, img) => {
    const alt = cleanText($(img).attr('alt'));
    const name = alt.replace(/\s+profile photo$/i, '');
    if (!name) return;
    const card = $(img).closest('div').parent();
    const profileUrl = card.find('a[href*="linkedin.com"]').first().attr('href') ?? null;
    // Event: last paragraph-like text in the card that is not the name.
    let event = cleanText(card.find('p').last().text()) || null;
    if (event === name) event = null;
    if (!event) {
      const txt = cleanText(card.text()).replace(name, '').trim();
      event = txt || null;
    }
    winners.push({ name, event, profileUrl });
  });

  const faqs = extractScholarshipFaqs(html, $);
  return { program, status, statusText, covers, winners, faqs };
}

// ---------- Hackathon detail meta strip ----------

export interface HackathonMeta {
  prizePool: string | null;
  when: string | null;
  where: string | null;
  teams: string | null;
}

export function extractHackathonMeta(html: string): HackathonMeta {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const t = cleanText($('body').text());
  // The hero meta strip reads "When<date>Where<place>Teams<teams>Prize pool<amount>".
  // Search strictly forward so earlier page chrome (e.g. "Microsoft Teams") can't confuse the scan.
  const iWhen = t.indexOf('When');
  const iWhere = iWhen === -1 ? -1 : t.indexOf('Where', iWhen + 4);
  const iTeams = iWhere === -1 ? -1 : t.indexOf('Teams', iWhere + 5);
  const iPrize = iTeams === -1 ? -1 : t.indexOf('Prize pool', iTeams + 5);
  const slice = (a: number, b: number): string | null => {
    if (a === -1 || b === -1 || b <= a) return null;
    const v = cleanText(t.slice(a, b));
    return v && v.length <= 80 ? v : null;
  };
  const prizeWindow = iPrize === -1 ? '' : t.slice(iPrize, iPrize + 120);
  const prizeMatch = prizeWindow.match(/Prize\s+pool\s*([$₹€£][0-9][0-9,\.]*(?:\s?(?:k|K|Lakh|lakh|Crore|crore|Cr|cr|M|million))?\+?)/);
  return {
    prizePool: prizeMatch?.[1] ?? null,
    when: slice(iWhen === -1 ? -1 : iWhen + 4, iWhere),
    where: slice(iWhere === -1 ? -1 : iWhere + 5, iTeams),
    teams: slice(iTeams === -1 ? -1 : iTeams + 5, iPrize),
  };
}

// ---------- Scholarships: Radix accordion answers ----------
// The answer regions render empty and their bodies are client-rendered. Live
// Fetch strips scripts, so `answer` is normally null. This best-effort parser
// still recovers answers from raw snapshots that retain the RSC flight payload.
export function extractScholarshipFaqs(html: string, $: CheerioAPI): Array<{ question: string; answer: string | null }> {
  const questions: string[] = [];
  $('button[aria-controls]').each((_, b) => {
    const q = cleanText($(b).text());
    if (q) questions.push(q);
  });
  return questions.map((question) => {
    let idx = -1;
    while ((idx = html.indexOf(question, idx + 1)) !== -1) {
      const seg = html.slice(idx, idx + 8000);
      const m = seg.match(/\\"__html\\":\\"(.*?)\\"/s);
      if (!m) continue;
      try {
        const raw = JSON.parse('"' + m[1] + '"') as string;
        const answer = cheerio.load('<div>' + raw + '</div>').root().text().replace(/\s+/g, ' ').trim();
        return { question, answer: answer || null };
      } catch {
        return { question, answer: null };
      }
    }
    return { question, answer: null };
  });
}

// ---------- Blog (RSS feed) ----------

export interface BlogPostSummary {
  title: string;
  url: string;
  pubDate: string | null;
  description: string | null;
  author: string | null;
  categories: string[];
}

function decodeEntities(s: string): string {
  if (!s || !s.includes('&')) return s;
  return cheerio.load(`<div>${s}</div>`)('div').first().text();
}

function rssTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? cleanText(decodeEntities(m[1])) : null;
}

function rssLink(block: string): string | null {
  // Fetch serializes RSS <link> as an HTML void element: "<link/>https://…".
  const selfClosing = block.match(/<link\b[^>]*\/>\s*(https?:\/\/[^\s<]+)/i);
  if (selfClosing) return selfClosing[1];
  const paired = rssTag(block, 'link');
  if (paired && /^https?:\/\//i.test(paired)) return paired;
  const guid = rssTag(block, 'guid');
  if (guid && /^https?:\/\//i.test(guid)) return guid;
  return null;
}

export function parseBlogRss(xml: string): BlogPostSummary[] {
  if (typeof xml !== 'string' || !(/<rss[\s>]/.test(xml) || xml.includes('<channel'))) {
    throw new WemakedevsError('SITE_CHANGED', 'The blog RSS feed did not return an <rss> document.', {
      url: 'https://www.wemakedevs.org/blogs/rss.xml',
    });
  }
  const blocks = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const items: BlogPostSummary[] = [];
  for (const block of blocks) {
    const title = rssTag(block, 'title');
    const url = rssLink(block);
    if (!title || !url) continue;
    const pubDate = rssTag(block, 'pubdate') ?? rssTag(block, 'pubDate');
    const description = rssTag(block, 'description');
    const author = rssTag(block, 'dc:creator');
    const categories = [...block.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)]
      .map((m) => cleanText(decodeEntities(m[1])))
      .filter(Boolean);
    items.push({ title, url, pubDate, description, author, categories });
  }
  if (items.length === 0) {
    throw new WemakedevsError('SITE_CHANGED', 'The blog RSS feed parsed but contained no <item> entries.', {
      url: 'https://www.wemakedevs.org/blogs/rss.xml',
    });
  }
  return items;
}

export interface BlogPost extends BlogPostSummary {
  paragraphs: string[];
  links: Array<{ text: string; href: string }>;
}

export function parseBlogPost(html: string, url: string): BlogPost {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, footer, header').remove();
  const main = $('main').first();
  const root = main.length ? main : $('body');
  const title = cleanText(root.find('h1').first().text()) || 'Untitled';
  const publishedAt = root.find('time[datetime]').attr('datetime') ?? null;
  // Article body is the cleanest scope; fall back to <main> for older layouts.
  const article = root.find('article').first();
  const body = article.length ? article : root;
  const paragraphs = body.find('p').map((_, p) => cleanText($(p).text())).get()
    .filter((t) => t.length > 40).slice(0, 150);
  const links: Array<{ text: string; href: string }> = [];
  body.find('a[href]').each((_, a) => {
    if (links.length >= 100) return;
    const t = cleanText($(a).text());
    const href = absoluteUrl($(a).attr('href'), url);
    if (t && href) links.push({ text: t.slice(0, 120), href });
  });
  return {
    title,
    url,
    pubDate: publishedAt,
    description: null,
    author: null,
    categories: [],
    paragraphs,
    links,
  };
}

// ---------- Hackathon schedule page ----------

export interface ScheduleMilestone {
  whenText: string;
  date: string | null;
  title: string;
  detail: string | null;
  state: 'explicit-date' | 'marker';
}

export function parseSchedule(html: string): ScheduleMilestone[] {
  const $ = cheerio.load(html);
  const items: ScheduleMilestone[] = [];
  // The schedule page also renders a demo chat transcript as <ol>/<li>. Timeline
  // items are the ones whose first <p> is the mono date/marker column.
  $('ol > li').each((_, li) => {
    const $li = $(li);
    const ps = $li.children('p');
    if (ps.length < 2) return;
    const first = ps.eq(0);
    const time = first.find('time[datetime]').attr('datetime') ?? null;
    const isTimeline = time !== null || first.hasClass('font-mono');
    if (!isTimeline) return;
    const whenText = cleanText(first.text());
    const title = cleanText(ps.eq(1).text());
    const detail = ps.length >= 3 ? cleanText(ps.eq(2).text()) || null : null;
    if (!title || !whenText) return;
    items.push({ whenText, date: time, title, detail, state: time ? 'explicit-date' : 'marker' });
  });
  if (items.length === 0) {
    throw new WemakedevsError('SITE_CHANGED', 'No schedule milestones found on the schedule page.', {
      hint: 'The <ol> layout likely changed. Run `npm run health`.',
    });
  }
  return items;
}

// ---------- Hackathon resources page ----------

export interface ResourceLink {
  group: string;
  label: string;
  url: string;
  note: string | null;
}

export interface ResourcesPage {
  title: string | null;
  groups: Array<{ name: string; links: Array<{ label: string; url: string; note: string | null }> }>;
  commands: string[];
}

export function parseResources(html: string, origin: string = WEMMAKEDEVS_ORIGIN): ResourcesPage {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const root = $('main').first().length ? $('main').first() : $('body');
  const title = cleanText(root.find('h1').first().text()) || cleanText($('title').text()) || null;

  const groups: ResourcesPage['groups'] = [];
  // Group headings are h3.font-mono followed by a <ul> of links.
  root.find('h3').each((_, h3) => {
    const name = cleanText($(h3).text());
    if (!name) return;
    const ul = $(h3).nextAll('ul').first();
    if (!ul.length) return;
    const links: Array<{ label: string; url: string; note: string | null }> = [];
    ul.find('li').each((_, li) => {
      const a = $(li).find('a[href]').first();
      const href = absoluteUrl(a.attr('href'), origin);
      const label = cleanText(a.text());
      if (!href || !label) return;
      const note = cleanText($(li).find('p').first().text()) || null;
      links.push({ label, url: href, note });
    });
    if (links.length) groups.push({ name, links });
  });

  // CLI one-liners (e.g. `claude mcp add switch-docs ...`) live in <pre>/<code>.
  const commands: string[] = [];
  root.find('pre, code').each((_, el) => {
    const t = cleanText($(el).text());
    if (/(mcp add|npx|npm|curl|claude)\b/i.test(t) && t.length < 300) commands.push(t);
  });

  if (groups.length === 0) {
    throw new WemakedevsError('SITE_CHANGED', 'No resource groups with links found on the resources page.', {
      hint: 'The page structure likely changed. Run `npm run health`.',
    });
  }
  return { title, groups, commands: [...new Set(commands)].slice(0, 20) };
}
