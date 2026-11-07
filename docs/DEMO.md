# Live MCP run — wemakedevs-mcp

A real, end-to-end session against the live WeMakeDevs site. No fixtures, no stub, no canned data.

| | |
|---|---|
| **Captured** | 2026-11-07, 04:22–04:23 UTC |
| **Client** | OpenCode v2.2.5, standalone session (`ses_e4bc1f7d2ffeun6YO6w52TAmew`) |
| **Model** | `opencode/deepseek-v4.1-flash-free` |
| **Server** | `wemakedevs-mcp` 0.1.0 over stdio |
| **Backing** | TinyFish Fetch (`ttl: 0`) for pages; TinyFish Agent for the registration panel |

## Prompt (verbatim)

> Use the wemakedevs-mcp MCP tools for every fact. Do not use memory and do not infer anything a tool did not return. I want to enter a WeMakeDevs hackathon this month. (1) List the ongoing and upcoming hackathons with their dates. (2) Pick the one that is live right now, call get_hackathon for its full detail (prize pool, teams, when/where), then fetch its timeline and resource links. (3) Check whether registration is open and how many people are registered. (4) Find related blog posts. End with a short, practical answer with exact dates, status and links. Do not state submission requirements, deadlines or prize amounts unless a tool returned them.

> **Method note.** Tool calls and outputs below are taken from the run's structured JSON log. Long JSON is collapsed into tables for readability; **values are unchanged**. The final answer is reproduced verbatim; its section headings are demoted one level so they nest in this document, and nothing else is changed.

## What the client saw

Discovery (`search` scoped to the server namespace) returned **16 tools**:

`check_registration_status`, `get_blog_post`, `get_hackathon`, `get_hackathon_changes`, `get_hackathon_resources`, `get_hackathon_rules`, `get_hackathon_schedule`, `health_check`, `latest_updates`, `list_blog_posts`, `list_hackathons`, `list_meetups`, `list_open_roles`, `list_scholarships`, `search_blog`, `upcoming_deadlines`

## Step 1 — ongoing and upcoming hackathons

`list_hackathons({ status: "ongoing" })` and `list_hackathons({ status: "upcoming" })`, in parallel.

