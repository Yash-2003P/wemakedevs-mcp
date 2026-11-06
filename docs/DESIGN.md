# WeMakeDevs MCP — Design Document

An MCP (Model Context Protocol) server that turns wemakedevs.org — a site with no documented public API — into typed agent tools. Hackathons, meetups, scholarships and careers become structured JSON for any MCP client. TinyFish does the real web work behind every tool at run time.

Status: implemented (single commit `27c3792`), unit-tested against fixtures, offline health check green, but never exercised against the live TinyFish API (no key in the dev environment).

## 1. Problem

WeMakeDevs runs 30+ hackathons a year, meetups in 9+ cities, scholarships and occasional hiring. None of it has a documented public API; everything agents might want ("which hackathons are open, what are the prizes, is registration still open?") is behind HTML pages, some content rendered client-side. This server is that interface: typed inputs, typed outputs, works in Claude Code / Desktop / Cursor / ChatGPT or any MCP client.

## 2. Bounty constraints (design drivers)

From the TinyFish "Site → MCP" rules (v2026-11):

- An MCP server with clear, typed inputs and outputs, with TinyFish doing the reading/clicking underneath.
- TinyFish does the real web work behind every tool; no canned data; works for different inputs; breaks loudly when the site changes; no padding TinyFish usage to reach a higher leaderboard tier (2 endpoints = 100 pts; each must be load-bearing).
- Exclusions: licence checks and property records are separate bounties — not applicable here.
- Submission: working build, README, notes on how TinyFish Agent and Fetch are used, one LinkedIn post tagging TinyFish (required), #showcase Discord post; top 3 approved; one submission per person; deadline 17 Nov 2026, 11:59 PT.
- Reputation constraint: anything that looks like a re-served backend (WeMakeDevs operates an undocumented, unauthenticated backend at `wemakedevs-server.onrender.com`) would void "TinyFish does the real web work". The design forbids calling it.

## 3. Key decisions

1. **Nothing is pre-scraped and nothing is cached at bake time.** Every tool fetches live via TinyFish Fetch (`ttl: 0`). The serving path never reads fixtures. If TinyFish is unreachable, the tool fails with a typed error — it never falls back to stale or canned data.
2. **Two TinyFish endpoints, both load-bearing.** Fetch reads every page (listing, details, rules, meetups, careers, scholarships). Agent is used for the one thing Fetch cannot see: the registration panel, which renders client-side behind "Loading…" and is observed through a real browser with `output_schema`. No ceremonial Agent/Browser/Search calls.
3. **Prefer embedded data over DOM scraping.** wemakedevs.org is Next.js; the SSR HTML embeds the full event dataset as escaped JSON in `self.__next_f.push` flight chunks (`\"cards\":[…]`). The parser decodes it deterministically (balanced-bracket scan → one JSON unescape → JSON parse → validate). If WeMakeDevs changes the embedding, it falls back to DOM cards (no dates) or, failing both, throws `SITE_CHANGED` — never partial garbage.
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
   ├── src/extract.ts      flight-data `cards` extraction (escaped & unescaped forms)
   ├── src/health.ts       health checks (live via Fetch, or offline via committed fixtures)
   └── src/healthcli.ts    `npm run health` CLI (JSON report, exit 1 on failure)
