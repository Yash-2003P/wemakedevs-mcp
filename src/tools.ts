import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { WemakedevsError } from './errors.js';
import { fetchPages, runAgent } from './tinyfish.js';
import {
  WEMMAKEDEVS_ORIGIN,
  extractHackathonMeta,
  parseBlogPost,
  parseBlogRss,
  parseCareers,
  parseFaq,
  parseHackathons,
  parseMeetups,
  parseResources,
  parseSchedule,
  parseScholarships,
  parseSectionAst,
  type BlogPostSummary,
} from './parse.js';
import { ALLOWED_WEMAKEDEVS_HOSTS, resolveHackathonUrl, originOf } from './util.js';
import { diffHackathons, loadSnapshot, saveSnapshot, snapshotFrom } from './diff.js';
import { runHealthChecks, ALL_TARGETS, type HealthTarget } from './health.js';
import {
  BlogListSchema,
  BlogPostSchema,
  CareerListSchema,
  DeadlinesSchema,
  HackathonChangesSchema,
  ResourcesSchema,
  ScheduleSchema,
  UpdatesSchema,
  HackathonDetailSchema,
  HackathonListSchema,
  MeetupListSchema,
  RegistrationStatusSchema,
  RulesSchema,
  ScholarshipSchema,
  HealthReportSchema,
} from './schemas.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const asStructured = (obj: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
  structuredContent: obj as Record<string, unknown>,
});

const asError = (err: unknown): ToolResult => {
  const e =
    err instanceof WemakedevsError
      ? err
      : new WemakedevsError('PARSE_FAILED', String(err instanceof Error ? err.message : err));
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: e.toJSON() }, null, 2) }],
  };
};

const wrap =
  <A extends Record<string, unknown>>(schema: z.ZodType, fn: (args: A) => Promise<unknown>) =>
  async (args: A): Promise<ToolResult> => {
    try {
      const data = await fn(args);
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        throw new WemakedevsError('SITE_CHANGED', 'Tool output failed schema validation.', {
          hint: `Issues: ${parsed.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; ')}. Run \`npm run health\` and report this output.`,
        });
      }
      return asStructured(parsed.data);
    } catch (err) {
      return asError(err);
    }
  };

const RSS_URL = `${WEMMAKEDEVS_ORIGIN}/blogs/rss.xml`;

interface FetchHtmlOptions {
  /** CSS selectors to fetch verbatim (default ['body']). Pass null for the raw document. */
  selectors?: string[] | null;
  minChars?: number;
}

async function fetchHtml(url: string, opts: FetchHtmlOptions = {}): Promise<string> {
  const { selectors = ['body'], minChars = 100 } = opts;
  const out = await fetchPages([url], {
    format: 'html',
    ttl: 0,
    includeSelectors: selectors ?? undefined,
  });
  const text = out.results[0]?.text;
  if (typeof text !== 'string' || text.length < minChars) {
    throw new WemakedevsError('SITE_CHANGED', `Page returned by TinyFish is suspiciously small (${typeof text === 'string' ? text.length : 'non-string'} chars).`, { url });
  }
  return text;
}

/** Fetch the blog RSS raw (XML, not HTML — selector scoping mangles <link> tags). */
async function fetchRss(): Promise<string> {
  return fetchHtml(RSS_URL, { selectors: null, minChars: 200 });
}

function resolveBlogUrl(input: string): string {
  const t = (input ?? '').trim();
  let u: URL;
  try {
    u = /^https?:\/\//i.test(t) ? new URL(t) : new URL(WEMMAKEDEVS_ORIGIN + (t.startsWith('/') ? t : `/blogs/${t.replace(/^\/+/, '')}`));
  } catch {
    throw new WemakedevsError('VALIDATION_FAILED', `Malformed blog URL or slug: ${t}`);
  }
  if (!ALLOWED_WEMAKEDEVS_HOSTS.has(u.hostname.toLowerCase())) {
    throw new WemakedevsError('VALIDATION_FAILED', `Blog posts live on wemakedevs.org; refusing to fetch ${u.host}.`);
  }
  if (!u.pathname.startsWith('/blogs')) {
    throw new WemakedevsError('VALIDATION_FAILED', `Not a blog path: ${u.pathname}`, { hint: 'Blog URLs look like https://www.wemakedevs.org/blogs/<slug>.' });
  }
  return u.toString();
}

