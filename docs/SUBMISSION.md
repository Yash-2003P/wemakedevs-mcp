# TinyFish “Site → MCP” submission checklist

Bounty: Turn a website with no public API into a permanent agent tool (MCP server). Deadline: **Tue 17 Nov 2026, 11:59 PM PT**.

## Status (2026-11-14)

- [x] Repo with working build + README (from-source install; npm package not published)
- [x] 16 typed MCP tools, zod-validated inputs and outputs; every handler result is parsed against its output schema before return
- [x] Live TinyFish **Fetch** path verified against every page (ttl: 0, no canned data); listing uses rendered DOM because Fetch strips scripts
- [x] Live TinyFish **Agent** path verified (`check_registration_status`: state=closed, 7,828 registered in the final run, 22 s; earlier runs 39–62 s)
- [x] Live `npm run health` → **9/9 green**; offline health → 9/9 green; sentinel event is asserted, not merely reported
- [x] Tests → **31/31 green** (unit + HTTP) on Node 24 and Node 20 (Alpine/Docker)
- [x] Offline end-to-end smoke: `npm run smoke:stub` → **16/16 tools**, no TinyFish key, no network
- [x] Clean-clone check from GitHub: `npm ci` → build → 31/31 tests → 9/9 offline health; Inspector legacy + modern pass on the clone
- [x] Reusable live smoke client: `npm run smoke` (15 fast tools) and `npm run smoke:all` (16/16, Agent included)
- [x] Streamable HTTP transport (`src/http.ts`, `npm run start:http`): stateless `POST /mcp`, bearer auth, exact Host/Origin allowlists; `npm run smoke:http` green including a live tool call
- [x] **Both protocol eras**: legacy 2025-11-25 and modern 2026-07-28, over stdio and HTTP. Inspector 2.13 `tools/list --strict` → 0 errors; live modern `tools/call` verified
- [x] Security regressions covered: spoofed `Host` → 403 before body read; `http://localhost.evil.com` and other Origin lookalikes → 403; loopback origin CORS echo; explicit extra Host accepted
- [x] Real multi-step run through a stdio MCP client (list → detail → schedule → resources → registration), captured in full at [docs/DEMO.md](DEMO.md) — all 16 tools live-exercised across the verification session
- [x] LinkedIn and Discord post drafts → [docs/POSTS.md](POSTS.md) (repo URL filled in; ready to publish)
- [x] UI decision recorded: no MCP Apps UI for this submission → [docs/UI-ASSESSMENT.md](UI-ASSESSMENT.md)
- [x] Push the repo to GitHub: **https://github.com/Yash-2003P/wemakedevs-mcp** — CI on `main` is green
- [ ] **LinkedIn post about the build, tagging TinyFish** (required)
- [ ] Share it in **#showcase** on the TinyFish Discord
- [ ] Optional: publish to npm so `npx wemakedevs-mcp` works
- [ ] Optional: OAuth flow in front of the HTTP transport for ChatGPT connectors

## Public repo (done)

**https://github.com/Yash-2003P/wemakedevs-mcp**

- Branch `main`, remote `origin`, working tree clean.
- GitHub Actions [CI](https://github.com/Yash-2003P/wemakedevs-mcp/actions/workflows/ci.yml) — `build-test` job runs build, tests, offline health and the offline 16-tool smoke on Node 24.
- A fresh `git clone` of the public repo passed `npm ci` → `npm test` (31/31) → 9/9 offline health, plus Inspector in both protocol eras.
- The weekly live-health workflow skips with a notice when `TINYFISH_API_KEY` is not configured; it does not fail the repo.
- README, [docs/POSTS.md](POSTS.md) and this checklist use the public URL.

## What the submission notes must say

- **Fetch** reads every page live (`ttl: 0`): hackathon listing/detail/rules/schedule/resources, meetups, careers, scholarships, blog RSS and articles. Verbatim `include_selectors: ["body"]` is required because Fetch’s default output strips the structure the parsers need.
- **Agent** opens the client-side registration panel in a real browser and returns schema-validated JSON. Read-only; never signs in or registers.
- No canned data in the serving path; fixtures are used only by unit tests and the opt-in local stub. The undocumented `wemakedevs-server.onrender.com` backend is never called.
- `health_check` detects site changes and fails loudly with the exact check and reason.
- 2 TinyFish endpoints, both load-bearing (no padding) → 100 leaderboard points.
- Two MCP transports, one tool surface: stdio (`src/index.ts`) and Streamable HTTP (`src/http.ts`), identical 16 tools.

## Talking points for the post/demo

- 30+ hackathons, 12 meetups, scholarships and careers — all were read-only web UIs with no API.
- 16 tools: `list_hackathons`, `get_hackathon`, `get_hackathon_rules`, `get_hackathon_schedule`, `get_hackathon_resources`, `check_registration_status`, `list_meetups`, `list_open_roles`, `list_scholarships`, `list_blog_posts`, `search_blog`, `get_blog_post`, `upcoming_deadlines`, `latest_updates`, `get_hackathon_changes`, `health_check`.
- The live surprises: Fetch strips `<script>` (so no Next.js flight payload — parse the rendered cards instead), RSS tags come back lowercased, and Agent rejects `additionalProperties`/`description` in `output_schema`. Each is handled in code and documented.
- Diff story: `get_hackathon_changes` compares the live listing with the last observation and reports added/removed/changed fields.
- Loud-failure story: zod everywhere, typed errors, CI health badge, nine live checks.

## Commands to record before submitting

```bash
npm ci
npm test                                         # 31/31
npm run smoke:stub                               # 16/16 offline tools
WEMAKEDEVS_MCP_HEALTH_OFFLINE=1 npm run health   # 9/9 offline
TINYFISH_API_KEY=sk-... npm run health           # 9/9 live

# Independent protocol check (both eras; strict schema report)
npx -y @modelcontextprotocol/inspector --cli node dist/src/index.js \
  --method tools/list --protocol-era legacy --strict
npx -y @modelcontextprotocol/inspector --cli node dist/src/index.js \
  --method tools/list --protocol-era modern --strict
```

Then run the MCP server in Claude Code / OpenCode / any stdio client and record:

1. `list_hackathons({status: "upcoming"})` and `list_hackathons({status: "ongoing"})`
2. `get_hackathon({hackathon: "switch", sections: ["prizes", "judging"]})`
3. `get_hackathon_schedule({hackathon: "switch"})`
4. `get_hackathon_resources({hackathon: "switch"})`
5. `check_registration_status({hackathon: "switch"})` — allow ≥120 s
6. `list_blog_posts({limit: 3})` and `get_blog_post({post: "wispr"})`
7. `latest_updates({within_days: 30})` and `get_hackathon_changes({update_baseline: true})` twice

## Install command for the post (from source)

```bash
claude mcp add wemakedevs-mcp \
  -e TINYFISH_API_KEY=$TINYFISH_API_KEY \
  -- node /absolute/path/to/wemakedevs-mcp/dist/src/index.js
```

Do **not** claim `npx wemakedevs-mcp` until the package is actually published.
