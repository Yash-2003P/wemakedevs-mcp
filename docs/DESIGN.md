# WeMakeDevs MCP — Design Document

An MCP (Model Context Protocol) server that turns wemakedevs.org — a site with no documented public API — into typed agent tools. Hackathons, timelines, resource hubs, rules, blogs, meetups, scholarships and careers become structured JSON for any MCP client. TinyFish does the real web work behind every tool at run time.

Status: **implemented and live-verified on 2026-11-07**. 16 tools, 20 unit tests, 9/9 live health checks green, every tool exercised through a real MCP stdio client against TinyFish Fetch and Agent.

## 1. Problem

WeMakeDevs runs 30+ hackathons a year, meetups in 9+ cities, scholarships and occasional hiring. None of it has a documented public API; everything agents might want ("which hackathons are open, what are the prizes, when is the deadline, is registration still open?") is behind HTML pages, some content rendered client-side. This server is that interface: typed inputs, typed outputs, works in Claude Code / Desktop / Cursor / OpenCode or any MCP client.

## 2. Bounty constraints (design drivers)

From the TinyFish "Site → MCP" rules (v2026-11):

- An MCP server with clear, typed inputs and outputs, with TinyFish doing the reading/clicking underneath.
- TinyFish does the real web work behind every tool; no canned data; works for different inputs; breaks loudly when the site changes; no padding TinyFish usage to reach a higher leaderboard tier (2 endpoints = 100 pts; each must be load-bearing).
- Exclusions: licence checks and property records are separate bounties — not applicable here.
- Submission: working build, README, notes on how TinyFish Agent and Fetch are used, one LinkedIn post tagging TinyFish (required), #showcase Discord post; top 3 approved; one submission per person; deadline 17 Nov 2026, 11:59 PT.
- Reputation constraint: anything that looks like a re-served backend (WeMakeDevs operates an undocumented, unauthenticated backend at `wemakedevs-server.onrender.com`) would void "TinyFish does the real web work". The design forbids calling it.

## 3. Key decisions

1. **Nothing is pre-scraped and nothing is cached at bake time.** Every tool fetches live via TinyFish Fetch (`ttl: 0`). The serving path never reads fixtures. If TinyFish is unreachable, the tool fails with a typed error — it never falls back to stale or canned data.
2. **Two TinyFish endpoints, both load-bearing.** Fetch reads every page (listing, details, rules, schedule, resources, meetups, careers, scholarships, RSS). Agent is used for the one thing Fetch cannot see: the registration panel, which renders client-side behind "Loading…" and is observed through a real browser with `output_schema`. No ceremonial Agent/Browser/Search calls.
3. **Read the rendered DOM, not the flight payload.** wemakedevs.org is Next.js, but live Fetch strips `<script>` blocks even with `include_selectors: ["body"]`, so `self.__next_f` / `"cards"` is unreachable. Verbatim body mode does preserve the server-rendered cards, section ids, FAQ `<details>` and resource links. The listing parser therefore reads card anchors (`<a><h3>title</h3><p>prize</p></a>` plus location/date chips) and converts display dates to ISO. The site prints a year only for non-current years, so a yearless display date means the current year; this is reported in output notes.
4. **Loud failure everywhere.** All outputs zod-validated; any schema mismatch is a typed error (`SITE_CHANGED | VALIDATION_FAILED | FETCH_FAILED | AGENT_FAILED | NOT_FOUND | CONFIG | PARSE_FAILED`) with a hint pointing at `npm run health`. MCP responses set `isError: true`.
5. **Leaderboard honesty.** 2 endpoints ≈ 100 pts. Adding more would be padding; deliberately not done.

## 4. Architecture

```text
MCP client (stdio)
   │  set TINYFISH_API_KEY
   ▼
src/index.ts ── registerTools(src/tools.ts)
   │  per tool: zod input → handler → zod output → {content[JSON], structuredContent}
   ├── src/tinyfish.ts     Fetch client (POST api.fetch.tinyfish.ai, ttl:0, per-URL errors surfaced)
   │                        Agent client (POST agent.tinyfish.ai/v1/automation/run, output_schema)
   ├── src/parse.ts        page parsers (all take html, return typed objects, throw SITE_CHANGED)
   ├── src/extract.ts      flight-data `cards` extractor (kept as a fast path if scripts ever return)
   ├── src/diff.ts         snapshot persistence + pure diff for get_hackathon_changes
   ├── src/health.ts       health checks (live via Fetch, offline via committed fixtures)
   └── src/healthcli.ts    `npm run health` CLI (JSON report, exit 1 on failure)
test/parse.test.ts         parser tests against committed fixtures (node:test)
test/diff.test.ts          display-date and snapshot-diff tests
test/fixtures/*.html       public pages snapshot 2026-11-05 + RSS/schedule/resources/blog post
scripts/stub-tinyfish.mjs  opt-in local stub (frozen fixtures, NOT TinyFish)
```

