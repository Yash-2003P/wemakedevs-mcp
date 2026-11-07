# TinyFish “Site → MCP” submission checklist

Bounty: Turn a website with no public API into a permanent agent tool (MCP server). Deadline: **Tue 17 Nov 2026, 11:59 PM PT**.

## Status (2026-11-07)

- [x] Repo with working build + README (from-source install; npm package not published)
- [x] 16 typed MCP tools, zod-validated inputs and outputs
- [x] Live TinyFish **Fetch** path verified against every page (ttl: 0, no canned data)
- [x] Live TinyFish **Agent** path verified (`check_registration_status`: state=open, closes Nov 7 2026, 7,689 registered, 39 s)
- [x] Live `npm run health` → **9/9 green**; offline health → 9/9 green
- [x] Unit tests → **20/20 green**
- [x] Real multi-step run through a stdio MCP client (list → detail → schedule → resources → registration)
- [ ] Push the repo to GitHub and add the public link
- [ ] **LinkedIn post about the build, tagging TinyFish** (required)
- [ ] Share it in **#showcase** on the TinyFish Discord
- [ ] Optional: publish to npm so `npx wemakedevs-mcp` works

## What the submission notes must say

- **Fetch** reads every page live (`ttl: 0`): hackathon listing/detail/rules/schedule/resources, meetups, careers, scholarships, blog RSS and articles. Verbatim `include_selectors: ["body"]` is required because Fetch’s default output strips the structure the parsers need.
- **Agent** opens the client-side registration panel in a real browser and returns schema-validated JSON. Read-only; never signs in or registers.
- No canned data in the serving path; fixtures are used only by unit tests and the opt-in local stub. The undocumented `wemakedevs-server.onrender.com` backend is never called.
- `health_check` detects site changes and fails loudly with the exact check and reason.
- 2 TinyFish endpoints, both load-bearing (no padding) → 100 leaderboard points.

## Talking points for the post/demo

- 30+ hackathons, 12 meetups, scholarships and careers — all were read-only web UIs with no API.
- 16 tools: `list_hackathons`, `get_hackathon`, `get_hackathon_rules`, `get_hackathon_schedule`, `get_hackathon_resources`, `check_registration_status`, `list_meetups`, `list_open_roles`, `list_scholarships`, `list_blog_posts`, `search_blog`, `get_blog_post`, `upcoming_deadlines`, `latest_updates`, `get_hackathon_changes`, `health_check`.
- The live surprises: Fetch strips `<script>` (so no Next.js flight payload — parse the rendered cards instead), RSS tags come back lowercased, and Agent rejects `additionalProperties`/`description` in `output_schema`. Each is handled in code and documented.
- Diff story: `get_hackathon_changes` compares the live listing with the last observation and reports added/removed/changed fields.
- Loud-failure story: zod everywhere, typed errors, CI health badge, nine live checks.

## Commands to record before submitting

```bash
npm ci
npm test                                         # 20/20
WEMAKEDEVS_MCP_HEALTH_OFFLINE=1 npm run health   # 9/9 offline
TINYFISH_API_KEY=sk-... npm run health           # 9/9 live
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
