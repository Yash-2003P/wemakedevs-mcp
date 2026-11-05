import { WemakedevsError } from './errors.js';

export interface FetchResultEntry {
  url: string;
  final_url?: string;
  title?: string;
  description?: string;
  language?: string;
  format?: string;
  text?: unknown;
  not_modified?: boolean;
}

export interface FetchOutput {
  results: FetchResultEntry[];
  errors: Array<{ url: string; error: string }>;
}

export interface FetchOptions {
  format?: 'html' | 'markdown' | 'json';
  /** Seconds of cache freshness to accept. 0 = always live (default for this server). */
  ttl?: number;
  apiKey?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const FETCH_ENDPOINT = 'https://api.fetch.tinyfish.ai';
const AGENT_RUN_ENDPOINT = 'https://agent.tinyfish.ai/v1/automation/run';

function resolveApiKey(override?: string): string {
  const key = override ?? process.env.TINYFISH_API_KEY;
  if (!key || key.trim() === '') {
    throw new WemakedevsError(
      'CONFIG',
      'TINYFISH_API_KEY is not set.',
      { hint: 'Create a key at https://agent.tinyfish.ai/api-keys and export TINYFISH_API_KEY, or add it to your MCP client env.' }
    );
  }
  return key.trim();
}

/**
 * Read pages through TinyFish Fetch. Never caches: all tools fetch live by
 * default because the whole point is that the agent sees the current site.
 */
export async function fetchPages(urls: string[], options: FetchOptions = {}): Promise<FetchOutput> {
  if (urls.length === 0) return { results: [], errors: [] };
  const { format = 'html', ttl = 0, apiKey, fetchImpl = fetch } = options;
  const key = resolveApiKey(apiKey);

  let res: Response;
  try {
    res = await fetchImpl(FETCH_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, format, ttl }),
    });
  } catch (err) {
    throw new WemakedevsError('FETCH_FAILED', `TinyFish Fetch request failed: ${(err as Error).message}`, {
      hint: 'Check network access and TinyFish service status.',
    });
  }

  if (res.status === 401 || res.status === 403) {
    throw new WemakedevsError('CONFIG', 'TinyFish rejected the API key (401/403).', {
      hint: 'Verify TINYFISH_API_KEY at https://agent.tinyfish.ai/api-keys.',
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new WemakedevsError('FETCH_FAILED', `TinyFish Fetch returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as FetchOutput;
  for (const e of json.errors ?? []) {
    // Per-URL failures are surfaced, not swallowed.
    if (/not.?found|404/i.test(e.error)) {
      throw new WemakedevsError('NOT_FOUND', `TinyFish could not fetch ${e.url}: ${e.error}`, { url: e.url });
    }
    throw new WemakedevsError('FETCH_FAILED', `TinyFish could not fetch ${e.url}: ${e.error}`, { url: e.url });
  }
  if (!json.results || json.results.length === 0) {
    throw new WemakedevsError('FETCH_FAILED', 'TinyFish Fetch returned no results.', { url: urls[0] });
  }
  return json;
}

export interface AgentRunOptions {
  url: string;
  goal: string;
  outputSchema: Record<string, unknown>;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Run TinyFish Agent for work Fetch cannot do (client-side widgets).
 * Read-only goals only — no registrations, no sign-ins, no purchases.
 */
export async function runAgent(options: AgentRunOptions): Promise<unknown> {
  const { url, goal, outputSchema, apiKey, fetchImpl = fetch } = options;
  const key = resolveApiKey(apiKey);

  let res: Response;
  try {
    res = await fetchImpl(AGENT_RUN_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, goal, output_schema: outputSchema }),
    });
  } catch (err) {
    throw new WemakedevsError('AGENT_FAILED', `TinyFish Agent request failed: ${(err as Error).message}`, { url });
  }

  if (res.status === 401 || res.status === 403) {
    throw new WemakedevsError('CONFIG', 'TinyFish rejected the API key (401/403).', { url });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new WemakedevsError('AGENT_FAILED', `TinyFish Agent returned HTTP ${res.status}: ${body.slice(0, 300)}`, { url });
  }

  const json = (await res.json()) as { result?: unknown; output?: unknown; status?: string; error?: string };
  if (json.status && /fail|error/i.test(json.status)) {
    throw new WemakedevsError('AGENT_FAILED', `TinyFish Agent run did not succeed: ${json.error ?? json.status}`, { url });
  }
  return json.result ?? json.output ?? json;
}
