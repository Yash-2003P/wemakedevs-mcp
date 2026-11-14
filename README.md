# wemakedevs-mcp

[![CI](https://github.com/Yash-2003P/wemakedevs-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Yash-2003P/wemakedevs-mcp/actions/workflows/ci.yml)

An MCP (Model Context Protocol) server that turns **wemakedevs.org** — a site with no documented public API — into **16 typed agent tools**. Hackathons, timelines, resource hubs, rules, blogs, meetups, scholarships and careers become clean, structured JSON an AI agent can actually use. [TinyFish](https://tinyfish.ai) does the real web reading on every call; there is no cached or canned data in the serving path.

> Built for the TinyFish “Site → MCP” bounty. Not affiliated with WeMakeDevs.

**Live status (2026-11-14):** `npm run health` → **9/9 checks green** against the live site; **31 tests** (unit + HTTP) green; **16/16 tools** exercised offline through the fixture stub, and **15/15 fast tools + the Agent tool** exercised live through stdio and HTTP. Both MCP protocol eras are served from one tool surface: legacy **2025-11-25** (`initialize`) and modern **2026-07-28** (`server/discover`, per-request metadata). Verified with the official MCP Inspector 2.13 in both eras, and on Node 20 (Alpine, Docker) as well as Node 24.

## Why this exists

WeMakeDevs runs 30+ hackathons a year, meetups in 9+ cities, community scholarships and occasional hiring — and none of it is available as an API. If you want your coding agent to answer *“what should I enter this month, what are the prizes, when is the deadline, and is registration still open?”*, the web is the only interface. This server is that interface, and it is structured enough for any MCP client.

## Install (from source)

The package is **not published to npm yet**, so the commands below run the built server directly. Requires Node.js ≥ 20 and a TinyFish API key ([get one](https://agent.tinyfish.ai/api-keys)).

```bash
git clone https://github.com/Yash-2003P/wemakedevs-mcp.git
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

### VS Code

Add `.vscode/mcp.json` (or run **MCP: Add Server**):

```json
{
  "servers": {
    "wemakedevs": {
      "type": "stdio",
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

ChatGPT connectors expect a **remote HTTP MCP endpoint** with OAuth (or no auth). This repo ships both the **stdio** transport (default) and a **Streamable HTTP** transport (`src/http.ts`) that speaks both protocol eras, so the tools are reachable from remote hosts today. A bearer token is the only auth implemented, which is not the OAuth flow ChatGPT connectors require — put an OAuth flow (or an authenticated bridge) in front for ChatGPT. The tools themselves are client-agnostic.

### Streamable HTTP (remote clients)

```bash
npm run build
HOST=127.0.0.1 PORT=3000 node dist/src/http.js        # loopback, no token
HOST=0.0.0.0 MCP_HTTP_TOKEN=secret node dist/src/http.js
```

Endpoint: `POST /mcp` (stateless: no sessions, no standalone SSE). `GET /health` reports liveness and whether a token is required.

**Protocol eras.** One tool surface serves both:

- **Legacy 2025-11-25** — the `initialize` handshake, answered by the SDK's stateless legacy path.
- **Modern 2026-07-28** — no `initialize`; `server/discover`, per-request `_meta`, and the required `MCP-Protocol-Version` / `Mcp-Method` headers. Modern clients can call `tools/list` directly once those headers are present.

This is verified with MCP Inspector 2.13 in `--protocol-era legacy` and `--protocol-era modern`, over both stdio and HTTP.

Safety defaults:

- **Terminate TLS before exposing the port.** The server speaks plain HTTP; a public deployment needs a TLS-terminating proxy (or a private network) so the bearer token never crosses the wire in clear text.
- Binds `127.0.0.1` unless `HOST` is set, and **refuses to bind a non-loopback address without `MCP_HTTP_TOKEN`**.
- `Authorization: Bearer <MCP_HTTP_TOKEN>` is compared with `timingSafeEqual`.
- **Origins are parsed, never prefix-matched.** Loopback origins (`http://localhost:5173`, `https://127.0.0.1`, `[::1]`) are allowed on any port; everything else must match an exact `MCP_HTTP_ORIGINS` entry. `http://localhost.evil.com` is rejected.
- **Host is DNS-rebinding protected with exact values.** The allowlist is built from the actual bind address and port plus `MCP_HTTP_HOSTS`; the incoming `Host` header is never added to its own allowlist. A spoofed Host gets `403` before the body is read.
- **Bounds:** `MCP_HTTP_MAX_BODY_BYTES` (default 4 MiB) caps request bodies, and `maxToolInputElements: 256` caps combined array/object elements in a `tools/call` payload.

Claude Code, as a remote client:

```bash
claude mcp add --transport http wemakedevs \
  -H "Authorization: Bearer $MCP_HTTP_TOKEN" \
  http://127.0.0.1:3000/mcp
```

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "authorization: Bearer $MCP_HTTP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 300
```

Verify the whole path, including auth rejection:

```bash
TINYFISH_API_KEY=sk-... npm run smoke:http
```

| Env var | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Non-loopback requires a token. |
| `PORT` | `3000` | Bind port. |
| `MCP_HTTP_TOKEN` | *(unset)* | Required bearer token. Unset = loopback-only, no auth. |
| `MCP_HTTP_HOSTS` | *(unset)* | Extra allowed `Host` header values, matched **exactly and including the port** (comma-separated), e.g. `mcp.example.com:443`. |
| `MCP_HTTP_ORIGINS` | *(unset)* | Extra allowed `Origin` values, matched exactly after URL normalization (comma-separated). |
| `MCP_HTTP_MAX_BODY_BYTES` | `4194304` | Maximum POST body size. |

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
| `list_scholarships` | Current scholarship program: coverage (flights, hotel, pass, local transport, visa), application status, past winners, FAQ questions. FAQ `answer` is nullable: the accordion bodies are client-rendered and Fetch strips scripts. |
| `list_blog_posts` | Posts from the live blog RSS feed (`/blogs/rss.xml`): title, canonical URL, date, summary, author, tags. Filter by tag or search. |
| `search_blog` | Full-text search across the same feed (title, summary, author, tags). |
| `get_blog_post` | One full post: RSS metadata merged with the live article body — paragraphs, every outbound link, author, date, tags. |
| `upcoming_deadlines` | Hackathon starts and submission closes within the next N days — the “what should I enter?” answer. |
| `latest_updates` | One feed of what is new and what is coming: blog posts from the last N days plus hackathon start/end dates in the next N days. |
| `get_hackathon_changes` | Diff the live listing against the previous observation saved on this machine: added, removed and field-level changes (title, prize, dates, location, format). Optional single-event scope. |
| `health_check` | Live self-check of every parser (nine checks). Fails loudly. |

All tools return **structured JSON** (`structuredContent`) validated against zod schemas. Tools never return raw HTML dumps, and errors are typed and human-readable: `CONFIG`, `FETCH_FAILED`, `AGENT_FAILED`, `NOT_FOUND`, `SITE_CHANGED`, `VALIDATION_FAILED`, `PARSE_FAILED`.

### Real multi-step run (live, 2026-11-07)

A fresh OpenCode session asked: *"I want to enter a WeMakeDevs hackathon this month."* It found and chained seven tools:

```
→ list_hackathons({status: "ongoing"})    1 event   Flip the Switch, Nov 4–7
→ list_hackathons({status: "upcoming"})   3 events  Cloud Native, Festive Hacks, Toggle Wars
→ get_hackathon({hackathon: "switch"})    prizePool "$10,000" · Solo or up to 4 · Online
→ get_hackathon_schedule({hackathon: "switch"})
  6 milestones · submissions close 2026-11-07T23:59+05:30
→ get_hackathon_resources({hackathon: "switch"})
  5 groups · 21 links · 2 CLI snippets
→ check_registration_status({hackathon: "switch"})   // TinyFish Agent, ≈41 s
  { state: "open", registeredCount: 7690, closesAt: null }
→ search_blog({query: "switch"})          1 post
```

The full log — tool outputs, tables, the 21 resolved resource links and the agent's verbatim final answer — is in **[docs/DEMO.md](docs/DEMO.md)**.

The run surfaced a real site inconsistency: the listing card says `$8000` while the detail page says `$10,000`. The agent reported both and refused to pick one; the tools return each source verbatim rather than silently normalizing it.

Across the verification session, **all 16 tools** were exercised against the live site through a real MCP stdio client (including `get_hackathon_rules`, `get_blog_post`, `latest_updates`, `upcoming_deadlines`, `get_hackathon_changes`, `list_meetups`, `list_open_roles`, `list_scholarships` and `health_check`).

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

Live lesson baked into the code: TinyFish Agent’s `output_schema` rejects `additionalProperties` and `description`, so the schema is the minimal JSON Schema subset it accepts. Live runs took **39 s, 41 s and 62 s**; the first returned `state=open`, `closesAt="Nov 7, 2026"`, `registeredCount=7689`.

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
| `hackathons-listing` | ≥ 10 rendered cards, ≥ 1 ISO start date, sentinel event **asserted** (missing sentinel fails the check) |
| `hackathon-detail` | h1, ≥ 4 `section[id]`, prizes section, ≥ 3 FAQ entries |
| `hackathon-schedule` | ≥ 4 milestones, at least one machine-readable `<time datetime>` |
| `hackathon-resources` | ≥ 3 groups, ≥ 8 links |
| `rules-page` | official-rules legal markers |
| `meetups-listing` | cards parse, or an explicit empty state |
| `careers` | roles parse, or the explicit “No open roles right now” empty state |
| `scholarships` | program, coverage list and FAQs all parse |
| `blog-rss` | ≥ 1 item, parseable `pubDate` |

The CLI prints a per-check JSON report and exits non-zero on any failure. The MCP tool `health_check` exposes the same checks to agents (`isError: true` when unhealthy). CI runs build + tests + offline health + an offline 16-tool smoke on every push; a weekly workflow runs the live check when `secrets.TINYFISH_API_KEY` is configured, and skips with a notice when it is not.

## Change history (diffs)

`get_hackathon_changes` compares the live listing with the last observation on this machine. The first call creates a baseline; later calls report events added, removed, or changed. Only **prior observations** are stored — every value in the current side of the diff comes from a fresh TinyFish Fetch.

Default state file: `~/.cache/wemakedevs-mcp/hackathon-snapshots.json`. Override the directory with `WEMAKEDEVS_MCP_STATE_DIR`. Pass `update_baseline: false` to compare against the same baseline repeatedly.

## Development

```bash
npm ci
npm test          # builds, then runs 31 tests (unit + HTTP) against test/fixtures/*
npm run smoke:stub  # offline: starts the fixture stub, calls all 16 tools

TINYFISH_API_KEY=sk-... npm run smoke       # live: 15 fast tools (Agent skipped)
TINYFISH_API_KEY=sk-... npm run smoke:all   # live: 16/16 including the Agent call (~40–70 s)
TINYFISH_API_KEY=sk-... npm run smoke:http  # starts the Streamable HTTP server, checks auth + a live call
```

`npm run smoke` starts the built server over stdio with the real MCP SDK client, checks that all 16 tools are advertised, then calls the 15 fast tools once against the live site. `npm run smoke:all` adds `check_registration_status`; `npm run smoke:stub` runs all 16 against local fixtures with no key. The scripts double as client examples.

`test/fixtures/` holds public page snapshots captured 2026-11-05 (plus the RSS feed, schedule, resources and a blog post). Parser tests assert on those; live drift is caught by `npm run health`, not by silently serving stale data.

**Verified environments (2026-11-09):**

- Node **24.21.0** on the host and Node **20.20.2** on Alpine (Docker): `npm ci` → `npm test` → **31/31**; offline health **9/9**; `npm run smoke:stub` → **16/16** tools.
- MCP Inspector **2.13.0**, both `--protocol-era legacy` and `--protocol-era modern`, over stdio and HTTP: 16 tools, `tools/list --strict` → **0 errors**, live `tools/call` in modern mode.
- `npm run smoke` **15/15** fast tools; `npm run smoke:all` **16/16** including the Agent call; `npm run smoke:http` auth rejection + 16 tools + a live call.
- Live health **9/9**; spoofed `Host` and lookalike `Origin` requests rejected with **403** on the running server.

## Limitations (honest ones)

- **Listing dates are inferred from display text.** The site does not expose ISO dates in the rendered listing (scripts are stripped by Fetch). A display date without a year is assumed to be the current year; the site prints a year for other years. `dateText` is always returned verbatim alongside the inferred ISO dates.
- **The listing parser depends on the card DOM.** If WeMakeDevs redesigns the event cards, `health_check` fails with the exact check and reason instead of returning partial garbage.
- **Agent latency is 20–120 s.** MCP clients must allow a request timeout of at least ~120 s for `check_registration_status`; the server itself has no timeout. Observed live: 39 s, 41 s and 62 s — the last one exceeds the SDK's default 60 s client timeout. `npm run smoke:all` sets 180 s.
- **Scholarship FAQ answers are usually `null`.** The question buttons render server-side, but the answer bodies are client-rendered; Fetch strips scripts, so the live page exposes questions only. The schema keeps `answer` nullable and the health check reports how many answers (normally 0) were exposed.
- **Meetup dates are display text** (“Oct 27”), not ISO; they are excluded from `upcoming_deadlines`.
- **`/careers` can legitimately be empty.** The live page said “No open roles right now” during the final run; the tool returns `[]` with a note rather than inventing roles.
- **Archive and external events.** Older events on `archive.wemakedevs.org` are listed and parsed best-effort. External events (Devpost/Luma) are listed with their URLs; `get_hackathon` refuses non-WeMakeDevs hosts by design.
- **Node package not published.** Install from source until an npm release exists.
- **Health sentinel** defaults to `switch`; override with `HEALTH_SENTINEL_SLUG` if that page is retired.
- **The HTTP transport is stateless and POST-only.** No sessions, no standalone SSE stream, no resumability — deliberate for a read-only tool set. Each POST gets a fresh `McpServer`; both protocol eras share the same registrations.
- **Modern clients must send the spec's headers.** A 2026-07-28 request without `MCP-Protocol-Version` and `Mcp-Method` is rejected by the SDK with a `400` that names the missing header. This is protocol-correct, not a bug.
- **Auth is a bearer token only.** That covers Claude Code's `-H` header and other Streamable HTTP clients; it is **not** the OAuth flow ChatGPT connectors expect. No OAuth server is implemented.
- **Browser CORS is closed by default.** A request with an unblessed `Origin` gets 403. Loopback origins on any port are allowed; other browser origins need an exact `MCP_HTTP_ORIGINS` entry.
- **Nullable output fields use JSON Schema type arrays.** Inspector `--strict` reports 52 portability warnings (0 errors) because zod emits `type: ["string","null"]` rather than `anyOf`. Hosts that accept JSON Schema 2020-12 are unaffected; a client that maps schemas onto a single-type OpenAPI dialect may drop the null branch.

## Why there is no UI

MCP Apps is an official extension (spec 2026-01-26): a server declares a `ui://` resource, and a supporting host renders it in a sandboxed iframe. It is **optional**, and this server deliberately does not ship one:

- Every tool already returns `structuredContent` plus a text rendering, which Claude, Cursor, OpenCode, Inspector and generic MCP clients display without any server-side UI.
- MCP Apps only works in hosts that implement the extension; a UI would make the server *less* universal, not more.
- The bounty scores typed tools and real TinyFish coverage. A timeline iframe would add a bundle, CSP and `postMessage` surface without adding a single capability or TinyFish call.
- The only genuinely useful future view — a hackathon timeline/registration badge — is presentation over data the tools already expose. It can be added later without changing the tool contracts.

The full decision record is in [docs/UI-ASSESSMENT.md](docs/UI-ASSESSMENT.md).

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
