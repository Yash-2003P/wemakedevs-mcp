# MCP book TOC → wemakedevs-mcp: gap analysis

You shared the table of contents of an MCP book (Python edition). I do not have the chapter text, so this maps **topics**, not page-level claims. The repo is TypeScript; the protocol concepts transfer one-to-one, but the code samples do not.

**Update (2026-11-07, after implementation):** the one functional gap identified in the first pass — the missing Streamable HTTP transport — has since been implemented and live-tested (`src/http.ts`, `npm run smoke:http` green, 6 new unit tests). Tracked below.

## Verdict

| Area | Status after implementation | Matters for the bounty? |
|---|---|---|
| STDIO server, typed tools, schemas | Implemented (16 tools, zod) | Yes — done |
| Tests and a real client | 26 unit tests + live smoke for both transports | Yes — done |
| Streamable HTTP transport | **Implemented**: stateless `POST /mcp`, JSON responses, bearer auth, Origin/Host protection | Yes — closes the remote-client gap; ChatGPT still needs OAuth |
| SSE transport | Deliberately not implemented | No — legacy, superseded by Streamable HTTP |
| Resources, prompts, sampling, elicitation | Not implemented | No — the deliverable is tools |
| OAuth2.1 auth | Not implemented (bearer token only) | Only for ChatGPT connectors |
| Production packaging, CI, observability | Build + CI + health; no npm publish/metrics | Partly — repo and CI are done |

## Chapter map

| Ch | Book topic | Repo today | Gap / TypeScript action |
|---|---|---|---|
| 1 | Introduction, SOAP → REST → GraphQL → gRPC → MCP | Aligned; the repo exists because the site has no API | None |
| 2 | Protocol, STDIO, client, initialization, notifications/progress, sampling, SSE, Streamable HTTP | STDIO via `StdioServerTransport` **and** Streamable HTTP via `src/http.ts`; the SDK handles initialization; real clients used in tests and demos | No progress notifications; no sampling. Progress heartbeats for the Agent tool remain the only P1 |
| 3 | Building/testing servers: resources, tools, prompts, runtimes, Inspector, cURL, tests | 16 tools with zod schemas; `node:test`; `scripts/smoke.mjs` calls every tool live | No resources/prompts (not needed). Inspector not used — `npx @modelcontextprotocol/inspector` is a useful manual check |
| 4 | SSE servers (Starlette) | Not implemented | Skipped: SSE is the legacy transport, superseded by Streamable HTTP |
| 5 | Streamable HTTP: notifications, resumability | **Implemented stateless**: one short-lived `McpServer` per POST, `enableJsonResponse`, DNS-rebinding Host allowlist | Resumability/event store deliberately out for a read-only tool surface |
| 6 | Advanced servers: low-level API, context managers, architecture, tool schemas | High-level `McpServer.registerTool`; `tools/parse/schemas/tinyfish/health/diff` split; zod | None; the high-level API is appropriate here |
| 7 | Building clients: list features, LLM integration | `scripts/smoke.mjs` (stdio) and `scripts/smoke-http.mjs` (Streamable HTTP) are real SDK clients; the demo used OpenCode as the host | Done. A full LLM client is out of scope |
| 8 | Consuming servers: Claude Desktop, VS Code, `mcp.json`, debugging | README covers Claude Code (stdio **and** `--transport http -H`), Claude Desktop/Cursor/Zed, VS Code, OpenCode, ChatGPT caveat | Done |
| 9 | Sampling: server asks the client's LLM | Not used | Not needed. A possible use is summarizing long blog posts, but it adds client-LLM dependency and latency |
| 10 | Elicitation: ask the user for missing input | Not used; tools take explicit slugs and errors list options | Optional: prompt for a slug when ambiguous. Current typed errors are adequate |
| 11 | Security: basic auth, JWT, OAuth2.1 | Loopback bind by default; refusal to bind non-loopback without `MCP_HTTP_TOKEN`; `timingSafeEqual`; Origin allowlist; transport Host allowlist | Bearer auth done. JWT/OAuth2.1 remain open — required before a public ChatGPT connector |
| 12 | Production: architecture, packaging, semver, testing, deployment, observability, scalability, governance | `bin`/`start`/`start:http`; semver 0.1.0; CI + weekly live health; MIT; HTTP transport deployable on any host | No npm publish, no metrics/tracing. Per-machine snapshot is documented |
| App. | Python type hints, Pydantic, async, Uvicorn, context managers, uv | TypeScript types + zod, async/await, Node runtime | See the translation table below |

