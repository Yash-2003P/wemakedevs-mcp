import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WemakedevsError } from './errors.js';
import { fetchPages, runAgent } from './tinyfish.js';
import {
  WEMMAKEDEVS_ORIGIN,
  extractHackathonMeta,
  parseCareers,
  parseFaq,
  parseHackathons,
  parseMeetups,
  parseScholarships,
  parseSectionAst,
} from './parse.js';
import { resolveHackathonUrl, originOf } from './util.js';
import { runHealthChecks, ALL_TARGETS, type HealthTarget } from './health.js';
import {
  CareerListSchema,
  DeadlinesSchema,
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
  <A extends Record<string, unknown>>(fn: (args: A) => Promise<unknown>) =>
  async (args: A): Promise<ToolResult> => {
    try {
      return asStructured(await fn(args));
    } catch (err) {
      return asError(err);
    }
  };

async function fetchHtml(url: string): Promise<string> {
  const out = await fetchPages([url], { format: 'html', ttl: 0 });
  const text = out.results[0]?.text;
  if (typeof text !== 'string' || text.length < 500) {
    throw new WemakedevsError('SITE_CHANGED', `Page returned by TinyFish is suspiciously small (${typeof text === 'string' ? text.length : 'non-string'} chars).`, { url });
  }
  return text;
}

const asOf = () => new Date().toISOString();

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
    wrap(async ({ status, format, search, limit }) => {
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
      const notes: string[] = [];
      if (source === 'dom') notes.push('Parsed via DOM fallback (embedded JSON missing): dates and statuses are unavailable.');
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
    wrap(async ({ hackathon, sections }) => {
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
    wrap(async ({ hackathon }) => {
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
    wrap(async ({ hackathon }) => {
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
          opensAt: { type: 'string', description: 'Verbatim opening date text, or "" if not shown' },
          closesAt: { type: 'string', description: 'Verbatim closing date text, or "" if not shown' },
          registeredCount: { type: 'integer', description: 'Registered count if displayed, else -1' },
          notes: { type: 'string' },
        },
        required: ['state', 'opensAt', 'closesAt', 'registeredCount', 'notes'],
        additionalProperties: false,
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
    wrap(async ({ city, search, limit }) => {
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
    wrap(async ({ limit }) => {
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
        'Current WeMakeDevs scholarship program: coverage (flights, hotel, passes, reimbursement…), application status (open/closed), past winners and FAQs. Parsed live via TinyFish.',
      inputSchema: z.object({}),
      outputSchema: ScholarshipSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    wrap(async () => {
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
    wrap(async ({ within_days }) => {
      const html = await fetchHtml(`${WEMMAKEDEVS_ORIGIN}/hackathons`);
      const { items } = parseHackathons(html);
      const now = Date.now();
      const end = now + within_days * 86_400_000;
      const inWindow = (iso: string | null) => {
        if (!iso) return false;
        const t = Date.parse(iso);
        return !Number.isNaN(t) && t >= now && t <= end;
      };
      const deadlines = items.flatMap((i) => {
        const out: Array<{ kind: 'hackathon-start' | 'hackathon-end'; title: string; date: string; url: string }> = [];
        if (inWindow(i.startDate)) out.push({ kind: 'hackathon-start', title: i.title, date: i.startDate!, url: i.url });
        if (inWindow(i.endDate)) out.push({ kind: 'hackathon-end', title: i.title, date: i.endDate!, url: i.url });
        return out;
      }).sort((a, b) => a.date.localeCompare(b.date));
      return {
        withinDays: within_days,
        asOf: asOf(),
        items: deadlines,
        note: 'Meetups and scholarships excluded — the site publishes display-text dates only for those.',
      };
    }),
  );

  // ---------- health_check ----------
  const targetEnum = z.enum(['all', ...ALL_TARGETS] as [string, ...string[]]);
  server.registerTool(
    'health_check',
    {
      title: 'Health check the WeMakeDevs site parsers',
      description:
        'Run live checks against wemakedevs.org (via TinyFish Fetch, ttl=0): listing pages parse, detail page retains its sections/FAQ, scholarships page intact. Fails loudly — use it to detect when the site changed and a tool broke. Costs one Fetch call per target.',
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
        return { ...asStructured(report), isError: !report.ok };
      } catch (err) {
        return asError(err);
      }
    },
  );
}
