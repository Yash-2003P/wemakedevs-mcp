# TinyFish “Site → MCP” submission checklist

Bounty: Turn a website with no public API into a permanent agent tool (MCP server). Deadline: **Tue 17 Nov 2026, 11:59 PM PT**.

- [ ] Repo link with working build + README (this repo)
- [ ] Working from Claude / ChatGPT / another MCP client — include a real conversation log in the README or demo video (multi-step: list → get details → check registration)
- [ ] **LinkedIn post about your build, tagging TinyFish** (required) — include what it does, how TinyFish Agent/Fetch are used
- [ ] Share it in **#showcase** on the TinyFish Discord (invite link from the TinyFish bounty post)
- [ ] How TinyFish is used, in the submission notes: **Fetch** reads every page live (ttl:0); **Agent** opens the client-side registration panel and returns schema-validated output; no canned data; `health_check` detects site changes and fails loudly
- [ ] One submission per person; top 3 approved; feedback otherwise

## Talking points for the post/demo

- 30+ hackathons, 12 meetups, scholarships, careers — all were read-only web UIs with no API.
- Tools: list_hackathons, get_hackathon (sections + FAQ), get_hackathon_rules, check_registration_status (real browser via Agent), list_meetups, list_open_roles, list_scholarships, upcoming_deadlines, health_check.
- 2 TinyFish endpoints, both load-bearing (no padding) → 100 leaderboard points.
- Loud failure story: zod validation everywhere; SITE_CHANGED error + CI health badge.
- Install: `claude mcp add wemakedevs-mcp -e TINYFISH_API_KEY=sk-... -- npx -y wemakedevs-mcp`

## Smoke test to record before submitting

1. `npm run build && npm test && WEMAKEDEVS_MCP_HEALTH_OFFLINE=1 npm run health` — green.
2. With TINYFISH_API_KEY set: run the Claude Code session showing list → detail → registration status (screenshot or transcript).
3. `npm run health` — green (or warn if WeMakeDevs changed something — fix first).
