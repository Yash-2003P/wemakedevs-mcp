# Does wemakedevs-mcp need a UI?

**Decision: no, not for this submission.** The server stays a tool-only MCP server. This document records the reasoning so the choice is deliberate rather than an omission.

## What "a UI" would mean here

MCP Apps (official extension, spec 2026-01-26, `@modelcontextprotocol/ext-apps`) lets a server expose one or more `ui://` resources. A host that implements the extension renders that HTML in a sandboxed iframe, and the app talks to the host over `postMessage`. It is additive: the tools keep working without it, and hosts that do not implement the extension ignore it.

The candidate views would be:

1. a hackathon timeline built from `get_hackathon_schedule`;
2. a registration-status badge built from `check_registration_status`;
3. a filterable hackathon/meetup browser.

## Why not now

- **The deliverable is the tool surface.** The bounty asks for typed tools with TinyFish doing the reading. All 16 tools already return `structuredContent` validated against zod schemas, plus a text fallback. Claude, Cursor, OpenCode, Inspector and generic clients can render or summarize that today.
- **A UI would reduce universality.** Tool-only servers work in every MCP host. An MCP App only renders in hosts that implement the extension; in the rest the user sees the same JSON or text. Adding one does not make the server reachable from more clients.
- **It adds a second attack surface.** An iframe bundle needs a CSP declaration, a `postMessage` protocol, origin checks and a build pipeline. This server's security posture is deliberately small: read-only tools, exact Host/Origin allowlists, bearer auth, bounded inputs.
- **It adds no TinyFish coverage and no new capability.** The three candidate views are presentations of data the tools already return. They would not read a page that Fetch/Agent cannot already read.
- **The submission is time-boxed.** The remaining work with real value is verification, documentation and the required posts — not an optional rendering layer.

## What a future UI would look like

If a concrete user need appears (for example, comparing 30+ hackathons visually, or showing a live registration count while a user decides), add **one** MCP App rather than a general dashboard:

- `ui://wemakedevs/hackathon-timeline.html`, declared from `get_hackathon_schedule` via `_meta.ui.resourceUri`;
- a single self-contained HTML file, no external scripts, with a strict CSP;
- the app calls the existing tools through the host, so there is still exactly one data path (TinyFish Fetch/Agent);
- tool-only clients keep the current `structuredContent` with no change.

That is a presentation feature over the existing contracts, not a prerequisite for the bounty.

## Evidence this is sufficient without a UI

- MCP Inspector 2.13 renders the tools and structured results in both protocol eras.
- The real OpenCode run in [DEMO.md](DEMO.md) chained seven tools and produced a written answer without any server-provided view.
- `npm run smoke` / `smoke:all` call all 16 tools through a standard SDK client; no UI code is involved.