## Python → TypeScript equivalents

| Book's Python stack | TypeScript equivalent in this repo |
|---|---|
| `mcp` Python SDK | `@modelcontextprotocol/sdk` (client + server) |
| Pydantic models | zod schemas (`src/schemas.ts`), `structuredContent` |
| Starlette + Uvicorn | `node:http` + the SDK's `StreamableHTTPServerTransport` (`src/http.ts`) |
| `uv` | npm (or pnpm); `npm ci` / `npm run build` |
| `asyncio` | native `async`/`await` on Node's event loop |
| Context managers (`with` / `AsyncExitStack`) | `try/finally` + per-request `transport.close()` / `server.close()` |
| pytest | `node:test` + `node:assert/strict` |
| MCP Inspector | `npx @modelcontextprotocol/inspector` |
| PyJWT / python-jose | `jose` (not used yet) |
| Basic auth | `Authorization: Bearer` compared with `crypto.timingSafeEqual` |
| SSE transport | Not used — `StreamableHTTPServerTransport` only |
| Sampling / elicitation calls | SDK server methods (`createMessage`, `elicitInput`) |

## Prioritized actions

**P0 — before the public push**

- [x] Clean clone works: `npm ci` → `npm run build` → 26/26 tests → 9/9 offline health.
- [x] Branch renamed `master` → `main`, so `.github/workflows/ci.yml` actually runs on push.
- [ ] Replace the README clone placeholder with the final GitHub URL after the repo is created.

**P1 — small, high value**

- [x] Reusable live smoke clients: `npm run smoke` (stdio, 16 tools) and `npm run smoke:http` (HTTP, auth + live call).
- [x] VS Code `.vscode/mcp.json` example in the README.
- [x] Streamable HTTP transport with bearer auth, Origin/Host protection, and a refusal to bind non-loopback without a token.
- [ ] Optional: progress notifications during `check_registration_status`. The Agent call hit **61.8 s**, over the SDK's default 60 s client timeout; progress heartbeats plus `resetTimeoutOnProgress` would make default clients safer. Keep the 120 s recommendation either way.

**P2 — after submission**

- [ ] OAuth 2.1 code flow in front of the HTTP transport for ChatGPT connectors (Ch 11's last third).
- [ ] Publish to npm so `npx wemakedevs-mcp` becomes truthful.
- [ ] Add structured logs/metrics if the server is hosted (Ch 12). Current observability is the stderr request log plus the JSON health report.
- [ ] Consider prompts/resources only if a concrete use case appears. Do not add them to look complete.

## What not to add

- **More TinyFish endpoints.** Two load-bearing endpoints is the scoring maximum; extra calls would look like padding.
- **SSE.** Streamable HTTP is the current standard; SSE is the legacy path the book itself contrasts with it.
- **Sampling/elicitation for their own sake.** They add client-LLM dependencies and surface area without improving the bounty's core use case.
- **Session state or resumability.** Stateless-per-request keeps the HTTP mode deployable on any host without sticky sessions, and nothing in this tool surface needs replay.

## Verification behind this review

```text
clean clone         npm ci → build → 26/26 tests → 9/9 offline health
live smoke (stdio)  tools 16/16; 15 fast tools PASS; --all adds Agent PASS
live smoke (http)   401 without/with a wrong token; 16 tools listed; live tool call PASS
Agent latency       39 s, 41 s, 61.8 s across live runs
branch              main (CI trigger fixed)
http security       non-loopback bind refuses without MCP_HTTP_TOKEN; unblessed Origin → 403; bad Host → 403
```

The book's protocol chapters (2, 3, 6) are the ones this repo already follows; chapter 5 is now implemented in the stateless posture that fits a read-only tool set; chapter 11 is half-done by design (bearer, not OAuth); chapter 12's packaging work still needs a maintainer decision rather than code.