Tool call flow: `fetchPages(url, {includeSelectors:['body']})` → `results[0].text` (HTML) → parser → zod → result. Agent flow: `runAgent(url, goal, output_schema)` → zod-validate → result.

## 5. Tool surface (16 tools)

All return `structuredContent` validated against zod schemas (`src/schemas.ts`).

| Tool | Input | Output (abbrev) | TinyFish path |
|---|---|---|---|
| list_hackathons | status (upcoming/ongoing/past/all), format?, search?, limit | items[{title,url,location,formats,kind,prize,dateText,startDate,endDate,status,external}], source, note | Fetch /hackathons + filter |
| get_hackathon | hackathon (slug/path/URL on wemakedevs.org hosts only), sections? | url,title,prizePool,when,where,teams, sections[{id,heading,blocks}], faq[], links[] | Fetch detail page |
| get_hackathon_rules | hackathon | url,title,sections[],links[] | Fetch …/rules |
| get_hackathon_schedule | hackathon | url, items[{whenText,date,title,detail,state}] | Fetch …/schedule |
| get_hackathon_resources | hackathon | url,title, groups[{name,links[{label,url,note}]}], commands[] | Fetch …/resources |
| check_registration_status | hackathon | state(open/closed/upcoming/unknown)+opensAt/closesAt/registeredCount/notes, observedAt, method="tinyfish-agent" | **Agent** (read-only) |
| list_meetups | city?, search?, limit | items[{title,url,location,dateText,description}] | Fetch /meetups + filter |
| list_open_roles | limit | items[{title,url,postedAt,location,kind,compensation,tags}] or [] + note on empty state | Fetch /careers + filter |
| list_scholarships | — | {program, status, statusText, covers[], winners[], faqs[{question, answer|null}]} | Fetch /scholarships |
| list_blog_posts | limit, tag?, search? | {count, items[{title,url,pubDate,description,author,categories}], source:"rss"} | Fetch raw /blogs/rss.xml |
| search_blog | query, tag?, limit | same shape, filtered | Fetch raw RSS |
| get_blog_post | post (slug/path/URL) | RSS metadata + paragraphs[] + links[] | Fetch RSS + article page |
| upcoming_deadlines | within_days (≤365) | items[{kind:hackathon-start|hackathon-end,title,date,url}], note | Fetch /hackathons + merge |
| latest_updates | within_days (≤365) | items[{kind:blog|hackathon-start|hackathon-end,title,date,url,summary}], note | Fetch RSS + /hackathons in parallel |
| get_hackathon_changes | hackathon?, update_baseline? | added[], removed[], changed[{fields[{field,before,after}]}], baseline metadata | Fetch /hackathons + local prior snapshot |
| health_check | target? | {ok, mode, checkedAt, results[]} | Fetch sentinels, ttl:0 |

Status semantics (hackathons): computed from ISO dates vs "now"; `unknown` when unparseable — unknown items are *included* in any status filter (never silently dropped) and flagged in `note`. A date-only `endDate` is inclusive through 23:59:59 UTC of that day, so an event ending today is `ongoing`, not `past`.

## 6. Extraction strategy (page by page)

| Page | Strategy |
|---|---|
| /hackathons | Rendered DOM: `a` cards with `h3`, a date chip, a location chip and a prize `<p>`. Display dates → ISO via `parseDisplayDate` (single day, same-month/cross-month ranges, month-only, explicit years). Flight-data extractor is tried first but unreachable live. |
| /hackathons/{slug} | cheerio: strip script/style/svg/nav/footer/header; `<main>`→`section[id]` AST; blocks capped (4000 chars); FAQ via `<details><summary>`; meta strip via ordered `When…Where…Teams…Prize pool` scan |
| /hackathons/{slug}/schedule | `ol > li` whose first direct `<p>` is the mono date/marker column (excludes the embedded demo chat transcript); `<time datetime>` becomes ISO, otherwise `state:"marker"` with the display text |
| /hackathons/{slug}/resources | `h3` group heading → following `ul`; `a[href]` label + note from the sibling `<p>`; CLI snippets from `<pre>/<code>` |
| detail/rules | same AST; rules has no `section[id]` → single `content` section |
| /meetups | DOM: `a[href]:has(h3)`; two `.translate-y-[1px]` chips = [location, dateText]; dates are display text, never parsed |
| /careers | `a[href^="/careers/"]`; `time[datetime]`; li chips → compensation/kind/location by regex heuristics; empty state detected ("no open roles" text) → return [] not error |
| /scholarships | "What it covers" h2→h3/p items; status sentence regex; winners from `img[alt$=" profile photo"]`; FAQ questions from Radix `button[aria-controls]` |
| /blogs/rss.xml | Raw XML (no selector scope: selector mode mangles `<link>`). Case-insensitive regex extraction per `<item>`; tolerates Fetch's lowercased tags and `<link/>URL` serialization |
| /blogs/{slug} | Fetch verbatim body; h1/title + first `<time datetime>` from `<main>`; paragraphs and links scoped to `<article>` when present |

## 7. Health check & CI

