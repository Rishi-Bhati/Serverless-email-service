import {
  UnsentConfigError,
  UnsentConnectionError,
  UnsentError,
  UnsentTimeoutError,
  apiErrorFromResponse,
  type UnsentAPIError,
} from './errors';
import { randomNonce, signRequest } from './crypto';
import { VERSION } from './version';

export interface HttpConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret?: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: typeof fetch;
}

export interface CallOptions {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Sign with HMAC (POST /api/send). GET endpoints authenticate with the API key alone. */
  sign?: boolean;
  /** Send the API key. `false` for the public health probe. */
  auth?: boolean;
  /** May be re-sent after an ambiguous failure without risk of duplication. */
  retrySafe: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface CallResult<T> {
  status: number;
  data: T;
  headers: Headers;
}

const MAX_BACKOFF_MS = 8_000;
const MAX_RETRY_AFTER_MS = 60_000;
const BASE_BACKOFF_MS = 500;
/** Skews smaller than this are not worth correcting (the server tolerates 180 s). */
const MIN_CLOCK_CORRECTION_MS = 30_000;

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsentConfigError(`baseUrl ${JSON.stringify(raw)} is not a valid URL. Expected something like https://unsent.example.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsentConfigError(`baseUrl must start with https:// (got ${url.protocol}//)`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost');
  if (url.protocol === 'http:' && !loopback) {
    throw new UnsentConfigError(
      'baseUrl uses plain http://, which would send your API key unencrypted. Use https:// (http:// is only allowed for localhost).',
    );
  }
  if (url.username || url.password) {
    throw new UnsentConfigError('baseUrl must not contain credentials; pass apiKey/apiSecret instead.');
  }
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(signal?: AbortSignal): UnsentConnectionError {
  return new UnsentConnectionError('The request was aborted', { code: 'aborted', cause: signal?.reason });
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
  return undefined;
}

function isRetryableStatus(err: UnsentAPIError): boolean {
  if (err.code === 'server_misconfigured') return false;
  const s = err.status;
  return s === 408 || s === 425 || s === 429 || (s >= 500 && s !== 501 && s !== 505);
}

export class HttpClient {
  /** Server clock minus local clock, learned from a `timestamp_skew` response. */
  #clockOffsetMs = 0;

  readonly #cfg: HttpConfig;

  constructor(cfg: HttpConfig) {
    this.#cfg = cfg;
  }

  get hasApiSecret(): boolean {
    return !!this.#cfg.apiSecret;
  }

  async call<T>(opts: CallOptions): Promise<CallResult<T>> {
    const maxRetries = Math.max(0, Math.floor(opts.maxRetries ?? this.#cfg.maxRetries));
    const timeoutMs = opts.timeoutMs ?? this.#cfg.timeoutMs;
    const bodyText = opts.body === undefined ? undefined : JSON.stringify(opts.body);

    let attempt = 0;
    let clockCorrected = false;
    for (;;) {
      if (opts.signal?.aborted) throw abortError(opts.signal);
      try {
        return await this.attempt<T>(opts, bodyText, timeoutMs);
      } catch (err) {
        if (!(err instanceof UnsentError)) throw err;
        if (opts.signal?.aborted) throw abortError(opts.signal);

        // A skewed local clock fails signature checks before the nonce is consumed, so one
        // corrected retry is free and always safe.
        if (!clockCorrected && err.code === 'timestamp_skew' && this.hasApiSecret) {
          clockCorrected = true;
          if (await this.syncClock(err, opts.signal)) continue;
        }

        let delay: number | undefined;
        if (attempt < maxRetries && opts.retrySafe) {
          if (err instanceof UnsentConnectionError && err.code !== 'aborted') {
            delay = this.backoff(attempt);
          } else if ('status' in err && isRetryableStatus(err as UnsentAPIError)) {
            const e = err as UnsentAPIError;
            delay = Math.max(this.backoff(attempt), e.retryAfterMs ?? 0);
          }
        }
        if (delay === undefined) throw err;
        attempt++;
        await sleep(delay, opts.signal);
      }
    }
  }

  private backoff(attempt: number): number {
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
    return Math.round(exp / 2 + Math.random() * (exp / 2));
  }

  /**
   * Measure how far the local clock is from the server's, from the error's `Date` header or, failing that
   * (some runtimes and proxies drop it), the server timestamp in the public health probe.
   * Returns true when a meaningful offset was learned and a retry is worthwhile.
   */
  private async syncClock(err: UnsentError, signal?: AbortSignal): Promise<boolean> {
    let serverTime = (err as UnsentAPIError).serverTimeMs;
    let localTime = Date.now();
    if (typeof serverTime !== 'number') {
      try {
        const before = Date.now();
        const res = await this.attempt<{ timestamp?: unknown }>(
          { method: 'GET', path: '/api/health', auth: false, retrySafe: true, signal },
          undefined,
          Math.min(this.#cfg.timeoutMs, 5_000),
        );
        const after = Date.now();
        if (typeof res.data.timestamp !== 'number') return false;
        serverTime = res.data.timestamp;
        localTime = (before + after) / 2;
      } catch {
        return false;
      }
    }
    const offset = serverTime - localTime;
    if (Math.abs(offset) < MIN_CLOCK_CORRECTION_MS) {
      // The local clock is fine now. If we were compensating for an earlier skew (e.g. the host clock
      // was since fixed), drop the stale offset and retry; otherwise skew is not the problem.
      if (this.#clockOffsetMs === 0) return false;
      this.#clockOffsetMs = 0;
      return true;
    }
    this.#clockOffsetMs = offset;
    return true;
  }

  private async attempt<T>(opts: CallOptions, bodyText: string | undefined, timeoutMs: number): Promise<CallResult<T>> {
    const url = new URL(this.#cfg.baseUrl + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.auth !== false) headers['X-API-Key'] = this.#cfg.apiKey;
    if (bodyText !== undefined) headers['Content-Type'] = 'application/json';
    if (typeof window === 'undefined') headers['User-Agent'] = `unsent-sdk-js/${VERSION}`;

    if (opts.sign && this.#cfg.apiSecret) {
      // Fresh timestamp + nonce on every attempt: the server rejects reused nonces.
      const timestamp = String(Math.floor((Date.now() + this.#clockOffsetMs) / 1000));
      const nonce = randomNonce();
      headers['X-Timestamp'] = timestamp;
      headers['X-Nonce'] = nonce;
      headers['X-Signature'] = `sha256=${await signRequest({ secret: this.#cfg.apiSecret, timestamp, nonce, body: bodyText ?? '' })}`;
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onUserAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onUserAbort, { once: true });

    let res: Response;
    try {
      res = await this.#cfg.fetch(url.toString(), {
        method: opts.method,
        headers,
        body: bodyText,
        signal: controller.signal,
        // 'manual' rather than 'error': Cloudflare Workers does not implement 'error'. Redirects are never
        // followed (they would forward the API key to another host); see the 3xx check below.
        redirect: 'manual',
      });
    } catch (cause) {
      if (timedOut) {
        throw new UnsentTimeoutError(`Request to ${url.pathname} timed out after ${timeoutMs} ms`, { cause });
      }
      if (opts.signal?.aborted) throw abortError(opts.signal);
      const detail = cause instanceof Error ? (cause.cause instanceof Error ? cause.cause.message : cause.message) : String(cause);
      throw new UnsentConnectionError(`Could not reach ${new URL(this.#cfg.baseUrl).host}: ${detail}`, { cause });
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onUserAbort);
    }

    if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
      const location = res.headers.get('Location');
      throw new UnsentError(
        `${url.pathname} was redirected${location ? ` to ${location}` : ''}. The SDK does not follow redirects because that would send your API key to another host. Set baseUrl to the final URL${url.protocol === 'http:' ? ' (use https://)' : ''}.`,
        { code: 'unexpected_redirect' },
      );
    }

    let text: string;
    try {
      text = await res.text();
    } catch (cause) {
      throw new UnsentConnectionError(`Connection dropped while reading the response from ${url.pathname}`, { cause });
    }
    let parsed: unknown = text;
    let isJson = false;
    if (text) {
      try {
        parsed = JSON.parse(text);
        isJson = true;
      } catch {
        /* non-JSON body (proxy error page) */
      }
    }

    if (!res.ok) {
      const dateHeader = res.headers.get('Date');
      const serverTime = dateHeader ? Date.parse(dateHeader) : NaN;
      throw apiErrorFromResponse(res.status, isJson ? parsed : text, {
        hasApiSecret: this.hasApiSecret,
        retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')),
        serverTimeMs: Number.isNaN(serverTime) ? undefined : serverTime,
        statusText: res.statusText,
      });
    }
    if (!isJson) {
      throw new UnsentError(`Unexpected non-JSON response from ${url.pathname} (HTTP ${res.status}). Is baseUrl pointing at your Unsent deployment?`, {
        code: 'invalid_response',
      });
    }
    return { status: res.status, data: parsed as T, headers: res.headers };
  }
}
