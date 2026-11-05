# wemakedevs-mcp

An MCP (Model Context Protocol) server that turns **wemakedevs.org** — a site with no documented public API — into a set of **typed agent tools**. Hackathons, meetups, scholarships and careers become clean, structured JSON an AI agent can actually use. [TinyFish](https://tinyfish.ai) does the real web reading on every call; there is no cached or canned data.

> Built for the TinyFish “Site → MCP” bounty. Not affiliated with WeMakeDevs.

## Why this exists

WeMakeDevs runs 30+ hackathons a year, meetups in 9+ cities, community scholarships and (sometimes) hiring — and none of it is available as an API. If you want your coding agent to answer *“what should I enter this month, what are the prizes, and is registration still open?”*, the web is the only interface. This server is that interface, and it’s structured enough for any MCP client.

## Install

Requires Node.js ≥ 20 and a TinyFish API key ([get one](https://agent.tinyfish.ai/api-keys)).

```bash
npm install -g wemakedevs-mcp
export TINYFISH_API_KEY=sk-...
```

Or from source:

```bash
git clone https://github.com/<you>/wemakedevs-mcp.git
cd wemakedevs-mcp && npm ci && npm run build
```

### Claude Code

```bash
claude mcp add wemakedevs-mcp -e TINYFISH_API_KEY=$TINYFISH_API_KEY -- npx -y wemakedevs-mcp
```

### Claude Desktop / Cursor / Zed / other MCP clients

```json
{
  "mcpServers": {
    "wemakedevs": {
      "command": "npx",
      "args": ["-y", "wemakedevs-mcp"],
      "env": { "TINYFISH_API_KEY": "sk-..." }
    }
  }
}
```

### ChatGPT

ChatGPT supports remote MCP servers via **Settings → Connectors** (or the OpenAI Agents SDK, where this server can be attached as an MCP tool server). Point it at a deployed/stdio-exposed instance of this server, or use any MCP-compatible client. Tools appear as actions; the agent can then chain them.

## Tools

| Tool | What it does |
|---|---|
| `list_hackathons` | List events (upcoming/ongoing/past), filter by `status`, `format` (online/in-person/hybrid), `search`. Returns typed summaries: title, url, dates, prize text, kind, status. |
| `get_hackathon` | Full structured detail of one event: hero meta (prize pool, when/where/teams), all page sections (challenge, prizes, tracks, judging, schedule…), FAQ, links. Use `sections: ["prizes","schedule"]` to fetch only what you need. Accepts a slug (`"switch"`), path or full URL. |
| `get_hackathon_rules` | The Official Rules page as structured sections — eligibility, exclusions, prizes, disqualification. |
| `check_registration_status` | The registration panel is client-side and can’t be read with a plain fetch. **TinyFish Agent** opens a real browser, waits for the panel to resolve and reports `open` / `closed` / `upcoming` / `unknown` + dates + registered count. Read-only — never signs in or registers. |
| `list_meetups` | Meetups with city, host, date text and link (Luma). Filter by `city` / `search`. |
| `list_open_roles` | Live openings from /careers (title, location, type, compensation, posting date). Returns `[]` with a note when the page shows its empty state. |
| `list_scholarships` | Current scholarship program: coverage (flights, hotel, pass, reimbursement), application status (open/closed), past winners, FAQs. |
| `upcoming_deadlines` | Hackathon starts and ends (submission close) within the next N days — the “what should I enter?” answer. |
| `health_check` | Live self-check of every parser (see below). Fails loudly. |

All tools return **structured JSON** (`structuredContent`) — validated against zod schemas. Tools never return raw HTML dumps, and every error is a typed, human-readable code: `CONFIG`, `FETCH_FAILED`, `AGENT_FAILED`, `NOT_FOUND`, `SITE_CHANGED`, `VALIDATION_FAILED`.

### Example multi-step conversation

> **You:** What WeMakeDevs hackathons can I still enter, and is the $10k one open for registration?
>
> **Agent** → `list_hackathons({status: "upcoming"})`
> `→ [“Flip the Switch — Nov 4–7, Remote, prize…”, …]`
> **Agent** → `get_hackathon({hackathon: "switch", sections: ["prizes", "tracks", "judging"]})`
> `→ prize pool $10,000; three tracks; judging weights …`
> **Agent** → `check_registration_status({hackathon: "switch"})`
> `→ { state: "open", closesAt: "Nov 7, 11:59 PM IST", … }`
>
> **Agent:** Two options. Flip the Switch (closes Nov 7…) fits your Go experience…

## How TinyFish is used

This server uses exactly two TinyFish endpoints, each for what it’s good at:

- **TinyFish Fetch** (`api.fetch.tinyfish.ai`, `ttl: 0` — always live) reads every page in this server: listing pages, detail pages, rules, careers, scholarships. The pages are Next.js; the parser prefers the embedded RSC flight payload (the full 34-event list with ISO dates is embedded as `\"cards\":[…]`) and falls back to DOM scraping if WeMakeDevs changes the embedding. Fetch renders JS when needed.
- **TinyFish Agent** (`agent.tinyfish.ai`) is used for the *only* thing a raw page read cannot see: the registration panel, which renders client-side behind “Loading…”. The agent waits for it to resolve and returns structured output via `output_schema` (`{state, opensAt, closesAt, registeredCount, notes}`). Strictly read-only.

Nothing is pre-scraped, cached at bake time, or mocked in the serving path. `TINYFISH_API_KEY` is required; without it every tool fails fast with a clear `CONFIG` error.

## Health check (when the site changes, this breaks loudly)

```bash
npm run health                 # live check via TinyFish (needs TINYFISH_API_KEY)
WEMAKEDEVS_MCP_HEALTH_OFFLINE=1 npm run health   # parse committed fixtures, no network
npm run health -- hackathons-listing careers     # a subset
```

It fetches (or reads fixtures for) `/hackathons`, the `switch` detail page, its rules page, `/meetups`, `/careers`, `/scholarships`, then asserts: card counts, schema validity, ISO dates, the prizes section, ≥3 FAQ entries, rules markers. Exits non-zero on any failure and prints a per-check JSON report.

The MCP tool `health_check` exposes the same checks to agents (and is wired into CI weekly via `.github/workflows/health.yml`). If WeMakeDevs redesigns their pages, `health_check` tells you *which tool* broke and *why* — instead of returning garbage.

## Development

```bash
npm ci
npm test          # builds, then runs parser unit tests against test/fixtures/*
```

`test/fixtures/` holds raw HTML snapshots captured 2026-11-05. Parser tests assert on those — when the live site is checked by CI (weekly), parser failures surface as health-check failures, not silent bad data.

## Limitations (honest ones)

- **Meetup dates are display text** (“Oct 27”), not ISO — `upcoming_deadlines` can’t include them. Meetup `status` is therefore never guessed.
- **Scholarship FAQ answers** are recovered from the page’s flight data (`dangerouslySetInnerHTML`); if WeMakeDevs changes that embedding, answers come back `null` (questions still returned) and `health_check` will flag it.
- **Archive events** (older hackathons on `archive.wemakedevs.org`) are listed by `list_hackathons` and can be passed to `get_hackathon`; detail fidelity depends on the archived layout.
- **External events** (devpost/Luma links) are listed with their URLs; `get_hackathon` refuses non-WeMakeDevs hosts by design.
- Health check sentinel slug defaults to `switch` (override with `HEALTH_SENTINEL_SLUG`).

## Related

- TinyFish docs: https://docs.tinyfish.ai
- WeMakeDevs: https://www.wemakedevs.org

## License

MIT