`runHealthChecks` — 9 checks (all required; each reports ok/soft/ms/detail):
hackathons-listing (≥10 cards, ≥1 ISO start date, sentinel present) · hackathon-detail (h1, ≥4 `section[id]`, prizes section, ≥3 FAQs) · hackathon-schedule (≥4 milestones, ≥1 ISO date) · hackathon-resources (≥3 groups, ≥8 links) · rules-page (legal markers) · meetups-listing (cards or explicit empty state) · careers (≥1 role or explicit empty state) · scholarships (program, coverage list, FAQs) · blog-rss (≥1 item, parseable pubDate).

- `WEMAKEDEVS_MCP_HEALTH_OFFLINE=1 npm run health` — fixtures only, no network (used by CI on PRs).
- `.github/workflows/health.yml` — weekly live check; needs `secrets.TINYFISH_API_KEY`.
- `health_check` MCP tool exposes the same checks to agents (isError=true when unhealthy).

Live result on 2026-11-07: 9/9 green, 35 events parsed from the rendered DOM, all 35 with inferred ISO dates, 6 schedule milestones, 5 resource groups / 21 links, 20 RSS posts.

## 8. Testing state

`npm test` → 20 tests, all green:

- Hackathon flight extraction/dedupe/status classification (frozen "now" = 2026-11-05).
- Display-date parsing: single day, same-month range, cross-month range, month-only, explicit year.
- End-of-day inclusivity for date-only end dates.
- Diff logic: baseline creation, added/removed/field-level changes, single-event scope.
- Meetups, careers, scholarships, detail AST, FAQ, meta strip, HTML-leak check.

Not covered by unit tests: live TinyFish response shapes, live latency, Agent output. These were verified manually through a stdio MCP client on 2026-11-07 (16 tools listed; Fetch tools returned live data; Agent returned `state=open`, `registeredCount=7689` in 39 s; live health 9/9).

## 9. Error model

`WemakedevsError{code, message, url?, hint?}` — codes: CONFIG (missing/rejected key), FETCH_FAILED, AGENT_FAILED, NOT_FOUND (404), SITE_CHANGED (structure gone/tiny page), VALIDATION_FAILED (bad args/host allowlist), PARSE_FAILED (fallback for unknown exceptions). Tools surface them as `isError:true` + JSON body; health CLI prints JSON and exits 1.

## 10. Known limitations

- Listing dates are inferred from display text; yearless dates mean the current year (site convention). `dateText` is always returned verbatim alongside the inferred ISO dates.
- The listing parser depends on the card DOM (scripts are stripped by Fetch); a redesign is caught by `health_check`, not silently ignored.
- Meetup dates are display text ("Oct 27") — not ISO; excluded from `upcoming_deadlines`.
- `/careers` can legitimately be empty; the tool returns `[]` with a note.
- Archive events (archive.wemakedevs.org) are listed and parseable as detail pages, best-effort fidelity.
- External events (devpost/Luma) listed with URLs; `get_hackathon` refuses non-WeMakeDevs hosts.
- Agent latency is 20–120 s; clients need a matching request timeout. Live run: 39 s.
- TinyFish Agent `output_schema` rejects `additionalProperties` and `description`; only the minimal subset is sent.
- Snapshot diffs are per-machine (`~/.cache/wemakedevs-mcp` by default); there is no shared server-side history.
- Fixture snapshot is 2026-11-05; parser tests can rot as the site changes — CI health check is the live guard.
- Package is not published to npm; install from source.

## 11. Submission state vs bounty checklist

Done: repo, README (install, 16-tool table, real live transcript, TinyFish usage, health docs, limitations), git history, LICENSE, SUBMISSION.md checklist, CI (build/test/offline health), weekly live health workflow, .env.example, live-verified Fetch and Agent, live 9/9 health, real multi-step stdio run.

Not done: GitHub repo creation & push; LinkedIn post tagging TinyFish; #showcase Discord post; npm publish.

## 12. Risks

1. **Site redesign breaks the DOM parser.** Realized risk: Fetch strips scripts, so the design no longer depends on the flight payload. Mitigation: rendered-card parser + nine health checks + `SITE_CHANGED` with a hint. Residual: a silent field rename could pass if counts still satisfy thresholds; output notes expose the source.
2. **Health check sentinel (`switch`) is time-bound.** The check asserts structure, not registration status; override via `HEALTH_SENTINEL_SLUG` if the page is retired or redesigned.
3. **Single fixture snapshot.** Unit tests can rot while live parsing degrades; weekly CI is the mitigation but only runs if the secret is configured.
4. **Agent latency and schema constraints.** 20–120 s is slow for an interactive client; the registration panel is the only source for live registration state, so the trade-off is deliberate. The minimal `output_schema` subset is enforced by live testing.
5. **Local snapshot diff is per-machine.** `get_hackathon_changes` is honest about this: it compares against prior observations, never pretends to a global history.
6. **Bounty judged on "value".** Covering all of WeMakeDevs (16 tools) mitigates but does not eliminate the niche-audience critique.
