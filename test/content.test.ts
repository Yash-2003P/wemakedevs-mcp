import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseBlogPost,
  parseBlogRss,
  parseHackathons,
  parseResources,
  parseSchedule,
} from '../src/parse.js';

const fixtures = path.join(process.cwd(), 'test', 'fixtures');
const read = (name: string) => readFileSync(path.join(fixtures, name), 'utf8');
const NOW = new Date('2026-11-07T12:00:00Z');

test('parseHackathons: rendered-card DOM fallback derives dates, prize and format', () => {
  const html = `
    <nav><a href="/"><h3>WeMakeDevs Logo</h3></a></nav>
    <a class="block border border-border p-4" href="/hackathons/demo">
      <div>
        <span class="translate-y-[1px]">Remote</span>
        <span class="translate-y-[1px]">Nov 9–10</span>
      </div>
      <h3>Tiny Demo Hackathon</h3>
      <p>$1,000 in prizes</p>
    </a>`;
  const { items, source } = parseHackathons(html, 'https://www.wemakedevs.org', NOW);
  assert.equal(source, 'dom');
  assert.equal(items.length, 1, 'nav links without a date chip are ignored');
  const item = items[0];
  assert.equal(item.title, 'Tiny Demo Hackathon');
  assert.equal(item.url, 'https://www.wemakedevs.org/hackathons/demo');
  assert.equal(item.dateText, 'Nov 9–10');
  assert.equal(item.startDate, '2026-11-09');
  assert.equal(item.endDate, '2026-11-10');
  assert.equal(item.status, 'upcoming');
  assert.equal(item.kind, 'online');
  assert.equal(item.prize, '$1,000 in prizes');
});

test('parseBlogRss: parses raw XML and Fetch-mangled lowercase/void-link HTML', () => {
  const posts = parseBlogRss(read('blog-rss.xml'));
  assert.equal(posts.length, 20);
  assert.match(posts[0].title, /Switch Workflow/);
  assert.match(posts[0].url, /^https:\/\/www\.wemakedevs\.org\/blogs\//);
  assert.match(posts[0].pubDate ?? '', /2026/);
  assert.equal(posts[0].author, 'Aayush Sharma');
  assert.ok(posts[0].categories.includes('hackathon'));

  const mangled = `<rss><channel><item>
    <title>Lowercased &amp; mangled</title>
    <link/>https://www.wemakedevs.org/blogs/mangled
    <pubdate>Thu, 29 Oct 2026 00:00:00 GMT</pubdate>
    <description>Still parses.</description>
    <dc:creator>A. Writer</dc:creator>
    <category>test</category>
  </item></channel></rss>`;
  const one = parseBlogRss(mangled);
  assert.equal(one.length, 1);
  assert.equal(one[0].title, 'Lowercased & mangled');
  assert.equal(one[0].url, 'https://www.wemakedevs.org/blogs/mangled');
  assert.equal(one[0].author, 'A. Writer');
});

test('parseBlogPost: extracts title, date, paragraphs and resolved links', () => {
  const post = parseBlogPost(read('blog-post.html'), 'https://www.wemakedevs.org/blogs/wispr');
  assert.equal(post.title, 'No Hands: The Wispr Challenge is open');
  assert.equal(post.pubDate, '2026-10-16');
  assert.ok(post.paragraphs.length >= 5);
  assert.ok(post.links.length >= 1);
  assert.ok(post.links.every((l) => /^https?:\/\//.test(l.href)));
});

test('parseSchedule and parseResources: real timeline and grouped links only', () => {
  const schedule = parseSchedule(read('schedule.html'));
  assert.deepEqual(
    schedule.map((s) => s.title),
    ['Registration opens', 'Kickoff', 'Hacking begins', 'Submissions close', 'Judging', 'Winners announced'],
  );
  assert.equal(schedule.find((s) => s.title === 'Kickoff')?.date, '2026-11-02T15:30:00Z');

  const resources = parseResources(read('resources.html'));
  assert.equal(resources.groups.length, 5);
  assert.equal(resources.groups.reduce((n, g) => n + g.links.length, 0), 21);
  assert.deepEqual(resources.groups.map((g) => g.name), [
    'Start here',
    'Build your workflow',
    'Go deeper',
    'Contribute',
    'Videos and help',
  ]);
  assert.ok(resources.groups[0].links[0].url.startsWith('https://'));
});
