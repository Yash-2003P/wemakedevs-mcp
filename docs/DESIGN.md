# WeMakeDevs MCP — Design Document

An MCP server that turns [wemakedevs.org](https://www.wemakedevs.org) — a site with no documented public API — into 16 typed agent tools. Hackathons, timelines, resource hubs, rules, blogs, meetups, scholarships and careers become structured JSON for any MCP client. [TinyFish](https://tinyfish.ai) does the web reading at run time: Fetch for pages and RSS, Agent for the one client-rendered panel Fetch cannot see.

**Status:** implemented and live-verified on 2026-11-14. Public repo: [Yash-2003P/wemakedevs-mcp](https://github.com/Yash-2003P/wemakedevs-mcp). Verification evidence lives in [README](../README.md) and [SUBMISSION](SUBMISSION.md); this document records the design, not a test log.

## 1. Problem

WeMakeDevs runs 30+ hackathons a year, meetups in 9+ cities, scholarships and occasional hiring. None of it has a documented public API. The questions an agent should answer — which events are open, what the prize is, when submissions close, whether registration is live — are behind HTML, and the registration panel renders client-side.

This server is that interface: typed inputs, typed outputs, and a loud typed failure when the site changes. It does not re-serve WeMakeDevs' undocumented backend at `wemakedevs-server.onrender.com`; every value comes from TinyFish reading the public site.

## 2. Goals and non-goals

**Goals**

- Cover the whole public site, not one hackathon: listings, detail, rules, schedule, resources, registration, meetups, careers, scholarships and blogs (16 tools).
- Use exactly two TinyFish endpoints, both load-bearing: Fetch for every page/RSS read, Agent only for the client-rendered registration panel.
- Return zod-validated `structuredContent` plus a text rendering that works in Claude Code, Claude Desktop, Cursor, Zed, OpenCode or any generic MCP client.
- Fail loudly with a typed error and a health hint when the site's structure changes; never fall back to cached or canned data.
- Complete one real agent task end to end: "find a hackathon I can enter this month, check the deadline, and tell me whether registration is open." The transcript is in [DEMO](DEMO.md).

**Non-goals**

- No cache, scheduled scrape or pre-baked dataset in the serving path.
- No calls to WeMakeDevs' private backend.
- No UI. MCP Apps is optional; the rationale is in [UI-ASSESSMENT](UI-ASSESSMENT.md).
- No OAuth server, sessions, SSE stream or shared diff service.
- No npm release for this submission; install from source.

## 3. Alternatives considered

| Option | Rejected because | Residual trade-off |
|---|---|---|
| Re-serve `wemakedevs-server.onrender.com` | Violates the bounty's "TinyFish does the real web work" rule and would break silently when the private API changes. | None. |
| Use Agent for every read | Agent runs take 20–120 s and open a browser session per call; 16 tools would be unusable interactively. | Fetch cannot see client-rendered widgets, so one Agent call remains. |
| Use Fetch only | The registration panel is client-rendered behind "Loading…"; Fetch sees the placeholder. | Agent is slower and needs a client timeout of at least 120 s. |
| Cache pages or scrape on a schedule | The bounty forbids canned data, and stale hackathon dates are worse than a typed failure. | Every call pays live latency and TinyFish quota. |
| stdio only | Remote hosts such as Claude Code over HTTP cannot connect to a child process. | HTTP adds auth, Host/Origin and CORS surface; it is optional at runtime. |
| Shared snapshot service for diffs | Needs caller identity, storage and locking for a convenience feature. | Diffs are per-machine, not global history. |
| MCP Apps `ui://` timeline | The extension is optional; a UI would reduce host coverage and add no TinyFish capability. | Users see JSON/text instead of a rendered timeline. |

## 4. Architecture

```text
MCP client
  ├─ stdio ────────────── src/index.ts (serveStdio)
  └─ Streamable HTTP ──── src/http.ts (createMcpHandler + toNodeHandler; both eras)
                              │
                              ▼
                       registerTools(src/tools.ts)
                              │
        zod input → handler → TinyFish → parser → zod output
                              │
        { content: [text], structuredContent: validated JSON }
```

| Module | Responsibility |
|---|---|
| `src/index.ts` | stdio entry; one `McpServer` per process. |
| `src/http.ts` | Stateless POST `/mcp`, both protocol eras, bearer auth, exact Host/Origin checks, `/health`, body and input-element bounds. No tool logic. |
| `src/tools.ts` | 16 tool registrations, input schemas, Fetch/Agent calls, output validation and error mapping. |
| `src/tinyfish.ts` | Fetch client (`ttl: 0`, per-URL errors surfaced) and Agent client (read-only goal, minimal `output_schema`). |
| `src/parse.ts` | Page-family parsers: HTML in, typed objects out, structural failures throw `SITE_CHANGED`. |
| `src/schemas.ts` | Zod input/output contracts shared by the tools and tests. |
| `src/health.ts`, `src/healthcli.ts` | Nine live/offline checks; CLI exits non-zero on failure. |
| `src/diff.ts` | Per-machine snapshot persistence and pure listing diff. |
| `src/errors.ts`, `src/util.ts` | Typed error envelope; host allowlist and URL resolution. |

Both transports register the same tools. Tool results are validated against their zod output schema before they leave `wrap()`; a mismatch becomes a typed `SITE_CHANGED` error rather than malformed JSON.

## 5. Tool surface (16 tools)

Every tool returns `structuredContent` validated against a schema in `src/schemas.ts`. The table abbreviates output fields; the schema is authoritative.

| Tool | Input | Output (selected fields) | TinyFish path |
|---|---|---|---|
| `list_hackathons` | `status` (upcoming/ongoing/past/all), `format?`, `search?`, `limit` | `count`, `items[{title,url,location,formats,kind,prize,dateText,startDate,endDate,status,external}]`, `source:"dom"`, `asOf`, `note` | Fetch `/hackathons` + filter |
| `get_hackathon` | `hackathon` (slug/path/WeMakeDevs URL), `sections?` (section ids, max 20) | `url,title,prizePool,when,where,teams`, `sections[{id,heading,blocks}]`, `faq[]`, `links[]` | Fetch detail page |
| `get_hackathon_rules` | `hackathon` | `url,title,sections[],links[]` | Fetch `…/rules` |
| `get_hackathon_schedule` | `hackathon` | `url`, `items[{whenText,date,title,detail,state}]` | Fetch `…/schedule` |
| `get_hackathon_resources` | `hackathon` | `url,title`, `groups[{name,links[{label,url,note}]}]`, `commands[]` | Fetch `…/resources` |
| `check_registration_status` | `hackathon` | `state` (open/closed/upcoming/unknown), `opensAt`, `closesAt`, `registeredCount`, `notes`, `observedAt`, `method:"tinyfish-agent"` | **Agent**, read-only |
| `list_meetups` | `city?`, `search?`, `limit` | `count`, `items[{title,url,location,dateText,description}]`, `asOf` | Fetch `/meetups` + filter |
| `list_open_roles` | `limit` | `count`, `items[{title,url,postedAt,location,kind,compensation,tags}]`, `note`, `asOf` | Fetch `/careers` + filter |
| `list_scholarships` | none | `program,status,statusText`, `covers[]`, `winners[]`, `faqs[{question,answer|null}]` | Fetch `/scholarships` |
| `list_blog_posts` | `limit`, `tag?`, `search?` | `count`, `items[{title,url,pubDate,description,author,categories}]`, `source:"rss"`, `asOf` | Fetch raw `/blogs/rss.xml` |
| `search_blog` | `query`, `tag?`, `limit` | Same shape as `list_blog_posts`, filtered | Fetch raw RSS |
| `get_blog_post` | `post` (slug/path/URL) | RSS metadata + `paragraphs[]` + `links[]` | Fetch RSS + article page |
| `upcoming_deadlines` | `within_days` (≤365) | `items[{kind:hackathon-start\|hackathon-end,title,date,url}]`, `note` | Fetch `/hackathons` |
| `latest_updates` | `within_days` (≤365) | `items[{kind:blog\|hackathon-start\|hackathon-end,title,date,url,summary}]`, `note` | Fetch RSS + `/hackathons` in parallel |
| `get_hackathon_changes` | `hackathon?`, `update_baseline?` (default true) | `added[]`, `removed[]`, `changed[{fields[{field,before,after}]}]`, baseline metadata, `note` | Fetch `/hackathons` + local prior snapshot |
| `health_check` | `target?` (`all` or one of the nine check names) | `ok`, `mode` (live/offline/stub), `checkedAt`, `results[]` | Fetch sentinels, `ttl:0` |

Shared semantics:

- **Hackathon status** is computed from ISO dates against "now". `unknown` means at least one date could not be parsed. Unknown items are included before `limit` is applied and noted only when one appears in the returned slice. A date-only `endDate` is inclusive through 23:59:59 UTC of that day.
- **`kind`** means format for a hackathon (`online`/`in-person`/`hybrid`/`unknown`), employment type for a role, and feed entry type for an update. The schema is the authority in each case.
- **`external`** is true when an event's URL is outside `wemakedevs.org`. `source:"dom"` means the listing was parsed from rendered cards; TinyFish Fetch does not expose scripts, so this is the only path.
- **`blocks`** are typed page fragments (`heading`, `paragraph`, `list`, `pre`). Sections are capped at 120 blocks; each text block is capped at 4,000 characters and flagged `truncated` when cut. Use `sections` to keep responses small.
- **`search_blog` is an alias** for `list_blog_posts` with a required `query` instead of optional `search`; both read the same RSS feed. `upcoming_deadlines` is the deadline-only view of the same hackathon data used by `latest_updates`. The pair exists because models select a purpose-named tool more reliably than a mode flag; merging them is a post-submission change.
- **`list_scholarships` FAQ answers are nullable.** The accordion bodies are client-rendered; Fetch strips scripts, so live calls normally return questions with `answer: null`.

## 6. Extraction contract

The design states what each page family must yield and how it fails, not the CSS selectors. Selectors live in `src/parse.ts` and change with the site.

| Page family | Read | Contract | Failure behavior |
|---|---|---|---|
| `/hackathons` | Rendered event cards | Title, absolute URL, location, format, prize text, display date, inferred ISO start/end, status, external flag. Display dates without a year mean the current year; `dateText` is always returned verbatim. | Zero cards, or no machine-readable start date → `SITE_CHANGED`. |
| `/hackathons/{slug}` and `/rules` | Verbatim body, stripped of script/style/svg/nav/footer/header | `<main>` sections with ids, typed blocks, FAQ from `<details>`, links, hero meta strip. Rules pages without section ids become one `content` section. | Missing title or expected structure → `SITE_CHANGED`; legal markers are asserted by health. |
| `/hackathons/{slug}/schedule` | Ordered milestone list | Display text plus `<time datetime>` when present; `state` distinguishes an explicit date from a marker such as "Open now". | Fewer than four milestones or no ISO date in health → `SITE_CHANGED`. |
| `/hackathons/{slug}/resources` | Grouped link lists | Group heading, links with label/URL/note, CLI snippets. | Fewer than three groups or eight links in health → `SITE_CHANGED`. |
| `/meetups` | Rendered cards | Title, URL, location, display date text, description. Dates are not converted to ISO. | Zero cards with no explicit empty state → `SITE_CHANGED`; an empty state is valid. |
| `/careers` | Role cards | Title, URL, posting date, tags, location, kind, compensation. | Zero roles with no explicit empty state → `SITE_CHANGED`; "No open roles right now" is valid. |
| `/scholarships` | Sections and accordion buttons | Program, status, coverage, winners, FAQ questions. Answers are best-effort and normally `null`. | Missing program, coverage list or questions → `SITE_CHANGED`. |
| `/blogs/rss.xml` | Raw XML (no selector) | Case-insensitive item parsing; tolerates Fetch's lowercased tags and `<link/>URL` serialization. | No parseable `pubDate` → `SITE_CHANGED`. |
| `/blogs/{slug}` | Verbatim article body | Title, first `<time datetime>`, paragraphs and resolved links scoped to `<article>` when present. | Missing article structure → `SITE_CHANGED`. |

## 7. Health and verification

`runHealthChecks` runs nine checks. Each reports `ok`, `soft`, `ms` and `detail`; the report is healthy when every check is `ok`. All checks are currently hard requirements (`soft` is always false).

| Check | Asserts |
|---|---|
| `hackathons-listing` | ≥10 rendered cards, title/URL present, ≥1 ISO start date, and the sentinel event (`switch` by default) is present in the listing. |
| `hackathon-detail` | h1 title, ≥4 sections with ids, a prizes section, ≥3 FAQs. |
| `hackathon-schedule` | ≥4 milestones, ≥1 machine-readable date. |
| `hackathon-resources` | ≥3 groups, ≥8 links. |
| `rules-page` | Official-rules legal markers and a parseable section AST. |
| `meetups-listing` | Cards parse, or the page shows an explicit empty state. |
| `careers` | A role parses, or the page shows "No open roles right now". |
| `scholarships` | Program, coverage list and FAQ questions parse; detail reports how many answers Fetch exposed. |
| `blog-rss` | ≥1 item with a parseable `pubDate`. |

Verification surfaces:

- `npm test` — 31 tests (unit + HTTP transport). Includes parser fixtures, diff logic, HTTP auth/routing/Host/Origin regressions, and both protocol eras.
- `npm run smoke:stub` — starts the local fixture stub and calls all 16 tools offline; asserts schema-valid `structuredContent`.
- `npm run smoke` / `smoke:all` — live stdio: 15 fast tools, then 16 with the Agent call.
- `npm run smoke:http` — live HTTP: auth rejection, 16 tools, one live call.
- `npm run health` — live 9/9; `WEMAKEDEVS_MCP_HEALTH_OFFLINE=1` runs the same checks on fixtures in CI.
- GitHub Actions: CI runs build, tests, offline health and the offline 16-tool smoke on every push. The weekly live workflow runs only when `TINYFISH_API_KEY` is configured and skips with a notice otherwise.

A health failure means the site's structure changed enough to break a parser. It does not detect every possible regression: a field rename that preserves counts and markers can pass. Output validation catches the resulting schema mismatch at call time.

## 8. Error model

Handler errors use `WemakedevsError{code, message, url?, hint?}` and are returned as `isError: true` with a JSON body. The codes:

| Code | Trigger |
|---|---|
| `CONFIG` | `TINYFISH_API_KEY` missing or rejected by TinyFish (401/403); missing `MCP_HTTP_TOKEN` on a non-loopback bind. |
| `FETCH_FAILED` | Network failure, non-2xx TinyFish Fetch response, or a per-URL Fetch error that is not a 404. |
| `AGENT_FAILED` | Network failure, non-2xx Agent response, or an Agent run reported as failed. |
| `NOT_FOUND` | TinyFish reports a 404 for the requested page. |
| `SITE_CHANGED` | Expected structure is gone, the page is suspiciously small, or a tool's output fails its zod schema. |
| `VALIDATION_FAILED` | Bad tool arguments, a non-WeMakeDevs host, or an unknown section id. |
| `PARSE_FAILED` | Fallback for an unexpected exception. |

SDK-level **input** schema validation happens before the handler and surfaces as the SDK's own `isError` text; handler and output errors use the envelope above. The health hint (`npm run health`) is attached to site-structure errors, not to every failure.

## 9. Security and operations

- **stdio is the default.** The HTTP transport is optional at runtime but shipped and tested. It is stateless and POST-only: no sessions, no standalone SSE, no resumability.
- **TLS is required before exposing the port.** The server speaks plain HTTP; a public deployment must terminate TLS in front of it.
- **Auth:** `Authorization: Bearer <MCP_HTTP_TOKEN>`, compared with `timingSafeEqual`. Non-loopback binds refuse to start without a token. Loopback mode is trusted-local and unauthenticated.
- **Host and Origin are exact allowlists.** The incoming `Host` never enters its own allowlist; lookalikes such as `http://localhost.evil.com` are rejected. A bad Host gets 403 before the body is read.
- **Bounds:** `MCP_HTTP_MAX_BODY_BYTES` (default 4 MiB) and `maxToolInputElements: 256` cap request size.
- **OAuth is out of scope.** ChatGPT connectors still need an OAuth proxy; the bearer token covers Claude Code and other Streamable HTTP clients.

Design-level configuration:

| Variable | Required | Purpose |
|---|---|---|
| `TINYFISH_API_KEY` | yes (every tool) | TinyFish Fetch and Agent authentication. |
| `MCP_HTTP_TOKEN` | non-loopback HTTP | Bearer token; omitted only for trusted loopback use. |
| `MCP_HTTP_HOSTS` / `MCP_HTTP_ORIGINS` | no | Exact extra Host/Origin values, including port where non-default. |
| `WEMAKEDEVS_MCP_STATE_DIR` | no | Snapshot directory for `get_hackathon_changes`; defaults to `~/.cache/wemakedevs-mcp`. |
| `HEALTH_SENTINEL_SLUG` | no | Event slug used as the health canary; defaults to `switch`. |

See the [README](../README.md) for install commands and the full environment table.

**Latency and cost.** Fetch calls take roughly 3–5 s; a full `health_check` fans out nine Fetches in parallel. Agent calls take 20–120 s, so clients should allow at least 120 s. There is no upstream timeout, retry, backoff or concurrency limiter: retrying a `ttl: 0` read is a fresh billable call, and a retry would delay the loud failure the design relies on. TinyFish is an external single point of failure; its quota and 429 behavior are not documented here because the repo has no measured data for them.

**Snapshots.** `get_hackathon_changes` stores prior observations on the local machine. The first call creates a baseline; later calls diff against it. Over the stateless HTTP transport, each container/process has its own state directory, so a fresh deployment starts a new baseline. This is a local convenience, not shared history.

## 10. Known limitations

- Listing dates are inferred from display text. Yearless dates mean the current year; a December/January boundary can misyear an event if the site changes that convention. `dateText` is always returned verbatim.
- The listing parser depends on the card DOM. Health catches structural loss (counts, markers, sentinel); a field rename that preserves those can pass until output validation rejects the tool result.
- Scholarship FAQ answers are normally `null` because the answer bodies are client-rendered and Fetch strips scripts.
- Meetup dates are display text ("Oct 27"), not ISO, and are excluded from `upcoming_deadlines`.
- `/careers` can legitimately be empty; the tool returns `{count: 0, items: [], note}`.
- Archive events (`archive.wemakedevs.org`) are parsed best-effort. External events (Devpost/Luma) are listed with their URLs; detail tools refuse non-WeMakeDevs hosts.
- Agent latency is 20–120 s and the server sets no upstream timeout. The Agent `output_schema` accepts only a minimal JSON Schema subset (no `additionalProperties`, no `description`).
- Fixtures are a 2026-11-05 snapshot; parser tests can rot as the site changes. The stub smoke and live health are the guards.
- The HTTP transport has no sessions, SSE stream or resumability. A modern 2026-07-28 request must carry `MCP-Protocol-Version` and `Mcp-Method`; the SDK returns a 400 naming a missing header.
- HTTP auth is one shared bearer token, not OAuth. Browser CORS is closed by default; loopback origins are allowed on any port.
- Inspector `--strict` reports 52 portability warnings because zod emits nullable fields as `type: ["string","null"]`. There are 0 schema errors; clients that map schemas to a single-type OpenAPI dialect may drop the null branch.
- The npm package is not published; install from source.

## 11. Risks and mitigations

1. **Site redesign breaks the DOM parser.** Mitigation: rendered-card parser, nine health checks, sentinel assertion, output schema validation, `SITE_CHANGED` with a health hint. Residual: a field rename that preserves counts can pass health and fail only at call time.
2. **The sentinel event is retired or redesigned.** Mitigation: `HEALTH_SENTINEL_SLUG` override; health fails loudly rather than silently skipping the canary. Residual: the override must be updated by an operator.
3. **Fixtures rot.** Mitigation: offline stub smoke in CI plus the weekly live health workflow. Residual: the live workflow requires the repository secret and is skipped without it.
4. **Agent latency and schema constraints.** Mitigation: use Agent for one tool only; document a ≥120 s client timeout; send the minimal `output_schema`. Residual: slow or failed Agent runs make registration status unavailable.
5. **Local snapshots are per-machine.** Mitigation: the contract is explicit; no global history is claimed. Residual: `get_hackathon_changes` is not useful across a hosted fleet.
6. **External TinyFish dependency and quota.** Mitigation: typed failures, no retries that amplify usage, health fan-out bounded to nine calls. Residual: no quota or 429 data; a TinyFish outage fails every tool.
7. **HTTP exposure.** Mitigation: loopback default, token required off-loopback, exact Host/Origin, body bounds, TLS documented. Residual: one shared token with no rotation or per-client identity, and no authentication on loopback.
8. **Bounty judged on "value".** Mitigation: full-site coverage and a real seven-tool task transcript. Residual: the audience is niche; judging is outside the project's control.

## 12. Submission status

Required and done: public repo, README, LICENSE, design and verification docs, green CI, live TinyFish Fetch and Agent calls, live 9/9 health, offline 16-tool smoke, both protocol eras.

Required and pending: the LinkedIn post tagging TinyFish and the Discord `#showcase` post, which the author publishes from [POSTS](POSTS.md), then records the URLs in the bounty form.

Optional and deferred: npm publish, OAuth for ChatGPT connectors, merging the alias tool pairs, upstream retry/timeout policy. The checklist and exact commands are in [SUBMISSION](SUBMISSION.md).
