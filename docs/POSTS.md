# Submission posts (ready to publish)

Both posts are drafted from verified live behavior. Replace `[REPO_LINK]` and `[DEMO_LINK]` after the GitHub push. Nothing here claims the package is on npm.

---

## LinkedIn (required — tag TinyFish)

Most developer communities live behind a website with no API. WeMakeDevs is one of them: 30+ hackathons a year, meetups, scholarships, hiring and a blog — all just pages.

So for the TinyFish "Site → MCP" bounty I built **wemakedevs-mcp**: an MCP server that turns the whole site into **16 typed tools** any agent can call.

What an agent can now do:
• list upcoming, ongoing and past hackathons, filtered by format
• pull a hackathon's full detail, official rules and timeline
• parse the resource hub into 21 resolved links plus CLI snippets
• check whether registration is open — and how many people have registered
• search and read the blog, list meetups, scholarships and open roles
• get deadlines, a merged "what's new" feed, and a diff of what changed since the last check
• run a 9-check health check that fails loudly when the site changes

How TinyFish is used — exactly two endpoints, both load-bearing:
→ **Fetch** reads every page live with `ttl: 0`. No cached data, no canned fixtures in the serving path.
→ **Agent** opens the one thing Fetch cannot see: the client-rendered registration panel, in a real browser, returning schema-validated JSON.

The fun part was the live surprises. Fetch strips `<script>`, so the Next.js payload is unreachable and the listing has to be parsed from rendered cards. RSS tags come back lowercased. Agent's `output_schema` rejects `additionalProperties` and `description`. Each one is handled in code and guarded by a health check.

The live site even disagrees with itself: the listing card says $8000, the detail page says $10,000. The agent reported both instead of quietly picking one.

16 tools · 20 unit tests · 9/9 live health checks · a real end-to-end transcript in the repo.

Built with TypeScript, `@modelcontextprotocol/sdk`, zod and cheerio.

Repo: [REPO_LINK]
Transcript: [DEMO_LINK]

@TinyFish — thanks for the bounty prompt. #MCP #AIAgents #TinyFish #BuildInPublic

> **How to tag:** in the LinkedIn composer, type `@` and select TinyFish's company page from the dropdown. Plain text `@TinyFish` does not notify them.
>
> **Suggested attachment:** a screenshot of `docs/DEMO.md`, or the terminal output of `npm run health` showing 9/9 green.

---

## TinyFish Discord — #showcase

**wemakedevs-mcp — the whole WeMakeDevs site as 16 typed MCP tools**

Built for the Site → MCP bounty. Hackathons, timelines, rules, resource links, blogs, meetups, scholarships and careers — all read live through TinyFish.

- **Fetch** (`ttl: 0`) reads every page; **Agent** opens the client-rendered registration panel in a real browser and returns state + registered count.
- 16 tools with zod-typed inputs/outputs and structured JSON.
- 9 live health checks that fail loudly when the site changes.
- 20 unit tests; real end-to-end transcript in `docs/DEMO.md`.
- A diff tool compares the live listing with your last observation: added, removed, changed fields.

Live run: 1 ongoing + 3 upcoming hackathons, 6 timeline milestones, 21 resource links, registration open with 7,690 registered.

Repo: [REPO_LINK]

Try it from source:

```bash
git clone [REPO_LINK]
cd wemakedevs-mcp
npm ci && npm run build
TINYFISH_API_KEY=... node dist/src/index.js
```

Happy to hear feedback — especially from anyone using it from Claude Code or another stdio client.

---

## Publishing checklist

1. Push the repo and confirm the build instructions work from a clean clone.
2. Replace `[REPO_LINK]` and `[DEMO_LINK]`.
3. Post on LinkedIn; select TinyFish's company page as the mention; attach a screenshot.
4. Post the Discord version in **#showcase** on the TinyFish Discord.
5. Save both post URLs for the submission form.

Do **not** claim `npx wemakedevs-mcp` until the package is actually published.
