import { WemakedevsError } from './errors.js';
import { WEMMAKEDEVS_ORIGIN } from './parse.js';

/** Every host this server will read hackathon or blog content from. */
export const ALLOWED_WEMAKEDEVS_HOSTS = new Set([
  'www.wemakedevs.org',
  'wemakedevs.org',
  'archive.wemakedevs.org',
]);

/**
 * Accepts a slug ("switch"), a site path ("/hackathons/switch") or a full URL
 * on a WeMakeDevs host, and returns an absolute https URL. Anything else is
 * rejected with a clear error — we never fetch arbitrary URLs.
 */
export function resolveHackathonUrl(input: string): string {
  const t = (input ?? '').trim();
  if (t === '') {
    throw new WemakedevsError('VALIDATION_FAILED', 'Empty hackathon identifier.', {
      hint: 'Pass a slug like "switch" or a full https://www.wemakedevs.org/hackathons/<slug> URL.',
    });
  }
  if (/^https?:\/\//i.test(t)) {
    let u: URL;
    try {
      u = new URL(t);
    } catch {
      throw new WemakedevsError('VALIDATION_FAILED', `Malformed URL: ${t}`);
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new WemakedevsError('VALIDATION_FAILED', `Unsupported protocol: ${u.protocol}`);
    }
    const host = u.hostname.toLowerCase();
    if (!ALLOWED_WEMAKEDEVS_HOSTS.has(host)) {
      throw new WemakedevsError(
        'VALIDATION_FAILED',
        `Refusing to fetch non-WeMakeDevs host: ${host}.`,
        { hint: 'External event pages (devpost, Luma, …) are not parsed; open them directly.' }
      );
    }
    return u.toString();
  }
  if (t.startsWith('/')) return WEMMAKEDEVS_ORIGIN + t;
  if (/^[a-z0-9][a-z0-9-]{0,80}$/.test(t)) return `${WEMMAKEDEVS_ORIGIN}/hackathons/${t}`;
  throw new WemakedevsError('VALIDATION_FAILED', `Cannot interpret "${input}" as a hackathon slug or WeMakeDevs URL.`, {
    hint: 'Pass a slug like "switch" or a full https://www.wemakedevs.org/hackathons/<slug> URL.',
  });
}

export function originOf(rawUrl: string): string {
  const u = new URL(rawUrl);
  return `${u.protocol}//${u.host}`;
}
