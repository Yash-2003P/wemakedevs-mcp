/**
 * Extract the `"cards":[...]` array embedded in Next.js RSC flight data.
 *
 * The listing pages (e.g. /hackathons) render server-side; the full event list
 * is embedded in <script>self.__next_f.push([1,"...escaped JSON..."]) chunks.
 * TinyFish Fetch (format=html) may return either the raw scripts (escaped
 * form) or normalized HTML with plain JSON, so we handle both, then fall back
 * to DOM parsing at the call site. Anything unexpected yields null — callers
 * decide between fallback and a loud SITE_CHANGED.
 */

export type FlightCard = {
  id?: string;
  title?: string;
  location?: string;
  formats?: string[];
  prize?: string | null;
  image?: string | null;
  href?: string;
  isExternal?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  date?: string | null;
  displayDateOverride?: string | null;
  hackathonSlug?: string | null;
  seriesSlug?: string | null;
};

/** Balanced-bracket extraction of an array literal, aware of JSON string escapes. */
function extractBalancedArray(src: string, startIndex: number): string | null {
  // startIndex must point at '['
  if (src[startIndex] !== '[') return null;
  let depth = 0;
  let inString = false;
  for (let k = startIndex; k < src.length; k++) {
    const ch = src[k];
    if (ch === '\\') {
      const next = src[k + 1];
      if (next === '"') inString = !inString;
      k += 1; // skip the escape pair
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return src.slice(startIndex, k + 1);
    }
  }
  return null;
}

function tryParse(jsonText: string): FlightCard[] | null {
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      return parsed as FlightCard[];
    }
    return null;
  } catch {
    return null;
  }
}

/** Extract the embedded cards array, or null if the page shape changed. */
export function extractFlightCards(html: string): FlightCard[] | null {
  if (typeof html !== 'string' || html.length === 0) return null;

  // Path A: escaped form inside self.__next_f.push([1,"..."]) chunks.
  const escMarker = '\\"cards\\":[';
  const escAt = html.indexOf(escMarker);
  if (escAt !== -1) {
    const arrayStart = escAt + '\\"cards\\":'.length;
    const rawArray = extractBalancedArray(html, arrayStart);
    if (rawArray) {
      try {
        // Unescape one level: the flight payload is a JS string containing JSON.
        const inner = JSON.parse('"' + rawArray + '"') as string;
        const cards = tryParse(inner);
        if (cards) return cards;
      } catch {
        // fall through to Path B
      }
    }
  }

  // Path B: plain (unescaped) JSON, e.g. scripts stripped but kept verbatim.
  const plainMarker = '"cards":[';
  const plainAt = html.indexOf(plainMarker);
  if (plainAt !== -1) {
    const arrayStart = plainAt + '"cards":'.length;
    const rawArray = extractBalancedArray(html, arrayStart);
    if (rawArray) {
      const cards = tryParse(rawArray);
      if (cards) return cards;
    }
  }

  return null;
}
