export type WemakedevsErrorCode =
  | 'CONFIG' // server misconfigured (e.g. missing TINYFISH_API_KEY)
  | 'FETCH_FAILED' // TinyFish Fetch failed or returned errors[]
  | 'AGENT_FAILED' // TinyFish Agent run failed
  | 'NOT_FOUND' // page 404 / unknown slug
  | 'SITE_CHANGED' // page fetched but expected structure is gone — loud breakage
  | 'VALIDATION_FAILED' // tool arguments or upstream payload failed schema validation
  | 'PARSE_FAILED';

export class WemakedevsError extends Error {
  readonly code: WemakedevsErrorCode;
  readonly url?: string;
  readonly hint?: string;

  constructor(code: WemakedevsErrorCode, message: string, opts: { url?: string; hint?: string } = {}) {
    super(message);
    this.name = 'WemakedevsError';
    this.code = code;
    this.url = opts.url;
    this.hint = opts.hint;
  }

  toJSON() {
    return { code: this.code, message: this.message, url: this.url, hint: this.hint };
  }
}
