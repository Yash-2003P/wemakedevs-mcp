# wemakedevs-mcp

An MCP (Model Context Protocol) server that turns **wemakedevs.org** — a site with no documented public API — into **16 typed agent tools**. Hackathons, timelines, resource hubs, rules, blogs, meetups, scholarships and careers become clean, structured JSON an AI agent can actually use. [TinyFish](https://tinyfish.ai) does the real web reading on every call; there is no cached or canned data in the serving path.

> Built for the TinyFish “Site → MCP” bounty. Not affiliated with WeMakeDevs.

**Live status (2026-11-07):** `npm run health` → **9/9 checks green** against the live site; 20 unit tests green; every tool below exercised through a real MCP stdio client.

## Why this exists

WeMakeDevs runs 30+ hackathons a year, meetups in 9+ cities, community scholarships and occasional hiring — and none of it is available as an API. If you want your coding agent to answer *“what should I enter this month, what are the prizes, when is the deadline, and is registration still open?”*, the web is the only interface. This server is that interface, and it is structured enough for any MCP client.

## Install (from source)

The package is **not published to npm yet**, so the commands below run the built server directly. Requires Node.js ≥ 20 and a TinyFish API key ([get one](https://agent.tinyfish.ai/api-keys)).

```bash
git clone <this-repo> wemakedevs-mcp
cd wemakedevs-mcp
npm ci
npm run build
export TINYFISH_API_KEY=sk-...
node dist/src/index.js          # stdio MCP server
```

### Claude Code

```bash
claude mcp add wemakedevs-mcp \
  -e TINYFISH_API_KEY=$TINYFISH_API_KEY \
  -- node /absolute/path/to/wemakedevs-mcp/dist/src/index.js
```

### Claude Desktop / Cursor / Zed / other stdio clients

```json
{
  "mcpServers": {
    "wemakedevs": {
      "command": "node",
      "args": ["/absolute/path/to/wemakedevs-mcp/dist/src/index.js"],
      "env": { "TINYFISH_API_KEY": "sk-..." }
    }
  }
}
```

### OpenCode

```json
{
  "mcp": {
    "servers": {
      "wemakedevs-mcp": {
        "type": "local",
        "command": ["node", "/absolute/path/to/wemakedevs-mcp/dist/src/index.js"],
        "environment": { "TINYFISH_API_KEY": "sk-..." }
      }
    }
  }
}
```

### ChatGPT

ChatGPT connectors expect a **remote HTTP MCP endpoint**; this repo ships the standard **stdio** transport. Use it from any stdio-capable client today, or put an HTTP MCP bridge in front of it for ChatGPT. The tools themselves are client-agnostic.

## Tools

| Tool | What it does |
|---|---|
| `list_hackathons` | List events (upcoming/ongoing/past), filter by `status`, `format` (online/in-person/hybrid), `search`. Typed summaries: title, url, location, dates, prize text, kind, status. |
| `get_hackathon` | Full structured detail of one event: hero meta (prize pool, when/where/teams), page sections (challenge, prizes, tracks, judging, schedule…), FAQ, outbound links. Use `sections: ["prizes","judging"]` to keep responses small. |
| `get_hackathon_rules` | The Official Rules page as structured sections — eligibility, exclusions, submissions, prizes, disputes. |
| `get_hackathon_schedule` | The event timeline: every milestone with the site’s display text (`"Nov 2, 3:30 PM UK time"`, `"Open now"`), the machine-readable ISO date when published, title and detail. |
| `get_hackathon_resources` | The resource hub as grouped links (Start here, Build your workflow, Go deeper, Contribute, Videos…) with each link’s note, plus CLI one-liners shown on the page. |
| `check_registration_status` | The registration panel is client-side and cannot be read with a plain fetch. **TinyFish Agent** opens a real browser, waits for the panel to resolve and reports `open` / `closed` / `upcoming` / `unknown` + dates + registered count. Read-only — never signs in or registers. |
| `list_meetups` | Meetups with venue/city, date text and Luma link. Filter by `city` / `search`. |
| `list_open_roles` | Live openings from `/careers` (title, location, type, compensation, posting date). Returns `[]` with a note when the page shows its empty state. |
| `list_scholarships` | Current scholarship program: coverage (flights, hotel, pass, local transport, visa), application status, past winners, FAQs. |
| `list_blog_posts` | Posts from the live blog RSS feed (`/blogs/rss.xml`): title, canonical URL, date, summary, author, tags. Filter by tag or search. |
| `search_blog` | Full-text search across the same feed (title, summary, author, tags). |
| `get_blog_post` | One full post: RSS metadata merged with the live article body — paragraphs, every outbound link, author, date, tags. |
| `upcoming_deadlines` | Hackathon starts and submission closes within the next N days — the “what should I enter?” answer. |
| `latest_updates` | One feed of what is new and what is coming: blog posts from the last N days plus hackathon start/end dates in the next N days. |
| `get_hackathon_changes` | Diff the live listing against the previous observation saved on this machine: added, removed and field-level changes (title, prize, dates, location, format). Optional single-event scope. |
| `health_check` | Live self-check of every parser (nine checks). Fails loudly. |

All tools return **structured JSON** (`structuredContent`) validated against zod schemas. Tools never return raw HTML dumps, and errors are typed and human-readable: `CONFIG`, `FETCH_FAILED`, `AGENT_FAILED`, `NOT_FOUND`, `SITE_CHANGED`, `VALIDATION_FAILED`, `PARSE_FAILED`.

### Real multi-step run (live, 2026-11-07)

```
You: What can I still enter this month, and is the Switch hackathon registration open?

→ list_hackathons({status: "upcoming"})
  Cloud Native Hackathon  Nov 9–10   Salt Lake City, Utah
  Festive Hacks           Nov 25     BIEC, Bengaluru
  Toggle Wars             Nov 26–29  Remote

→ list_hackathons({status: "ongoing"})
  Flip the Switch Hackathon  Nov 4–7  Remote  "$8000 in prizes…"

→ get_hackathon({hackathon: "switch", sections: ["prizes", "judging"]})
  prizePool: "$10,000"   when: "Nov 4–7, 2026"   where: "Online, from anywhere"
  teams: "Solo or up to 4 people"

→ get_hackathon_schedule({hackathon: "switch"})
  6 milestones · submissions close Nov 7, 11:59 PM IST (2026-11-07T23:59+05:30)

→ get_hackathon_resources({hackathon: "switch"})
  5 groups · 21 links · 2 CLI snippets

→ check_registration_status({hackathon: "switch"})        // TinyFish Agent, 39 s
  { state: "open", closesAt: "Nov 7, 2026", registeredCount: 7689 }
```

The same run also exercised `list_blog_posts`, `search_blog`, `get_blog_post`, `latest_updates`, `upcoming_deadlines`, `get_hackathon_changes`, `list_meetups`, `list_open_roles`, `list_scholarships` and `health_check` against the live site.

## How TinyFish is used

Exactly **two** TinyFish endpoints, both load-bearing. No ceremonial calls, no padding.

### TinyFish Fetch — every page read

`POST https://api.fetch.tinyfish.ai` with `ttl: 0` so every call is live.

- **Verbatim page reads.** Fetch’s default output is a readability-style summary that drops scripts and attributes. The server asks for `include_selectors: ["body"]`, which returns the matched element’s content verbatim. This is what makes the section AST, FAQ parsing, careers cards and resource links work.
- **The listing is parsed from the rendered cards.** Fetch strips `<script>` blocks even in verbatim mode, so the Next.js flight payload (`self.__next_f`, `"cards"`) is not reachable. The server parses the server-rendered card DOM instead: `<a><h3>title</h3><p>prize</p></a>` plus the location/date chips. Display dates (`"Nov 9–10"`, `"Sep 30 – Oct 31"`, `"February 2026"`) are converted to ISO dates; the site prints a year only for non-current years, so a missing year means the current year. This limitation is surfaced in every `note` and enforced by the health check.
- **RSS is read raw.** `/blogs/rss.xml` is fetched without a selector because selector scoping mangles `<link>` tags into HTML void elements. Fetch also lowercases tag names (`<pubdate>`), so the RSS parser is deliberately case-insensitive and tolerant of both raw XML and Fetch’s HTML-serialized form.
- **Detail, rules, schedule, resources, meetups, careers, scholarships** all use the same verbatim body read plus a page-specific cheerio parser.

### TinyFish Agent — the one thing Fetch cannot see

`POST https://agent.tinyfish.ai/v1/automation/run` is used **only** for `check_registration_status`: the registration panel renders client-side behind “Loading…”, so a page read sees the placeholder. The agent opens a real browser, waits for the panel, and returns schema-validated JSON (`state`, `opensAt`, `closesAt`, `registeredCount`, `notes`). The goal is strictly read-only: observe, never sign in, register or click an action.

Live lesson baked into the code: TinyFish Agent’s `output_schema` rejects `additionalProperties` and `description`, so the schema is the minimal JSON Schema subset it accepts. A live run took **39 seconds** and returned `state=open`, `closesAt="Nov 7, 2026"`, `registeredCount=7689`.

Nothing is pre-scraped, cached at bake time, or mocked in the serving path. `TINYFISH_API_KEY` is required; without it every tool fails fast with a clear `CONFIG` error.

## Health check (when the site changes, this breaks loudly)

```bash
npm run health                                   # live via TinyFish (needs TINYFISH_API_KEY)
WEMAKEDEVS_MCP_HEALTH_OFFLINE=1 npm run health   # parse committed fixtures, no network
npm run health -- hackathons-listing careers     # a subset
```

Nine checks, all required:

| Check | Asserts |
|---|---|
| `hackathons-listing` | ≥ 10 cards, embedded source or rendered DOM, ≥ 1 ISO start date, sentinel event present |
| `hackathon-detail` | h1, ≥ 4 `section[id]`, prizes section, ≥ 3 FAQ entries |
| `hackathon-schedule` | ≥ 4 milestones, at least one machine-readable `<time datetime>` |
| `hackathon-resources` | ≥ 3 groups, ≥ 8 links |
| `rules-page` | official-rules legal markers |
| `meetups-listing` | cards parse, or an explicit empty state |
| `careers` | roles parse, or the explicit “No open roles right now” empty state |
| `scholarships` | program, coverage list and FAQs all parse |
| `blog-rss` | ≥ 1 item, parseable `pubDate` |

The CLI prints a per-check JSON report and exits non-zero on any failure. The MCP tool `health_check` exposes the same checks to agents (`isError: true` when unhealthy). CI runs build + tests + offline health on every push; a weekly workflow runs the live check when `secrets.TINYFISH_API_KEY` is configured.

## Change history (diffs)

`get_hackathon_changes` compares the live listing with the last observation on this machine. The first call creates a baseline; later calls report events added, removed, or changed. Only **prior observations** are stored — every value in the current side of the diff comes from a fresh TinyFish Fetch.

Default state file: `~/.cache/wemakedevs-mcp/hackathon-snapshots.json`. Override the directory with `WEMAKEDEVS_MCP_STATE_DIR`. Pass `update_baseline: false` to compare against the same baseline repeatedly.

## Development

```bash
npm ci
npm test          # builds, then runs 20 unit tests against test/fixtures/*
```

`test/fixtures/` holds public page snapshots captured 2026-11-05 (plus the RSS feed, schedule, resources and a blog post). Parser tests assert on those; live drift is caught by `npm run health`, not by silently serving stale data.

## Limitations (honest ones)

- **Listing dates are inferred from display text.** The site does not expose ISO dates in the rendered listing (scripts are stripped by Fetch). A display date without a year is assumed to be the current year; the site prints a year for other years. `dateText` is always returned verbatim alongside the inferred ISO dates.
- **The listing parser depends on the card DOM.** If WeMakeDevs redesigns the event cards, `health_check` fails with the exact check and reason instead of returning partial garbage.
- **Agent latency is 20–120 s.** MCP clients must allow a request timeout of at least ~120 s for `check_registration_status`; the server itself has no timeout. The live run completed in 39 s.
- **Meetup dates are display text** (“Oct 27”), not ISO; they are excluded from `upcoming_deadlines`.
- **`/careers` can legitimately be empty.** The live page said “No open roles right now” during the final run; the tool returns `[]` with a note rather than inventing roles.
- **Archive and external events.** Older events on `archive.wemakedevs.org` are listed and parsed best-effort. External events (Devpost/Luma) are listed with their URLs; `get_hackathon` refuses non-WeMakeDevs hosts by design.
- **Node package not published.** Install from source until an npm release exists.
- **Health sentinel** defaults to `switch`; override with `HEALTH_SENTINEL_SLUG` if that page is retired.

## Try it without a TinyFish key (local stub)

For demos and development you can run every tool against committed fixtures — clearly labeled, **not TinyFish, not live web**:

```bash
npm ci && npm run build
npm run stub &                       # frozen fixtures on 127.0.0.1:8788
TINYFISH_API_KEY=stub \
TINYFISH_FETCH_BASE_URL=http://127.0.0.1:8788 \
TINYFISH_AGENT_RUN_URL=http://127.0.0.1:8788/v1/automation/run \
node dist/src/index.js               # stdio MCP server, fully backed by fixtures
```

Every tool works here EXCEPT the data is frozen (2026-11-05 snapshot) and `health_check` reports `mode: "stub"`. The stub never runs in production — the overrides are opt-in only.

## Related

- TinyFish docs: https://docs.tinyfish.ai
- WeMakeDevs: https://www.wemakedevs.org
- Blog RSS: https://www.wemakedevs.org/blogs/rss.xml

## License

MIT
