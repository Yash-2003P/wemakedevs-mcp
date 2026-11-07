import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, parseDisplayDate, type HackathonSummary } from '../src/parse.js';
import { diffHackathons, snapshotFrom } from '../src/diff.js';

const NOW = new Date('2026-11-07T12:00:00Z');

test('parseDisplayDate: single day, same-month range, cross-month, month-only and explicit years', () => {
  assert.deepEqual(parseDisplayDate('Nov 25', NOW), {
    startDate: '2026-11-25',
    endDate: '2026-11-25',
  });
  assert.deepEqual(parseDisplayDate('Nov 9–10', NOW), {
    startDate: '2026-11-09',
    endDate: '2026-11-10',
  });
  assert.deepEqual(parseDisplayDate('Sep 30 – Oct 31', NOW), {
    startDate: '2026-09-30',
    endDate: '2026-10-31',
  });
  assert.deepEqual(parseDisplayDate('February 2026', NOW), {
    startDate: '2026-02-01',
    endDate: '2026-02-28',
  });
  assert.deepEqual(parseDisplayDate('Dec 15–21, 2025', NOW), {
    startDate: '2025-12-15',
    endDate: '2025-12-21',
  });
  assert.deepEqual(parseDisplayDate('Nov 29 – Dec 2, 2024', NOW), {
    startDate: '2024-11-29',
    endDate: '2024-12-02',
  });
  assert.deepEqual(parseDisplayDate('not a date', NOW), { startDate: null, endDate: null });
});

test('computeStatus: a date-only end date lasts through the end of that day', () => {
  assert.equal(computeStatus('2026-11-04', '2026-11-07', NOW), 'ongoing');
  assert.equal(computeStatus('2026-11-04', '2026-11-06', NOW), 'past');
  assert.equal(computeStatus('2026-11-09', '2026-11-10', NOW), 'upcoming');
});

function summary(
  url: string,
  title: string,
  prize: string | null,
  startDate = '2026-11-04',
  endDate = '2026-11-07',
): HackathonSummary {
  return {
    title,
    url,
    location: 'Remote',
    formats: ['online'],
    kind: 'online',
    prize,
    dateText: 'Nov 4–7',
    startDate,
    endDate,
    status: 'ongoing',
    external: false,
  };
}

test('diffHackathons: first run creates a baseline without noise', () => {
  const current = [summary('https://www.wemakedevs.org/hackathons/switch', 'Switch', '$8,000')];
  const diff = diffHackathons(null, current, { asOf: '2026-11-07T00:00:00Z' });
  assert.equal(diff.baselineCreated, true);
  assert.equal(diff.compared, 1);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 0);
});

test('diffHackathons: reports added, removed and field-level changes', () => {
  const prev = snapshotFrom(
    [
      summary('https://www.wemakedevs.org/hackathons/switch', 'Switch', '$8,000'),
      summary('https://www.wemakedevs.org/hackathons/festivehacks', 'Festive Hacks', '₹3 Lakh'),
    ],
    '2026-11-01T00:00:00Z',
  );
  const current = [
    summary('https://www.wemakedevs.org/hackathons/switch', 'Switch', '$10,000'),
    summary('https://www.wemakedevs.org/hackathons/toggle', 'Toggle Wars', '$3,000'),
  ];
  const diff = diffHackathons(prev, current, { asOf: '2026-11-07T00:00:00Z' });
  assert.equal(diff.baselineCreated, false);
  assert.deepEqual(diff.added.map((i) => i.title), ['Toggle Wars']);
  assert.deepEqual(diff.removed.map((i) => i.title), ['Festive Hacks']);
  assert.equal(diff.changed.length, 1);
  assert.deepEqual(diff.changed[0].fields, [
    { field: 'prize', before: '$8,000', after: '$10,000' },
  ]);
  assert.equal(diff.unchanged, 0);
  assert.match(diff.note ?? '', /1 added, 1 removed, 1 changed/);
});

test('diffHackathons: optional scope limits the diff to one event', () => {
  const prev = snapshotFrom(
    [
      summary('https://www.wemakedevs.org/hackathons/switch', 'Switch', '$8,000'),
      summary('https://www.wemakedevs.org/hackathons/festivehacks', 'Festive Hacks', '₹3 Lakh'),
    ],
    '2026-11-01T00:00:00Z',
  );
  const current = [
    summary('https://www.wemakedevs.org/hackathons/switch', 'Switch', '$10,000'),
    summary('https://www.wemakedevs.org/hackathons/toggle', 'Toggle Wars', '$3,000'),
  ];
  const diff = diffHackathons(prev, current, {
    asOf: '2026-11-07T00:00:00Z',
    filterUrl: 'https://www.wemakedevs.org/hackathons/switch/',
  });
  assert.equal(diff.compared, 1);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 1);
});
