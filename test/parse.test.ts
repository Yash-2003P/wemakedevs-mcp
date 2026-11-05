import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseHackathons,
  parseMeetups,
  parseCareers,
  parseScholarships,
  parseSectionAst,
  parseFaq,
  extractHackathonMeta,
  computeStatus,
  hackathonKind,
} from '../src/parse.js';

const fixtures = path.join(process.cwd(), 'test', 'fixtures');
const read = (name: string) => readFileSync(path.join(fixtures, name), 'utf8');

test('parseHackathons: extracts all embedded cards with ISO dates', () => {
  const { items, source } = parseHackathons(read('hackathons.html'), 'https://www.wemakedevs.org', new Date('2026-11-05T00:00:00Z'));
  assert.equal(source, 'embedded-json');
  assert.ok(items.length >= 30, `expected >= 30 events, got ${items.length}`);
  for (const item of items) {
    assert.ok(item.title.length > 0);
    assert.ok(item.url.startsWith('http'));
    assert.match(item.startDate ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(['upcoming', 'ongoing', 'past', 'unknown'].includes(item.status));
    assert.ok(['online', 'in-person', 'hybrid', 'unknown'].includes(item.kind));
  }
  const sw = items.find((i) => i.url.includes('/hackathons/switch'));
  assert.ok(sw, 'switch event present');
  assert.equal(sw!.status, 'ongoing'); // Nov 4–7, 2026; frozen "now" is Nov 5
  assert.equal(sw!.kind, 'online');
});

test('parseHackathons: upcoming/past classification around Nov 5 2026', () => {
  const { items } = parseHackathons(read('hackathons.html'), 'https://www.wemakedevs.org', new Date('2026-11-05T00:00:00Z'));
  const past = items.filter((i) => i.status === 'past');
  const ongoing = items.filter((i) => i.status === 'ongoing');
  assert.ok(past.length > 10, 'sanity: many past events');
  assert.ok(ongoing.length >= 1, 'switch should be ongoing on Nov 5 2026');
});

test('computeStatus edge cases', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  assert.equal(computeStatus(null, null, now), 'unknown');
  assert.equal(computeStatus('2026-11-06T00:00:00Z', null, now), 'upcoming');
  assert.equal(computeStatus(null, '2026-11-04T00:00:00Z', now), 'past');
  assert.equal(computeStatus('2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z', now), 'ongoing');
});

test('hackathonKind derives online/in-person/hybrid', () => {
  assert.equal(hackathonKind(['online']), 'online');
  assert.equal(hackathonKind(['offline']), 'in-person');
  assert.equal(hackathonKind(['online', 'offline']), 'hybrid');
  assert.equal(hackathonKind([]), 'unknown');
});

test('parseMeetups: parses cards with location, date text and links', () => {
  const items = parseMeetups(read('meetups.html'));
  assert.ok(items.length >= 10, `expected >= 10 meetups, got ${items.length}`);
  for (const m of items) {
    assert.ok(m.title.length > 0);
    assert.ok(m.url.startsWith('http'));
  }
  const sf = items.find((m) => /Pre-Universe Rooftop/i.test(m.title));
  assert.ok(sf, 'expected the CodeRabbit rooftop meetup');
  assert.match(sf!.location ?? '', /San Francisco/i);
  assert.match(sf!.dateText ?? '', /Oct 27/);
});

test('parseCareers: parses roles with tags and posting date', () => {
  const roles = parseCareers(read('careers.html'));
  assert.ok(roles.length >= 2, `expected >= 2 roles, got ${roles.length}`);
  const ve = roles.find((r) => r.title === 'Video Editor');
  assert.ok(ve, 'Video Editor role present');
  assert.match(ve!.postedAt ?? '', /^2026-11-04T/);
  assert.match(ve!.url, /\/careers\/[0-9a-f-]{36}$/);
  assert.ok(ve!.tags.some((t) => /Remote/i.test(t)));
  assert.ok(ve!.compensation && ve!.compensation.length > 0);
});

test('parseScholarships: program, status, covers, winners, faqs', () => {
  const info = parseScholarships(read('scholarships.html'));
  assert.match(info.program ?? '', /KubeCon/i);
  assert.equal(info.status, 'closed');
  assert.ok(info.statusText && /are now closed/i.test(info.statusText));
  assert.ok(info.covers.length >= 5, `expected >= 5 coverage items, got ${info.covers.length}`);
  assert.ok(info.covers.some((c) => /Flight/i.test(c.name)));
  assert.ok(info.winners.length >= 2, `expected >= 2 winners, got ${info.winners.length}`);
  assert.ok(info.winners.some((w) => /KubeCon/i.test(w.event ?? '')));
  assert.ok(info.faqs.length >= 4, `expected >= 4 FAQs, got ${info.faqs.length}`);
});

test('parseSectionAst: switch detail page yields typed sections and links', () => {
  const ast = parseSectionAst(read('switch.html'), 'https://www.wemakedevs.org');
  assert.ok(ast.title && ast.title.length > 0);
  const ids = ast.sections.map((s) => s.id);
  for (const expected of ['challenge', 'prizes', 'tracks', 'faq']) {
    assert.ok(ids.includes(expected), `missing section #${expected} (have: ${ids.join(',')})`);
  }
  const prizes = ast.sections.find((s) => s.id === 'prizes')!;
  assert.ok(prizes.blocks.length > 0);
  assert.ok(ast.links.length > 10, 'outbound links collected');
});

test('parseFaq: switch page FAQ is parsed', () => {
  const faq = parseFaq(read('switch.html'));
  assert.ok(faq.length >= 5, `expected >= 5 FAQs, got ${faq.length}`);
  for (const f of faq) {
    assert.ok(f.question.length > 5);
    assert.ok(f.answer.length > 5);
  }
});

test('extractHackathonMeta: prize pool and meta strip parse', () => {
  const meta = extractHackathonMeta(read('switch.html'));
  assert.equal(meta.prizePool, '$10,000');
  assert.match(meta.when ?? '', /Nov 4/);
  assert.match(meta.where ?? '', /Online/i);
  assert.match(meta.teams ?? '', /Solo/i);
});

test('parseSectionAst: no raw HTML leaks into blocks', () => {
  const ast = parseSectionAst(read('switch.html'), 'https://www.wemakedevs.org');
  for (const s of ast.sections) {
    for (const b of s.blocks) {
      const text = b.text ?? (b.items ?? []).join(' ');
      assert.ok(!/<[a-z][^>]*>/i.test(text), `HTML tag leaked in section ${s.id}: ${text.slice(0, 80)}`);
    }
  }
});
