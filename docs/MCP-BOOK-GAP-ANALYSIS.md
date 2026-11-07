# MCP book TOC → wemakedevs-mcp: gap analysis

You shared the table of contents of an MCP book (Python edition). I do not have the chapter text, so this maps **topics**, not page-level claims. The repo is TypeScript; the protocol concepts transfer one-to-one, but the code samples do not.

## Verdict

The book's core server path — protocol basics, STDIO, typed tools, testing, packaging — is already implemented and live-verified. The meaningful gaps are all **outside the bounty's scope**:

| Area | Status | Matters for the bounty? |
|---|---|---|
| STDIO server, typed tools, schemas | Implemented (16 tools, zod) | Yes — done |
| Tests and a real client | 20 unit tests + `scripts/smoke.mjs` | Yes — done |
| Streamable HTTP / SSE transports | Not implemented | Only for ChatGPT/remote clients; README discloses the bridge requirement |
| Resources, prompts, sampling, elicitation | Not implemented | No — the deliverable is tools |
| Auth (basic/JWT/OAuth2.1) | Not needed over local stdio | Only if an HTTP transport is added |
| Production packaging, CI, observability | Build + CI + health; no npm publish/metrics | Partly — repo and CI are done |

## Chapter map

| Ch | Book topic | Repo today | Gap / TypeScript action |
|---|---|---|---|
| 1 | Introduction, SOAP → REST → GraphQL → gRPC → MCP | Aligned; the repo exists because the site has no API | None |
| 2 | Protocol, STDIO, client, initialization, notifications/progress, sampling, SSE, Streamable HTTP | STDIO via `StdioServerTransport`; the SDK handles initialization; real client used in tests | No progress notifications; no sampling; no SSE/HTTP. Add progress heartbeats for the Agent tool, and Streamable HTTP if remote clients matter |
| 3 | Building/testing servers: resources, tools, prompts, runtimes, Inspector, cURL, tests | 16 tools with zod schemas; `node:test`; custom stdio client | No resources/prompts (not needed). Inspector not used — `npx @modelcontextprotocol/inspector` is a useful manual check |
| 4 | SSE servers (Starlette) | Not implemented | Skip; SSE is the legacy transport, superseded by Streamable HTTP |
| 5 | Streamable HTTP: notifications, resumability | Not implemented | The one real client-compatibility gap: ChatGPT connectors need an HTTP endpoint. Resumability is irrelevant for read-only calls |
| 6 | Advanced servers: low-level API, context managers, architecture, tool schemas | High-level `McpServer.registerTool`; `tools/parse/schemas/tinyfish/health/diff` split; zod | None; the high-level API is appropriate here |
| 7 | Building clients: list features, LLM integration | `scripts/smoke.mjs` is a real SDK client; the demo used OpenCode as the host | Done. A full LLM client is out of scope |
| 8 | Consuming servers: Claude Desktop, VS Code, `mcp.json`, debugging | README covers Claude Code, Claude Desktop/Cursor/Zed, VS Code, OpenCode, ChatGPT caveat | Done (VS Code section added) |
| 9 | Sampling: server asks the client's LLM | Not used | Not needed. A possible use is summarizing long blog posts, but it adds client-LLM dependency and latency |
| 10 | Elicitation: ask the user for missing input | Not used; tools take explicit slugs and errors list options | Optional: prompt for a slug when ambiguous. Current typed errors are adequate |
| 11 | Security: basic auth, JWT, OAuth2.1 | Local stdio only; `TINYFISH_API_KEY` from env; host allowlist for hackathon URLs; Agent is read-only | Required only if an HTTP transport is added. Then add OAuth/JWT before exposing it |
| 12 | Production: architecture, packaging, semver, testing, deployment, observability, scalability, governance | `bin`/`start` fixed; semver 0.1.0; CI + weekly live health; MIT; not affiliated | No npm publish, no hosted deployment, no metrics/tracing. Per-machine snapshot is documented |
| App. | Python type hints, Pydantic, async, Uvicorn, context managers, uv | TypeScript types + zod, async/await, Node runtime | See the translation table below |

## Python → TypeScript equivalents

| Book's Python stack | TypeScript equivalent in this repo |
|---|---|
| `mcp` Python SDK | `@modelcontextprotocol/sdk` (client + server) |
| Pydantic models | zod schemas (`src/schemas.ts`), `structuredContent` |
| Starlette + Uvicorn | Node HTTP framework (Hono/Fastify/Express) plus the SDK's `StreamableHTTPServerTransport` |
| `uv` | npm (or pnpm); `npm ci` / `npm run build` |
| `asyncio` | native `async`/`await` on Node's event loop |
| Context managers (`with` / `AsyncExitStack`) | `try/finally`, `AsyncDisposableStack`, or TS 5.2 `using` |
| pytest | `node:test` + `node:assert/strict` |
| MCP Inspector | `npx @modelcontextprotocol/inspector` |
| PyJWT / python-jose | `jose` |
| SSE transport | `SSEServerTransport` (legacy; prefer Streamable HTTP) |
| Sampling / elicitation calls | SDK server methods (`createMessage`, `elicitInput`) |

## Prioritized actions

**P0 — before the public push (done unless noted)**

- [x] Clean clone works: `npm ci` → `npm run build` → 20/20 tests → 9/9 offline health.
- [x] Branch renamed `master` → `main`, so `.github/workflows/ci.yml` actually runs on push.
- [ ] Replace the README clone placeholder with the final GitHub URL after you create the repo.

**P1 — small, high value**

- [x] Reusable live smoke client (`npm run smoke`, `npm run smoke:all`), 16/16 tools passing.
- [x] VS Code `.vscode/mcp.json` example in the README.
- [ ] Optional: progress notifications during `check_registration_status`. The Agent call hit **61.8 s**, which is over the SDK's default 60 s client timeout; progress heartbeats plus `resetTimeoutOnProgress` would make default clients safer. Keep the 120 s recommendation either way.

**P2 — after submission**

- [ ] Add an opt-in Streamable HTTP transport for ChatGPT/remote clients. Pair it with OAuth/JWT (Ch 11) before exposing it beyond localhost.
- [ ] Publish to npm so `npx wemakedevs-mcp` becomes truthful.
- [ ] Add structured logs/metrics if the server is hosted (Ch 12). The current observability is the stderr startup line plus the JSON health report.
- [ ] Consider prompts/resources only if a concrete use case appears. Do not add them to look complete.

## What not to add

- **More TinyFish endpoints.** Two load-bearing endpoints is the scoring maximum; extra calls would look like padding.
- **SSE.** Streamable HTTP is the current standard; SSE is the legacy path the book itself contrasts with it.
- **Sampling/elicitation for their own sake.** They add client-LLM dependencies and surface area without improving the bounty's core use case.

## Verification behind this review

```text
clean clone         npm ci → build → 20/20 tests → 9/9 offline health
live smoke          tools 16/16; 15 fast tools PASS; --all adds Agent PASS
Agent latency       39 s, 41 s, 61.8 s across live runs
branch              main (CI trigger fixed)
```

The book's protocol chapters (2, 3, 6) are the ones this repo already follows; chapters 4, 5, 11 and 12 describe the HTTP/security/production work that a local stdio server deliberately does not need.
