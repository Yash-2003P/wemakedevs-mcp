import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { extractFlightCards, type FlightCard } from './extract.js';
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

export function computeStatus(startDate: string | null, endDate: string | null, now: Date = new Date()): HackathonStatus {
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? Date.parse(endDate) : NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return 'unknown';
  const t = now.getTime();
  if (!Number.isNaN(start) && t < start) return 'upcoming';
  if (!Number.isNaN(end) && t > end) return 'past';
  return 'ongoing';
}

function cardToSummary(card: FlightCard, origin: string, now: Date): HackathonSummary | null {
  const title = cleanText(card.title);
  const url = absoluteUrl(card.href ?? undefined, origin);
  if (!title || !url) return null;
  const formats = (card.formats ?? []).map((f) => String(f));
  const startDate = card.startDate ?? null;
  const endDate = card.endDate ?? null;
  return {
    title,
    url,
    location: cleanText(card.location) || null,
    formats,
    kind: hackathonKind(formats),
    prize: cleanText(card.prize) || null,
    dateText: cleanText(card.date) || null,
    startDate,
    endDate,
    status: computeStatus(startDate, endDate, now),
    external: Boolean(card.isExternal),
  };
}

/** DOM fallback: list cards when flight data is unavailable (scripts stripped). */
function parseHackathonCardsDom(html: string, origin: string, now: Date): HackathonSummary[] {
  const $ = cheerio.load(html);
  const items: HackathonSummary[] = [];
  $('a[href]').each((_, a) => {
    const $a = $(a);
    const h3 = $a.find('h3').first();
    const img = $a.find('img').first();
    const title = cleanText(h3.text()) || cleanText(img.attr('alt'));
    if (!title) return;
    const url = absoluteUrl($a.attr('href'), origin);
    if (!url) return;
    // Only event-card links: must carry an image or an h3 heading.
    if (!img.length && !h3.length) return;
    const text = cleanText($a.text());
    const kindMatch = text.match(/\b(Hybrid|Remote|Online|In person)\b/i);
    const locMatch = text.match(/\b(Remote|Online|Hybrid)\b/) || null;
    items.push({
      title,
      url,
      location: locMatch ? locMatch[0] : kindMatch ? kindMatch[0] : null,
      formats: [],
      kind: 'unknown',
      prize: null,
      dateText: null,
      startDate: null,
      endDate: null,
      status: 'unknown',
      external: !url.startsWith(origin),
    });
  });
  return items;
}

export interface HackathonParseResult {
  items: HackathonSummary[];
  source: 'embedded-json' | 'dom';
}

export function parseHackathons(html: string, origin: string = WEMMAKEDEVS_ORIGIN, now: Date = new Date()): HackathonParseResult {
  const cards = extractFlightCards(html);
  const source: HackathonParseResult['source'] = cards ? 'embedded-json' : 'dom';
  let items: HackathonSummary[];
  if (cards) {
    items = cards.map((c) => cardToSummary(c, origin, now)).filter((x): x is HackathonSummary => x !== null);
  } else {
    items = parseHackathonCardsDom(html, origin, now);
  }
  // De-duplicate by url, preserving order.
  const seen = new Set<string>();
  items = items.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
  if (items.length === 0) {
    throw new WemakedevsError('SITE_CHANGED', 'No hackathon cards found on the listing page.', {
      url: origin + '/hackathons',
      hint: 'The page structure likely changed. Run `npm run health` and report the failure output.',
    });
  }
  return { items, source };
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
  const out = items.filter((x) => (seen.has(x.url + x.title) ? false : (seen.add(x.url + x.title), true)));
  if (out.length === 0) {
    throw new WemakedevsError('SITE_CHANGED', 'No meetup cards found on the meetups page.', {
      url: origin + '/meetups',
      hint: 'The page structure likely changed. Run `npm run health` and report the failure output.',
    });
  }
  return out;
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

// ---------- Scholarships: Radix accordion answers from RSC flight data ----------
// The Radix answer regions render empty; the answers live in the flight payload
// as dangerouslySetInnerHTML.__html. We locate each question button, then grab
// the next \_\_html blob. Answers come back as decoded plain text or null.
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