| Status | Event | Dates | Format / where | Listing prize text |
|---|---|---|---|---|
| `ongoing` | [Flip the Switch Hackathon](https://www.wemakedevs.org/hackathons/switch) | Nov 4–7 (`2026-11-04` → `2026-11-07`) | online / Remote | $8000 in prizes, include AirPods and Logitech Keyboards! |
| `upcoming` | [Cloud Native Hackathon](https://www.wemakedevs.org/hackathons/cnh) | Nov 9–10 (`2026-11-09` → `2026-11-10`) | in-person / Salt Lake City, Utah | $20,000 in prizes including Nvidia DGX Spark |
| `upcoming` | [Festive Hacks](https://www.wemakedevs.org/hackathons/festivehacks) | Nov 25 (`2026-11-25` → `2026-11-25`) | in-person / BIEC, Bengaluru | Fully Sponsored VIP Trip to Berlin and ₹3 Lakh in cash prizes! |
| `upcoming` | [Toggle Wars](https://www.wemakedevs.org/hackathons/flagsmith) | Nov 26–29 (`2026-11-26` → `2026-11-29`) | online / Remote | $3,000 + PS5 GTA6 Bundle! |

Source field: `dom`; the result note says yearless display dates are assumed to be the current year. `asOf` values: `2026-11-07T04:22:22.783Z` and `2026-11-07T04:22:21.284Z`.

## Step 2 — full detail of the live event

`get_hackathon({ hackathon: "switch" })`, alongside the schedule and resource calls.

| Field | Value |
|---|---|
| `title` | Flip the Switch Hackathon |
| `prizePool` | $10,000 |
| `when` | Nov 4–7, 2026 |
| `where` | Online, from anywhere |
| `teams` | Solo or up to 4 people |
| `url` | https://www.wemakedevs.org/hackathons/switch |

Sections returned: `challenge` (Turn your solo agent into a teammate), `switch`, `prizes` (What you can win), `tracks` (Three tracks and two side tracks), `judging` (What the judges are looking for), `faq` (Got questions?).

## Step 3 — timeline

`get_hackathon_schedule({ hackathon: "switch" })` → **6 milestones** from [https://www.wemakedevs.org/hackathons/switch/schedule](https://www.wemakedevs.org/hackathons/switch/schedule):

| Site text | Machine date | Milestone | Detail |
|---|---|---|---|
| Open now | _none_ (marker) | **Registration opens** | Register, star the Switch repo and join the Discord. You can add teammates any time before submissions close. |
| Nov 2, 3:30 PM UK time | `2026-11-02T15:30:00Z` | **Kickoff** | A live stream on Switch, the tracks, the rules and how to get set up, two days before hacking begins. |
| Nov 4, 12:01 AM IST | `2026-11-04T00:01:00+05:30` | **Hacking begins** | Start building. Support is on Discord the whole way through. |
| Nov 7, 11:59 PM IST | `2026-11-07T23:59:00+05:30` | **Submissions close** | Submit your repo, demo video and README before the deadline. |
| Early November | `2026-11-08T00:00:00+05:30` | **Judging** | WeMakeDevs shortlists, then the joint panel picks the winners. |
| To be announced | _none_ (marker) | **Winners announced** | Announced by Switch, DevTools Academy and WeMakeDevs, with the best projects showcased across all three. |

## Step 4 — resource hub

`get_hackathon_resources({hackathon: "switch"})` → **5 groups, 21 links, 2 CLI snippets** from [https://www.wemakedevs.org/hackathons/switch/resources](https://www.wemakedevs.org/hackathons/switch/resources).

| Group | Links |
|---|---|
| Start here | 5 |
| Build your workflow | 7 |
| Go deeper | 4 |
| Contribute | 2 |
| Videos and help | 3 |

CLI one-liners returned:

```bash
claude mcp add switch-docs --transport http https://docs.switchagents.ai/mcp
codex mcp add switch-docs --url https://docs.switchagents.ai/mcp
```

<details>
<summary>All 21 resource links returned by the tool</summary>

**Start here**

- [Switch quickstart](https://docs.switchagents.ai/switch-rooms/getting-started) — The first page to open. One agent answering you in a chat channel in about ten minutes.
- [Switch on GitHub](https://devtoolsacademy.link/wemakedevs) — Star it while you are there.
- [Download Switch Console](https://github.com/sandbox-quantum/switch/releases/latest) — The latest stable release, so everyone builds on the same version.
- [Switch onboarding video walkthrough](https://www.switchagents.ai/switch-onboarding)
- [Official documentation](https://docs.switchagents.ai/)

**Build your workflow**

- [Meet Switch](https://docs.switchagents.ai/switch-rooms/using/index) — How a room works and why it is different from a group chat.
- [Create a room](https://docs.switchagents.ai/switch-rooms/getting-started/create-a-room)
- [Add a custom agent](https://docs.switchagents.ai/switch-rooms/getting-started/add-a-second-agent)
- [The Switch framework](https://docs.switchagents.ai/switch-rooms/building/index) — Rooms, agents, roles and the material a room carries.
- [Build a payments room](https://docs.switchagents.ai/switch-rooms/building/payments-room) — A full worked example, from an empty channel to a room a team can work in.
- [Share context](https://docs.switchagents.ai/switch-rooms/using/shared-context)
- [Connect Slack, Teams, Discord, Mattermost or Telegram](https://docs.switchagents.ai/switch-rooms/deploy/messaging-apps/index)

**Go deeper**

- [The agent protocol](https://docs.switchagents.ai/switch-rooms/internals/agent-protocol) — What a custom agent implements to join a room.
- [The collaboration bridge](https://docs.switchagents.ai/switch-rooms/internals/collaboration-bridge) — How a chat app connects, and how to add one Switch doesn't support yet.
- [Host Switch for your team](https://docs.switchagents.ai/switch-rooms/deploy/self-host)
- [Examples in the repo](https://github.com/sandbox-quantum/switch/tree/main/examples)

**Contribute**

- [Open issues](https://github.com/sandbox-quantum/switch/issues)
- [CONTRIBUTING.md](https://github.com/sandbox-quantum/switch/blob/main/CONTRIBUTING.md)

**Videos and help**

- [Switch on YouTube](https://www.youtube.com/@FlintAI-SandboxAQ)
- [Troubleshooting](https://docs.switchagents.ai/switch-rooms/resources/troubleshooting)
- [WeMakeDevs Discord](https://discord.gg/E2rWw2Yhsm)

</details>

## Step 5 — registration panel (TinyFish Agent)

`check_registration_status({ hackathon: "switch" })` returned exactly:

```json
{
  "url": "https://www.wemakedevs.org/hackathons/switch",
  "state": "open",
  "opensAt": null,
  "closesAt": null,
  "registeredCount": 7690,
  "notes": "Registration panel resolved showing the hackathon is open with 7,690 people already registered.",
  "observedAt": "2026-11-07T04:23:18.437Z",
  "method": "tinyfish-agent"
}
```

The parallel batch that included the Agent started around `04:22:37Z`; the Agent returned at `04:23:18.437Z`, so the call took roughly **41 s** (it opens a real browser). The panel did not expose date fields in this observation; the schedule is the authoritative source for the close time.

## Step 6 — related blog posts

`search_blog({ query: "switch", limit: 20 })` → **1 post**; `list_blog_posts({ tag: "hackathon", limit: 20 })` → **19 posts** in the tag.

- **[How to Build a Switch Workflow That Finishes a Real Task](https://www.wemakedevs.org/blogs/how-to-build-a-switch-workflow-that-finishes-a-real-task)** — Aayush Sharma, `Thu, 29 Oct 2026 00:00:00 GMT`, tags: `hackathon`, `wemakedevs`, `switch`
  - Learn how to build reliable, multi-agent workflows with Switch for the Flip the Switch Hackathon. This guide walks through Upgrade Desk, a real-world demo for automating dependency upgrades with human approval, and covers agent coordination, room instructions, debugging, and testing your workflow before submission.

## Final answer (verbatim)

### 1. WeMakeDevs hackathons — ongoing and upcoming

All values below are from `list_hackathons` (asOf `2026-11-07`, status filters `ongoing` and `upcoming`).

**Ongoing (1)**

| Event | Dates | Format / where | Prize text on listing | Link |
|---|---|---|---|---|
| Flip the Switch Hackathon | Nov 4–7, 2026 (start `2026-11-04`, end `2026-11-07`) | online, "Remote" | "$8000 in prizes, include AirPods and Logitech Keyboards!" | https://www.wemakedevs.org/hackathons/switch |

**Upcoming (3)**

| Event | Dates | Format / where | Prize text on listing | Link |
|---|---|---|---|---|
| Cloud Native Hackathon | Nov 9–10, 2026 | in-person, Salt Lake City, Utah | "$20,000 in prizes including Nvidia DGX Spark" | https://www.wemakedevs.org/hackathons/cnh |
| Festive Hacks | Nov 25, 2026 | in-person, BIEC, Bengaluru | "Fully Sponsored VIP Trip to Berlin and ₹3 Lakh in cash prizes!" | https://www.wemakedevs.org/hackathons/festivehacks |
| Toggle Wars | Nov 26–29, 2026 | online, "Remote" | "$3,000 + PS5 GTA6 Bundle!" | https://www.wemakedevs.org/hackathons/flagsmith |

The one live right now is **Flip the Switch** (`endDate` = today, 2026-11-07).

### 2. Flip the Switch — full detail (`get_hackathon`)

- **URL:** https://www.wemakedevs.org/hackathons/switch
- **Prize pool (hero field):** `$10,000`
- **When:** `Nov 4–7, 2026`
- **Where:** `Online, from anywhere`
- **Teams:** `Solo or up to 4 people`

Prize section as returned ("Total prize pool $0$10,000" — cash across the three tracks and Code with Wispr, plus AirPods 5 for best blog, Logitech keyboards for top #HowISwitch posts, swag for 20 random projects, certificate for every submission):

- Track 01 Best Business Workflow — $2,000 cash
- Track 02 Best Personal or Creative Workflow — $2,000 cash
- Track 03 Best Core Contribution — $100 × 20 (top 20 PRs)
- Side track Code with Wispr — $500 cash
- Side track Best Blog — AirPods 5; #HowISwitch top 5 — Logitech keyboard

⚠️ Inconsistency in the tool output, reported as-is: the listing card says "$8000 in prizes, include AirPods and Logitech Keyboards!" while the detail page hero says `$10,000`. I won't pick one.

### 3. Timeline (`get_hackathon_schedule`)

| When (site text) | Milestone | Machine date |
|---|---|---|
| Open now | Registration opens | none (marker) |
| Nov 2, 3:30 PM UK time | Kickoff | `2026-11-02T15:30:00Z` |
| Nov 4, 12:01 AM IST | Hacking begins | `2026-11-04T00:01:00+05:30` |
| Nov 7, 11:59 PM IST | Submissions close | `2026-11-07T23:59:00+05:30` |
| Early November | Judging | `2026-11-08T00:00:00+05:30` |
| To be announced | Winners announced | none (marker) |

Schedule detail for the close: "Submit your repo, demo video and README before the deadline."

### 4. Resource links (`get_hackathon_resources`)

**Start here**
- Switch quickstart — https://docs.switchagents.ai/switch-rooms/getting-started ("first page to open… about ten minutes")
- Switch on GitHub — https://devtoolsacademy.link/wemakedevs
- Download Switch Console — https://github.com/sandbox-quantum/switch/releases/latest
- Onboarding video — https://www.switchagents.ai/switch-onboarding
- Docs — https://docs.switchagents.ai/

**Build your workflow**
- Meet Switch — https://docs.switchagents.ai/switch-rooms/using/index
- Create a room — https://docs.switchagents.ai/switch-rooms/getting-started/create-a-room
- Add a custom agent — https://docs.switchagents.ai/switch-rooms/getting-started/add-a-second-agent
- The Switch framework — https://docs.switchagents.ai/switch-rooms/building/index
- Worked example (payments room) — https://docs.switchagents.ai/switch-rooms/building/payments-room
- Share context — https://docs.switchagents.ai/switch-rooms/using/shared-context
- Connect Slack/Teams/Discord/Mattermost/Telegram — https://docs.switchagents.ai/switch-rooms/deploy/messaging-apps/index

**Go deeper**
- Agent protocol — https://docs.switchagents.ai/switch-rooms/internals/agent-protocol
- Collaboration bridge — https://docs.switchagents.ai/switch-rooms/internals/collaboration-bridge
- Self-host — https://docs.switchagents.ai/switch-rooms/deploy/self-host
- Examples — https://github.com/sandbox-quantum/switch/tree/main/examples

**Contribute / help**
- Open issues — https://github.com/sandbox-quantum/switch/issues
- CONTRIBUTING.md — https://github.com/sandbox-quantum/switch/blob/main/CONTRIBUTING.md
- Switch on YouTube — https://www.youtube.com/@FlintAI-SandboxAQ
- Troubleshooting — https://docs.switchagents.ai/switch-rooms/resources/troubleshooting
- Discord — https://discord.gg/E2rWw2Yhsm

CLI one-liners the page shows:
```
claude mcp add switch-docs --transport http https://docs.switchagents.ai/mcp
codex mcp add switch-docs --url https://docs.switchagents.ai/mcp
```

### 5. Registration (`check_registration_status`)

- **State: `open`**
- **Registered: 7,690**
- `opensAt`: null · `closesAt`: null (the panel returned no dates)
- Notes: "Registration panel resolved showing the hackathon is open with 7,690 people already registered."
- Observed `2026-11-07T04:23:18Z` via TinyFish Agent (a real browser)

### 6. Related blog posts

- **How to Build a Switch Workflow That Finishes a Real Task** — Aayush Sharma, `Thu, 29 Oct 2026`, tags `hackathon, wemakedevs, switch`. Summary returned: a guide to building reliable multi-agent workflows with Switch for the Flip the Switch Hackathon, walking through "Upgrade Desk" (automating dependency upgrades with human approval), agent coordination, room instructions, debugging and testing before submission.
  https://www.wemakedevs.org/blogs/how-to-build-a-switch-workflow-that-finishes-a-real-task
- **No Hands: The Wispr Challenge is open** — Kunal Kushwaha, `Fri, 16 Oct 2026`, tags `hackathon, wemakedevs`. Relevant because the Switch event has a Code with Wispr side track (worth noting: this post describes a separate two-week WeMakeDevs × Wispr Flow hackathon).
  https://www.wemakedevs.org/blogs/wispr

`search_blog("switch")` returned exactly 1 post; `list_blog_posts(tag: "hackathon")` returned 19 posts total.

### Practical answer

**Enter Flip the Switch Hackathon — it is the only event live today (Sat Nov 7, 2026), and today is its last day.**

- Run window: **Nov 4, 12:01 AM IST → Nov 7, 11:59 PM IST** (site text and ISO dates above). Registration is **open** with **7,690** registered.
- Online from anywhere, solo or up to 4 people, hero prize pool **$10,000** (the listing card says $8000 — the two tool outputs disagree).
- Deadline that matters right now: **submissions close Nov 7, 11:59 PM IST**; per the schedule, submit your repo, demo video and README.
- Fastest path: open the quickstart first — https://docs.switchagents.ai/switch-rooms/getting-started — then the build guide blog post above, and ask for help in https://discord.gg/E2rWw2Yhsm.
- If you miss it: Cloud Native (Nov 9–10, Salt Lake City), Festive Hacks (Nov 25, Bengaluru), Toggle Wars (Nov 26–29, online).

I did not state anything about submission requirements, deadlines or prize amounts beyond what the tools above returned; the "submit repo, demo video and README" line is the schedule's own detail text, and per-track judging/eligibility rules live on the Official Rules page, which I did not fetch.

## What this run demonstrates

- **Multi-step, tool-grounded reasoning:** discovery → listing → detail → timeline → resources → registration → blog search, with no fact taken from memory.
- **Both TinyFish endpoints are load-bearing:** Fetch read every page (`ttl: 0`); Agent observed the one client-rendered panel that Fetch cannot see.
- **Typed outputs:** every result above came from the server's zod-validated `structuredContent`, including resolved links and machine-readable dates.
- **Honest about real-world drift:** the live listing card says `$8000` while the live detail page says `$10,000`. The agent reported both and refused to pick one. The tools did not silently normalize the site's inconsistency.
- **Loud failure path:** `health_check` is the guard for exactly this kind of site drift; it is not exercised in this happy-path transcript, but it broke correctly when earlier live runs exposed the DOM/RSS changes.