const asOf = () => new Date().toISOString();

function filterBlogPosts(
  items: BlogPostSummary[],
  opts: { tag?: string; search?: string },
): BlogPostSummary[] {
  let out = items;
  if (opts.tag) {
    const tag = opts.tag.toLowerCase();
    out = out.filter((i) => i.categories.some((c) => c.toLowerCase() === tag));
  }
  if (opts.search) {
    const q = opts.search.toLowerCase();
    out = out.filter((i) =>
      [i.title, i.description, i.author, ...i.categories].some((v) => v?.toLowerCase().includes(q)),
    );
  }
  return out;
}

export function registerTools(server: McpServer): void {
  // ---------- list_hackathons ----------
  server.registerTool(
    'list_hackathons',
    {
      title: 'List WeMakeDevs hackathons',
      description:
        'List hackathons run by WeMakeDevs (upcoming, ongoing or past), optionally filtered by format and free-text search. Returns typed summaries with dates and prize text parsed from the live site via TinyFish. Default: upcoming. Events whose dates could not be parsed are included (status="unknown").',
      inputSchema: z.object({
        status: z.enum(['upcoming', 'ongoing', 'past', 'all']).default('upcoming')
          .describe('Which events to return. "ongoing" = happening right now; dates overlap today.'),
        format: z.enum(['online', 'in-person', 'hybrid']).optional()
          .describe('Only events of this format (derived from the site’s own online/offline flags).'),
        search: z.string().max(120).optional()
          .describe('Case-insensitive substring match on title, location and prize text.'),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      outputSchema: HackathonListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(HackathonListSchema, async ({ status, format, search, limit }) => {
      const html = await fetchHtml(`${WEMMAKEDEVS_ORIGIN}/hackathons`);
      const { items, source } = parseHackathons(html);
      let out = items;
      if (format) out = out.filter((i) => i.kind === format);
      if (search) {
        const q = search.toLowerCase();
        out = out.filter((i) => [i.title, i.location, i.prize].some((v) => v?.toLowerCase().includes(q)));
      }
      if (status !== 'all') out = out.filter((i) => i.status === status || i.status === 'unknown');
      out = [...out].sort((a, b) => {
        if (status === 'past') return (b.endDate ?? '').localeCompare(a.endDate ?? '');
        return (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999');
      });
      const slice = out.slice(0, limit);
      const notes: string[] = [
        'Parsed from the rendered event cards (TinyFish Fetch does not expose site scripts); display dates without a year are assumed to be the current year.',
      ];
      if (status !== 'all' && slice.some((i) => i.status === 'unknown')) {
        notes.push('Includes events with unparseable dates (status="unknown").');
      }
      return {
        count: slice.length,
        items: slice,
        source,
        asOf: asOf(),
        note: notes.length ? notes.join(' ') : null,
      };
    }),
  );

  // ---------- get_hackathon ----------
  server.registerTool(
    'get_hackathon',
    {
      title: 'Get hackathon details',
      description:
        'Get the full structured detail of one WeMakeDevs hackathon page: hero meta (prize pool, when/where/teams), all page sections (challenge, prizes, tracks, judging, schedule, contribute…), FAQ and outbound links. Pass a slug ("switch"), a site path, or a full WeMakeDevs URL. Use the `sections` argument to fetch only specific sections by id (e.g. ["prizes","schedule"]) to keep responses small.',
      inputSchema: z.object({
        hackathon: z.string().min(1).max(300)
          .describe('Slug ("switch"), path ("/hackathons/switch") or full URL on a WeMakeDevs host.'),
        sections: z.array(z.string().min(1).max(60)).max(20).optional()
          .describe('Section ids to include, case-insensitive. Omit to get everything.'),
      }),
      outputSchema: HackathonDetailSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(HackathonDetailSchema, async ({ hackathon, sections }) => {
      const url = resolveHackathonUrl(hackathon);
      const html = await fetchHtml(url);
      const ast = parseSectionAst(html, originOf(url));
      const meta = extractHackathonMeta(html);
      const faq = parseFaq(html);
      let outSections = ast.sections;
      if (sections?.length) {
        const wanted = new Set(sections.map((s) => s.toLowerCase()));
        const available = ast.sections.map((s) => s.id);
        const unknown = [...wanted].filter((w) => !available.some((a) => a.toLowerCase() === w));
        if (unknown.length) {
          throw new WemakedevsError('VALIDATION_FAILED', `Unknown section id(s): ${unknown.join(', ')}`, {
            hint: `Available sections: ${available.join(', ')}`,
          });
        }
        outSections = ast.sections.filter((s) => wanted.has(s.id.toLowerCase()));
      }
      return {
        url,
        title: ast.title,
        prizePool: meta.prizePool,
        when: meta.when,
        where: meta.where,
        teams: meta.teams,
        sections: outSections,
        faq,
        links: ast.links,
      };
    }),
  );

  // ---------- get_hackathon_rules ----------
  server.registerTool(
    'get_hackathon_rules',
    {
      title: 'Get hackathon official rules',
      description:
        'Fetch the Official Rules / terms page for a WeMakeDevs hackathon as structured sections (eligibility, exclusions, submissions, prizes, disputes…). Long legal text — read this when the user asks about eligibility, prize claims, or disqualification.',
      inputSchema: z.object({
        hackathon: z.string().min(1).max(300)
          .describe('Slug ("switch"), path or full URL on a WeMakeDevs host.'),
      }),
      outputSchema: RulesSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(RulesSchema, async ({ hackathon }) => {
      const url = resolveHackathonUrl(hackathon).replace(/\/+$/, '');
      const rulesUrl = url.endsWith('/rules') ? url : `${url}/rules`;
      const html = await fetchHtml(rulesUrl);
      const ast = parseSectionAst(html, originOf(rulesUrl));
      return { url: rulesUrl, title: ast.title, sections: ast.sections, links: ast.links };
    }),
  );

  // ---------- check_registration_status ----------
  server.registerTool(
    'check_registration_status',
    {
      title: 'Check hackathon registration status',
      description:
        'Observe the live, client-side registration panel of a WeMakeDevs hackathon page via TinyFish Agent (a real browser). Returns open/closed/upcoming/unknown plus any dates or registered count shown. Read-only: never signs in or registers. Takes 20–120s.',
      inputSchema: z.object({
        hackathon: z.string().min(1).max(300)
          .describe('Slug ("switch"), path or full URL on a WeMakeDevs host.'),
      }),
      outputSchema: RegistrationStatusSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(RegistrationStatusSchema, async ({ hackathon }) => {
      const url = resolveHackathonUrl(hackathon);
      const goal =
        `Open ${url} in a real browser session. The "Registration" panel on the page loads client-side and initially shows "Loading…". ` +
        `Wait for it to resolve (up to ~45 seconds) and report its current state. Read-only: do NOT sign in, register, or click any action buttons — only observe. ` +
        `Set state to exactly one of: "open" (a registration action is available now), "closed" (registration is closed or full), "upcoming" (registration has not opened yet), "unknown" (panel never resolved or ambiguous). ` +
        `opensAt/closesAt: copy the exact dates shown, verbatim (e.g. "Nov 4, 2026, 12:01 AM IST"), or "" if none are shown. ` +
        `registeredCount: the number of registered participants if displayed, otherwise -1. ` +
        `notes: one short sentence describing what you saw.`;
      const outputSchema = {
        type: 'object',
        properties: {
          state: { type: 'string', enum: ['open', 'closed', 'upcoming', 'unknown'] },
          opensAt: { type: 'string' },
          closesAt: { type: 'string' },
          registeredCount: { type: 'integer' },
          notes: { type: 'string' },
        },
        required: ['state', 'opensAt', 'closesAt', 'registeredCount', 'notes'],
      };
      const raw = await runAgent({ url, goal, outputSchema });
      const parsed = z
        .object({
          state: z.enum(['open', 'closed', 'upcoming', 'unknown']),
          opensAt: z.string(),
          closesAt: z.string(),
          registeredCount: z.number().int(),
          notes: z.string(),
        })
        .safeParse(raw);
      if (!parsed.success) {
        throw new WemakedevsError('SITE_CHANGED', 'TinyFish Agent returned output that failed validation.', {
          url,
          hint: `Issues: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        });
      }
      const d = parsed.data;
      return {
        url,
        state: d.state,
        opensAt: d.opensAt.trim() === '' ? null : d.opensAt.trim(),
        closesAt: d.closesAt.trim() === '' ? null : d.closesAt.trim(),
        registeredCount: d.registeredCount < 0 ? null : d.registeredCount,
        notes: d.notes.trim() || null,
        observedAt: asOf(),
        method: 'tinyfish-agent' as const,
      };
    }),
  );

  // ---------- list_meetups ----------
  server.registerTool(
    'list_meetups',
    {
      title: 'List WeMakeDevs meetups',
      description:
        'List WeMakeDevs community meetups (city, host, date text, links — usually Luma). Dates are the page’s display text; the site does not publish machine-readable dates for meetups. Filter by city and free text.',
      inputSchema: z.object({
        city: z.string().max(80).optional().describe('Case-insensitive substring match on the location line.'),
        search: z.string().max(120).optional().describe('Case-insensitive substring match on title, location and description.'),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      outputSchema: MeetupListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(MeetupListSchema, async ({ city, search, limit }) => {
      const html = await fetchHtml(`${WEMMAKEDEVS_ORIGIN}/meetups`);
      let out = parseMeetups(html);
      if (city) {
        const q = city.toLowerCase();
        out = out.filter((m) => m.location?.toLowerCase().includes(q) || m.title.toLowerCase().includes(q));
      }
      if (search) {
        const q = search.toLowerCase();
        out = out.filter((m) =>
          [m.title, m.location, m.description].some((v) => v?.toLowerCase().includes(q)),
        );
      }
      const slice = out.slice(0, limit);
      return { count: slice.length, items: slice, asOf: asOf() };
    }),
  );

  // ---------- list_open_roles ----------
  server.registerTool(
    'list_open_roles',
    {
      title: 'List open roles at WeMakeDevs',
      description:
        'List roles WeMakeDevs is hiring for (title, location, type, compensation, posting date) parsed live from /careers. Returns an empty list when the page shows its empty state — not an error.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).default(10),
      }),
      outputSchema: CareerListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(CareerListSchema, async ({ limit }) => {
      const html = await fetchHtml(`${WEMMAKEDEVS_ORIGIN}/careers`);
      const items = parseCareers(html).slice(0, limit);
      return {
        count: items.length,
        items,
        note: items.length === 0 ? 'No open roles right now (careers page shows its empty state).' : null,
        asOf: asOf(),
      };
    }),
  );

  // ---------- list_scholarships ----------
  server.registerTool(
    'list_scholarships',
    {
      title: 'List WeMakeDevs scholarship programs',
      description:
        'Current WeMakeDevs scholarship program: coverage (flights, hotel, passes, reimbursement…), application status (open/closed), past winners and FAQ questions. FAQ answers are nullable because the accordion bodies are client-rendered and TinyFish Fetch strips scripts. Parsed live via TinyFish.',
      inputSchema: z.object({}),
      outputSchema: ScholarshipSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(ScholarshipSchema, async () => {
      const html = await fetchHtml(`${WEMMAKEDEVS_ORIGIN}/scholarships`);
      return parseScholarships(html);
    }),
  );

  // ---------- upcoming_deadlines ----------
  server.registerTool(
    'upcoming_deadlines',
    {
      title: 'Upcoming WeMakeDevs deadlines',
      description:
        'Hackathon start and end (submission close) dates falling within the next N days, across all WeMakeDevs hackathons. Meetups/scholarships are excluded (no machine-readable dates); see list_meetups and list_scholarships.',
      inputSchema: z.object({
        within_days: z.number().int().min(1).max(365).default(30),
      }),
      outputSchema: DeadlinesSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(DeadlinesSchema, async ({ within_days }) => {
      const html = await fetchHtml(`${WEMMAKEDEVS_ORIGIN}/hackathons`);
      const { items } = parseHackathons(html);
      const now = Date.now();
      const end = now + within_days * 86_400_000;
      const inWindow = (iso: string | null, inclusiveEnd = false) => {
        if (!iso) return false;
        let t = Date.parse(iso);
        if (Number.isNaN(t)) return false;
        if (inclusiveEnd && /^\d{4}-\d{2}-\d{2}$/.test(iso)) t += 86_400_000 - 1;
        return t >= now && t <= end;
      };
      const deadlines = items.flatMap((i) => {
        const out: Array<{ kind: 'hackathon-start' | 'hackathon-end'; title: string; date: string; url: string }> = [];
        if (inWindow(i.startDate)) out.push({ kind: 'hackathon-start', title: i.title, date: i.startDate!, url: i.url });
        if (inWindow(i.endDate, true)) out.push({ kind: 'hackathon-end', title: i.title, date: i.endDate!, url: i.url });
        return out;
      }).sort((a, b) => a.date.localeCompare(b.date));
      return {
        withinDays: within_days,
        asOf: asOf(),
        items: deadlines,
        note:
          'Meetups and scholarships excluded — the site publishes display-text dates only for those. ' +
          'Hackathon dates were read from rendered cards; yearless dates are assumed to be the current year.',
      };
    }),
  );

  // ---------- list_blog_posts ----------
  server.registerTool(
    'list_blog_posts',
    {
      title: 'List WeMakeDevs blog posts',
      description:
        'List posts from the live WeMakeDevs blog RSS feed (/blogs/rss.xml). Returns title, canonical URL, publication date, summary, author and tags. Filter by tag or free-text search. Use get_blog_post for the full article text.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20),
        tag: z.string().max(60).optional()
          .describe('Only posts carrying this category/tag (case-insensitive), e.g. "hackathon".'),
        search: z.string().max(120).optional()
          .describe('Case-insensitive substring match on title, summary, author and tags.'),
      }),
      outputSchema: BlogListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(BlogListSchema, async ({ limit, tag, search }) => {
      const xml = await fetchRss();
      const items = filterBlogPosts(parseBlogRss(xml), { tag, search });
      const slice = items.slice(0, limit);
      return { count: slice.length, items: slice, source: 'rss' as const, asOf: asOf() };
    }),
  );

  // ---------- search_blog ----------
  server.registerTool(
    'search_blog',
    {
      title: 'Search WeMakeDevs blog posts',
      description:
        'Full-text search across the live WeMakeDevs blog RSS feed (title, summary, author, tags). Returns matching posts newest first. Use get_blog_post to read one in full.',
      inputSchema: z.object({
        query: z.string().min(1).max(120)
          .describe('Words to look for, case-insensitive, e.g. "switch workflow" or "AWS".'),
        tag: z.string().max(60).optional()
          .describe('Restrict to this category/tag (case-insensitive).'),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      outputSchema: BlogListSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(BlogListSchema, async ({ query, tag, limit }) => {
      const xml = await fetchRss();
      const items = filterBlogPosts(parseBlogRss(xml), { tag, search: query });
      const slice = items.slice(0, limit);
      return { count: slice.length, items: slice, source: 'rss' as const, asOf: asOf() };
    }),
  );

  // ---------- get_blog_post ----------
  server.registerTool(
    'get_blog_post',
    {
      title: 'Get a WeMakeDevs blog post',
      description:
        'Read one WeMakeDevs blog post: title, date, author, tags, article paragraphs and every outbound link (relative links resolved). Pass a slug ("wispr"), path ("/blogs/wispr") or full wemakedevs.org/blog URL. Metadata comes from the live RSS feed, body from the live article page (TinyFish Fetch).',
      inputSchema: z.object({
        post: z.string().min(1).max(300)
          .describe('Slug ("wispr"), path ("/blogs/wispr") or full URL on a wemakedevs.org host.'),
      }),
      outputSchema: BlogPostSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(BlogPostSchema, async ({ post }) => {
      const url = resolveBlogUrl(post);
      const [xml, html] = await Promise.all([fetchRss(), fetchHtml(url)]);
      const feedItem = parseBlogRss(xml).find(
        (i) => i.url.replace(/\/+$/, '') === url.replace(/\/+$/, ''),
      );
      const page = parseBlogPost(html, url);
      return {
        ...page,
        pubDate: feedItem?.pubDate ?? page.pubDate,
        description: feedItem?.description ?? page.description,
        author: feedItem?.author ?? page.author,
        categories: feedItem?.categories ?? page.categories,
      };
    }),
  );

  // ---------- get_hackathon_schedule ----------
  server.registerTool(
    'get_hackathon_schedule',
    {
      title: 'Get a hackathon timeline',
      description:
        'Get the timeline of a WeMakeDevs hackathon from its schedule page: each milestone with the display text the site shows ("Nov 2, 3:30 PM UK time" or "Open now"), the machine-readable ISO date when the site provides one, title and detail. Pass a slug, path or full URL; "/schedule" is appended automatically.',
      inputSchema: z.object({
        hackathon: z.string().min(1).max(300)
          .describe('Slug ("switch"), path ("/hackathons/switch") or full URL on a WeMakeDevs host.'),
      }),
      outputSchema: ScheduleSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(ScheduleSchema, async ({ hackathon }) => {
      const base = resolveHackathonUrl(hackathon).replace(/\/+$/, '');
      const url = base.endsWith('/schedule') ? base : `${base}/schedule`;
      const html = await fetchHtml(url);
      return { url, items: parseSchedule(html) };
    }),
  );

  // ---------- get_hackathon_resources ----------
  server.registerTool(
    'get_hackathon_resources',
    {
      title: 'Get a hackathon resource hub',
      description:
        'Get the resources page of a WeMakeDevs hackathon as grouped link lists (Start here, Build your workflow, Go deeper, Contribute, Videos…) with the note under each link, plus any CLI one-liners shown. Pass a slug, path or full URL; "/resources" is appended automatically.',
      inputSchema: z.object({
        hackathon: z.string().min(1).max(300)
          .describe('Slug ("switch"), path ("/hackathons/switch") or full URL on a WeMakeDevs host.'),
      }),
      outputSchema: ResourcesSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(ResourcesSchema, async ({ hackathon }) => {
      const base = resolveHackathonUrl(hackathon).replace(/\/+$/, '');
      const url = base.endsWith('/resources') ? base : `${base}/resources`;
      const html = await fetchHtml(url);
      const page = parseResources(html, originOf(url));
      return { url, title: page.title, groups: page.groups, commands: page.commands };
    }),
  );

  // ---------- latest_updates ----------
  server.registerTool(
    'latest_updates',
    {
      title: 'Latest WeMakeDevs updates',
      description:
        'One feed of what is new and what is coming: blog posts published in the last N days plus hackathon start and submission-close dates in the next N days. Merged, date-stamped, newest first. Useful for "what changed", "what is new", and "what is coming up".',
      inputSchema: z.object({
        within_days: z.number().int().min(1).max(365).default(30)
          .describe('Look-back window for blog posts and look-ahead window for hackathon dates, in days.'),
      }),
      outputSchema: UpdatesSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(UpdatesSchema, async ({ within_days }) => {
      const span = within_days * 86_400_000;
      const now = Date.now();
      const [xml, listingHtml] = await Promise.all([
        fetchRss(),
        fetchHtml(`${WEMMAKEDEVS_ORIGIN}/hackathons`),
      ]);
      const posts = parseBlogRss(xml);
      const { items: hackathons } = parseHackathons(listingHtml);
      const items: Array<{
        kind: 'blog' | 'hackathon-start' | 'hackathon-end';
        title: string;
        date: string;
        url: string;
        summary: string | null;
      }> = [];
      for (const p of posts) {
        if (!p.pubDate) continue;
        const t = Date.parse(p.pubDate);
        if (Number.isNaN(t) || t < now - span || t > now + span) continue;
        items.push({
          kind: 'blog',
          title: p.title,
          date: new Date(t).toISOString(),
          url: p.url,
          summary: p.description,
        });
      }
      for (const h of hackathons) {
        const milestones = [
          ['hackathon-start', h.startDate, 'Hackathon starts'],
          ['hackathon-end', h.endDate, 'Submissions close'],
        ] as const;
        for (const [kind, iso, summary] of milestones) {
          if (!iso) continue;
          let t = Date.parse(iso);
          if (kind === 'hackathon-end' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) t += 86_400_000 - 1;
          if (Number.isNaN(t) || t < now || t > now + span) continue;
          items.push({ kind, title: h.title, date: new Date(t).toISOString(), url: h.url, summary });
        }
      }
      items.sort((a, b) => b.date.localeCompare(a.date));
      return {
        withinDays: within_days,
        asOf: asOf(),
        items,
        note: 'Blog posts from the last N days plus hackathon start/end dates in the next N days; newest date first.',
      };
    }),
  );

  // ---------- get_hackathon_changes ----------
  server.registerTool(
    'get_hackathon_changes',
    {
      title: 'Diff WeMakeDevs hackathons since last check',
      description:
        'Compare the live hackathon listing against the previous observation saved on this machine: which events were added, removed, or changed (title, prize, dates, location, format). The first call creates a baseline; later calls report real diffs. Live values always come from TinyFish Fetch — only prior observations are stored locally. Optionally scope to one hackathon.',
      inputSchema: z.object({
        hackathon: z.string().min(1).max(300).optional()
          .describe('Optional slug ("switch"), path or full URL to diff only that event.'),
        update_baseline: z.boolean().default(true)
          .describe('After diffing, save the current state as the new baseline (default). Set false to keep comparing against the same baseline.'),
      }),
      outputSchema: HackathonChangesSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(HackathonChangesSchema, async ({ hackathon, update_baseline }) => {
      const { snapshot, warning } = await loadSnapshot();
      const html = await fetchHtml(`${WEMMAKEDEVS_ORIGIN}/hackathons`);
      const { items } = parseHackathons(html);

      let filterUrl: string | undefined;
      if (hackathon) {
        filterUrl = resolveHackathonUrl(hackathon)
          .replace(/\/(?:rules|schedule|resources)$/i, '')
          .replace(/\/+$/, '');
      }

      const now = asOf();
      const diff = diffHackathons(snapshot, items, { asOf: now, filterUrl });

      if (filterUrl && diff.compared === 0 && !snapshot?.items[filterUrl]) {
        throw new WemakedevsError(
          'VALIDATION_FAILED',
          `No hackathon matching ${filterUrl} appears in the current listing or the previous snapshot.`,
          { hint: 'Use list_hackathons to see the current slugs.' },
        );
      }

      let baselineUpdated = false;
      let saveWarning: string | null = null;
      if (update_baseline) {
        saveWarning = await saveSnapshot(snapshotFrom(items, now));
        baselineUpdated = saveWarning === null;
      }

      const notes = [
        diff.note,
        warning,
        saveWarning,
        update_baseline ? null : 'Baseline left unchanged (update_baseline=false).',
        'Cards were read from the rendered listing; yearless dates are assumed to be the current year.',
      ].filter((n): n is string => Boolean(n));

      return { ...diff, baselineUpdated, note: notes.join(' ') || null };
    }),
  );

  // ---------- health_check ----------
  const targetEnum = z.enum(['all', ...ALL_TARGETS] as [string, ...string[]]);
  server.registerTool(
    'health_check',
    {
      title: 'Health check the WeMakeDevs site parsers',
      description:
        'Run live checks against wemakedevs.org (via TinyFish Fetch, ttl=0): hackathon listing/detail/schedule/resources/rules, meetups, careers, scholarships and the blog RSS feed. Fails loudly — use it to detect when the site changed and a tool broke. Costs one Fetch call per target.',
      inputSchema: z.object({
        target: targetEnum.default('all')
          .describe('Which check to run; "all" runs every check.'),
      }),
      outputSchema: HealthReportSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ target }) => {
      const targets = target === 'all' ? undefined : ([target] as HealthTarget[]);
      try {
        const report = await runHealthChecks({ targets });
        const parsed = HealthReportSchema.safeParse(report);
        if (!parsed.success) {
          throw new WemakedevsError('SITE_CHANGED', 'Health report failed schema validation.', {
            hint: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
          });
        }
        return { ...asStructured(parsed.data), isError: !report.ok };
      } catch (err) {
        return asError(err);
      }
    },
  );
}
