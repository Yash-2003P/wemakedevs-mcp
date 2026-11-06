#!/usr/bin/env node
/**
 * Local TinyFish stub for offline development and demos.
 *
 * Serves the committed fixtures (test/fixtures/*.html) in the exact response
 * shape of api.fetch.tinyfish.ai, and a fixed read-only answer for
 * POST /v1/automation/run (the registration-panel agent).
 *
 * NOT TinyFish. NOT real web access. Responses are frozen fixtures.
 * Enable only via:
 *   TINYFISH_FETCH_BASE_URL=http://127.0.0.1:8788 \
 *   TINYFISH_AGENT_RUN_URL=http://127.0.0.1:8788/v1/automation/run \
 *   TINYFISH_API_KEY=stub npm start
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtures = path.join(root, 'test', 'fixtures');

const PAGES = new Map([
  ['https://www.wemakedevs.org/hackathons', 'hackathons.html'],
  ['https://www.wemakedevs.org/hackathons/switch', 'switch.html'],
  ['https://www.wemakedevs.org/hackathons/switch/rules', 'rules.html'],
  ['https://www.wemakedevs.org/meetups', 'meetups.html'],
  ['https://www.wemakedevs.org/careers', 'careers.html'],
  ['https://www.wemakedevs.org/scholarships', 'scholarships.html'],
]);

const AGENT_RESULT = {
  state: 'open',
  opensAt: 'Nov 4, 2026, 12:01 AM IST',
  closesAt: 'Nov 7, 2026, 11:59 PM IST',
  registeredCount: 214,
  notes: 'STUB: registration panel is open (frozen fixture answer).',
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk)).on('end', () => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'POST' && req.url === '/v1/automation/run') {
      res.end(JSON.stringify({ status: 'COMPLETED', result: AGENT_RESULT }));
      return;
    }

    if (req.method === 'POST') {
      let parsed = null;
      try { parsed = JSON.parse(body || '{}'); } catch { /* falls through */ }
      if (parsed && Array.isArray(parsed.urls)) {
        const results = [], errors = [];
        for (const url of parsed.urls) {
          const file = PAGES.get(String(url));
          if (!file) {
            errors.push({ url, error: `stub: no fixture mapped for ${url}` });
            continue;
          }
          results.push({
            url,
            final_url: url,
            title: `STUB ${file}`,
            format: parsed.format ?? 'html',
            text: readFileSync(path.join(fixtures, file), 'utf8'),
          });
        }
        res.end(JSON.stringify({ results, errors }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'stub: expected {urls: [...]}' }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'stub: unknown route' }));
  });
});

const port = Number(process.env.PORT ?? 8788);
server.listen(port, '127.0.0.1', () => {
  console.error(`tinyfish-stub listening on 127.0.0.1:${port} (frozen fixtures — NOT TinyFish, NOT live web)`);
});