test/parse.test.ts         parser tests against committed fixtures (node:test)
test/fixtures/*.html       raw pages snapshot 2026-11-05 (public content)
```

Tool call flow: `fetchPages(url)` → `results[0].text` (HTML) → parser → zod → result. Agent flow: `runAgent(url, goal, output_schema)` → zod-validate → result.

## 5. Tool surface (9 tools)

All return `structuredContent` validated against zod schemas (`src/schemas.ts`).

| Tool | Input | Output (abbrev) | TinyFish path |
|---|---|---|---|
| list_hackathons | status (upcoming/ongoing/past/all), format?, search?, limit | items[{title,url,location,formats,kind,prize,dateText,startDate,endDate,status,external}], source, note | Fetch /hackathons + filter |
| get_hackathon | hackathon (slug/path/URL on wemakedevs.org hosts only), sections? | url,title,prizePool,when,where,teams, sections[{id,heading,blocks}], faq[], links[] | Fetch detail page |
| get_hackathon_rules | hackathon | url,title,sections[],links[] | Fetch …/rules |
| check_registration_status | hackathon | state(open/closed/upcoming/unknown)+opensAt/closesAt/registeredCount/notes, observedAt, method="tinyfish-agent" | **Agent** (read-only) |
| list_meetups | city?, search?, limit | items[{title,url,location,dateText,description}] | Fetch /meetups + filter |
| list_open_roles | limit | items[{title,url,postedAt,location,kind,compensation,tags}] or [] + note on empty state | Fetch /careers + filter |
| list_scholarships | — | {program, status, statusText, covers[], winners[], faqs[{question, answer|null}]} | Fetch /scholarships |
| upcoming_deadlines | within_days (≤365) | items[{kind:hackathon-start|hackathon-end,title,date,url}], note | Fetch /hackathons + merge |
| health_check | target? | {ok, mode, checkedAt, results[]} | Fetch sentinels, ttl:0 |

Status semantics (hackathons): computed from ISO dates vs "now"; `unknown` when unparseable — unknown items are *included* in any status filter (never silently dropped) and flagged in `note`.

## 6. Extraction strategy (page by page)

| Page | Strategy |
|---|---|
| /hackathons | flight-data `cards` JSON (34 events, ISO dates). Fallback: DOM cards (h3 + img), else `SITE_CHANGED` |
| /hackathons/{slug} | cheerio: strip script/style/svg/nav/footer; `<main>`→`section[id]` AST; blocks capped (4000 chars); FAQ via `<details><summary>`; meta strip via ordered `When…Where…Teams…Prize pool` scan |
| detail/rules | same AST; rules has no `section[id]` → single `content` section |
| /meetups | DOM: `a[href]:has(h3)`; two `.translate-y-[1px]` chips = [location, dateText]; dates are display text, never parsed |
| /careers | `a[href^="/careers/"]`; `time[datetime]`; li chips → compensation/kind/location by regex heuristics; empty state detected ("no open roles" text) → return [] not error |
| /scholarships | "What it covers" h2→h3/p items; status sentence regex; winners from `img[alt$=" profile photo"]`; FAQ questions from Radix `button[aria-controls]`, answers from flight data `dangerouslySetInnerHTML.__html` (regions are empty in SSR) |

## 7. Health check & CI

`runHealthChecks` — 6 checks (all must pass; each reports ok/soft/ms/detail):
hackathons-listing (≥25 cards, ISO dates, source reported) · hackathon-detail (sentinel slug, default `switch`, env `HEALTH_SENTINEL_SLUG`; h1, ≥4 `section[id]`, prizes section, ≥3 FAQs) · rules-page (legal markers) · meetups-listing (≥8 cards) · careers (≥1 role or empty-state ok) · scholarships (parses, ≥3 covers).

- `WEMAKEDEVS_MCP_HEALTH_OFFLINE=1 npm run health` — fixtures only, no network (used by CI on PRs).
- `.github/workflows/health.yml` — weekly live check; needs `secrets.TINYFISH_API_KEY`.
- `health_check` MCP tool exposes the same checks to agents (isError=true when unhealthy).

## 8. Testing state

`npm test` → 11 parser tests (all green as of fixture capture): cards extraction/dedupe/status classification (frozen "now" = 2026-11-05), meetups ≥10 with location/date assertions, careers ≥2 roles, scholarships program/status/covers/winners/faqs, detail AST sections/HTML-leak check, FAQ ≥5, meta-strip regexes.

Not covered: live TinyFish response shapes (fetch endpoint result envelope; Agent `/run` response), live latency, MCP protocol round-trip in tests (verified manually via a stdio client smoke script: tools/list returns 9 tools; unauthenticated calls return typed `CONFIG` errors).

## 9. Error model

`WemakedevsError{code, message, url?, hint?}` — codes: CONFIG (missing/rejected key), FETCH_FAILED, AGENT_FAILED, NOT_FOUND (404), SITE_CHANGED (structure gone/tiny page), VALIDATION_FAILED (bad args/host allowlist), PARSE_FAILED (fallback for unknown exceptions). Tools surface them as `isError:true` + JSON body; health CLI prints JSON and exits 1.

## 10. Known limitations

- Meetup dates are display text ("Oct 27") — not ISO; excluded from `upcoming_deadlines`.
- Archive events (archive.wemakedevs.org) are listed and parseable as detail pages, best-effort fidelity.
- External events (devpost/Luma) listed with URLs; `get_hackathon` refuses non-WeMakeDevs hosts.
- Scholarship FAQ answers recovered from flight data; if that embedding changes, answers return `null` (health check flags it).
- Fixture snapshot is 2026-11-05; parser tests can rot as the site changes — CI health check is the live guard.
- Listing DOM fallback yields no dates → `status` computed `unknown`, included in any filter, noted.

## 11. Submission state vs bounty checklist

Done: repo, README (install for Claude Code/Desktop/Cursor/ChatGPT, tools table, TinyFish usage, health docs), git history (single commit), LICENSE, SUBMISSION.md checklist, CI (build/test/offline health), weekly live health workflow, .env.example.
Not done: GitHub repo creation & push; live TinyFish run end-to-end; real multi-step conversation capture (demo); LinkedIn post tagging TinyFish; #showcase post; npm publish (needed for `npx wemakedevs-mcp`; from-source install documented meanwhile).

## 12. Risks

1. **Fetch may strip `<script>`** — then flight-data parsing fails and only DOM dates-less listing works. Mitigation built in (fallback + `source` field + health check), but unverified until first live run. If Fetch strips scripts, README's "34 events with ISO dates" claim degrades — must be re-verified live.
2. **Health check sentinel (`switch`) is time-bound** — after Nov 7 it may lose "open for registration" context; the check asserts structure, not status, so it should survive; override via env if the page is redesigned.
3. **Single fixture snapshot** — HTML entities/layout drift can silently pass unit tests while live parsing degrades; weekly CI is the mitigation but only runs if the secret is configured.
4. **Bounty judged on "value"** — all of WeMakeDevs, not just the Switch page, mitigates but does not eliminate the niche-audience critique.
5. **`structuredContent` without declared outputSchema at MCP boundary** — SDK validates output against declared schema; handlers construct matching objects, but this is enforced by tests only for happy paths, not for live Agent output (which is zod-checked at parse time — acceptable).
