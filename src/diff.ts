import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HackathonSummary } from './parse.js';

/** The subset of a listing card we track between runs. */
export interface SnapshotItem {
  title: string;
  prize: string | null;
  dateText: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  kind: string;
}

export interface HackathonSnapshot {
  capturedAt: string;
  items: Record<string, SnapshotItem>;
}

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface HackathonDiff {
  asOf: string;
  baselineCapturedAt: string | null;
  baselineCreated: boolean;
  baselineUpdated: boolean;
  compared: number;
  added: Array<{ title: string; url: string }>;
  removed: Array<{ title: string; url: string }>;
  changed: Array<{ title: string; url: string; fields: FieldChange[] }>;
  unchanged: number;
  note: string | null;
}

const TRACKED_FIELDS: Array<keyof SnapshotItem> = [
  'title',
  'prize',
  'dateText',
  'startDate',
  'endDate',
  'location',
  'kind',
];

export function normalizeHackathonUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function snapshotFrom(items: HackathonSummary[], capturedAt: string): HackathonSnapshot {
  const map: Record<string, SnapshotItem> = {};
  for (const item of items) {
    map[normalizeHackathonUrl(item.url)] = {
      title: item.title,
      prize: item.prize,
      dateText: item.dateText,
      startDate: item.startDate,
      endDate: item.endDate,
      location: item.location,
      kind: item.kind,
    };
  }
  return { capturedAt, items: map };
}

function valueOf(item: SnapshotItem, field: keyof SnapshotItem): string | null {
  const value = item[field];
  return value === undefined ? null : value;
}

/**
 * Pure diff between two observations. `prev === null` means "first run":
 * it reports a created baseline and no added/removed noise.
 */
export function diffHackathons(
  prev: HackathonSnapshot | null,
  current: HackathonSummary[],
  opts: { asOf: string; filterUrl?: string },
): HackathonDiff {
  const currentMap = snapshotFrom(current, opts.asOf).items;
  const prevMap = prev?.items ?? {};
  const scope = opts.filterUrl ? normalizeHackathonUrl(opts.filterUrl) : undefined;

  const keys = (map: Record<string, SnapshotItem>) =>
    Object.keys(map).filter((k) => (scope ? k === scope : true));

  const addedUrls = prev
    ? keys(currentMap).filter((k) => !(k in prevMap))
    : [];
  const removedUrls = prev
    ? keys(prevMap).filter((k) => !(k in currentMap))
    : [];

  const changed: HackathonDiff['changed'] = [];
  let unchanged = 0;
  for (const url of keys(currentMap)) {
    const before = prevMap[url];
    if (!before) continue;
    const after = currentMap[url];
    const fields: FieldChange[] = [];
    for (const field of TRACKED_FIELDS) {
      const b = valueOf(before, field);
      const a = valueOf(after, field);
      if (b !== a) fields.push({ field, before: b, after: a });
    }
    if (fields.length) {
      changed.push({ title: after.title, url, fields });
    } else {
      unchanged += 1;
    }
  }

  const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);
  const added = addedUrls.map((url) => ({ title: currentMap[url].title, url })).sort(byTitle);
  const removed = removedUrls.map((url) => ({ title: prevMap[url].title, url })).sort(byTitle);
  changed.sort(byTitle);

  const compared = keys(currentMap).length;
  const baselineCreated = prev === null;

  let note: string | null;
  if (baselineCreated) {
    note = `First run: captured a baseline of ${compared} hackathon(s). Call again after the site changes to see added, removed and changed events.`;
  } else if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    note = `No changes since the baseline captured at ${prev.capturedAt}.`;
  } else {
    note = `${added.length} added, ${removed.length} removed, ${changed.length} changed since the baseline captured at ${prev.capturedAt}.`;
  }
  if (scope) note += ` Scoped to ${scope}.`;

  return {
    asOf: opts.asOf,
    baselineCapturedAt: prev?.capturedAt ?? null,
    baselineCreated,
    baselineUpdated: false,
    compared,
    added,
    removed,
    changed,
    unchanged,
    note,
  };
}

export function stateFile(): string {
  const dir =
    process.env.WEMAKEDEVS_MCP_STATE_DIR ?? path.join(os.homedir(), '.cache', 'wemakedevs-mcp');
  return path.join(dir, 'hackathon-snapshots.json');
}

export async function loadSnapshot(): Promise<{
  snapshot: HackathonSnapshot | null;
  warning: string | null;
}> {
  try {
    const raw = await readFile(stateFile(), 'utf8');
    const parsed = JSON.parse(raw) as HackathonSnapshot;
    if (
      !parsed ||
      typeof parsed.capturedAt !== 'string' ||
      typeof parsed.items !== 'object' ||
      parsed.items === null
    ) {
      return { snapshot: null, warning: 'Snapshot file was malformed; starting a fresh baseline.' };
    }
    return { snapshot: parsed, warning: null };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { snapshot: null, warning: null };
    return {
      snapshot: null,
      warning: `Could not read the previous snapshot (${String(
        err instanceof Error ? err.message : err,
      )}); starting a fresh baseline.`,
    };
  }
}

export async function saveSnapshot(snapshot: HackathonSnapshot): Promise<string | null> {
  try {
    const file = stateFile();
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8');
    await rename(temp, file);
    return null;
  } catch (err) {
    return `Could not persist the new snapshot (${String(
      err instanceof Error ? err.message : err,
    )}); the next call will diff against the old baseline.`;
  }
}
