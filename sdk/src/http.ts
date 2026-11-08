import {
  UnsentConfigError,
  UnsentConnectionError,
  UnsentError,
  UnsentTimeoutError,
  UnsentValidationError,
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
  /** Fixed, SDK-chosen path starting with `/`. Never caller-controlled. */
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
  /** Absolute epoch-ms deadline for the whole call, retries included (used by `wait()`). */
  deadline?: number;
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
/** Mirrors the server's `/api/send` limit; larger bodies are rejected before any network I/O. */
export const MAX_REQUEST_BODY_BYTES = 3 * 1024 * 1024;
/** Responses larger than this are refused (announced via Content-Length, or counted while streaming). */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** Largest delay `setTimeout` supports; longer values fire immediately in Node and browsers. */
export const MAX_TIMEOUT_MS = 2_147_483_647;
/** Server clocks outside this window are ignored (a hostile `Date` header must not poison signatures). */
const MIN_PLAUSIBLE_SERVER_TIME = Date.UTC(2000, 0, 1);
const MAX_PLAUSIBLE_SERVER_TIME = Date.UTC(2200, 0, 1);
/** Credentials shorter than this are not redacted from server text (it would garble messages). */
const MIN_REDACT_LENGTH = 8;

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsentConfigError(`baseUrl ${JSON.stringify(raw.slice(0, 200))} is not a valid URL. Expected something like https://unsent.example.com`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UnsentConfigError(`baseUrl must start with https:// (got ${url.protocol.slice(0, 20)}//)`);
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
  // A plain loop rather than /\/+$/: that regex is quadratic on long runs of slashes.
  const s = url.toString();
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 0x2f) end--;
  return s.slice(0, end);
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

function plausibleServerTime(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_SERVER_TIME && ms <= MAX_PLAUSIBLE_SERVER_TIME;
}

function isRetryableStatus(err: UnsentAPIError): boolean {
  if (err.code === 'server_misconfigured') return false;
  const s = err.status;
  return s === 408 || s === 425 || s === 429 || (s >= 500 && s !== 501 && s !== 505);
}

function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function isResponseLike(v: unknown): v is Response {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as Response).status === 'number' &&
    Number.isInteger((v as Response).status) &&
    !!(v as Response).headers &&
    typeof (v as Response).headers.get === 'function'
  );
}

export class HttpClient {
  /** Server clock minus local clock, learned from a `timestamp_skew` response. */
  #clockOffsetMs = 0;

  readonly #cfg: HttpConfig;
  readonly #origin: string;

  constructor(cfg: HttpConfig) {
    this.#cfg = cfg;
    this.#origin = new URL(cfg.baseUrl).origin;
  }

  get hasApiSecret(): boolean {
    return !!this.#cfg.apiSecret;
  }

  /** Remove the credentials from text a (possibly hostile) server sent back, before it reaches an error. */
  #redact(text: string): string {
    let out = text;
    for (const secret of [this.#cfg.apiKey, this.#cfg.apiSecret]) {
      if (!secret || secret.length < MIN_REDACT_LENGTH) continue;
      // Also the JSON-escaped spelling, in case the secret contains quotes or backslashes.
      for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) out = out.split(form).join('[REDACTED]');
    }
    return out;
  }

  async call<T>(opts: CallOptions): Promise<CallResult<T>> {
    const maxRetries = opts.maxRetries ?? this.#cfg.maxRetries;
    const timeoutMs = opts.timeoutMs ?? this.#cfg.timeoutMs;
    const bodyText = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    if (bodyText !== undefined && utf8Length(bodyText) > MAX_REQUEST_BODY_BYTES) {
      throw new UnsentValidationError(
        `The request body is larger than the server limit of ${MAX_REQUEST_BODY_BYTES} bytes. Attachments are base64-encoded (+33%); keep raw attachment data under ~1.4 MB.`,
        'payload_too_large',
      );
    }

    let attempt = 0;
    let clockCorrected = false;
    for (;;) {
      if (opts.signal?.aborted) throw abortError(opts.signal);
      let attemptTimeout = timeoutMs;
      if (opts.deadline !== undefined) {
        const remaining = opts.deadline - Date.now();
        if (remaining <= 0) throw new UnsentTimeoutError(`Request to ${opts.path} did not finish before the deadline`);
        attemptTimeout = Math.min(attemptTimeout, remaining);
      }
      try {
        return await this.attempt<T>(opts, bodyText, attemptTimeout);
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
        if (opts.deadline !== undefined && Date.now() + delay >= opts.deadline) throw err;
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
    if (!plausibleServerTime(serverTime)) {
      try {
        const before = Date.now();
        const res = await this.attempt<{ timestamp?: unknown }>(
          { method: 'GET', path: '/api/health', auth: false, retrySafe: true, signal },
          undefined,
          Math.min(this.#cfg.timeoutMs, 5_000),
        );
        const after = Date.now();
        const ts = res.data && typeof res.data === 'object' ? res.data.timestamp : undefined;
        if (!plausibleServerTime(ts)) return false;
        serverTime = ts;
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

  private buildUrl(opts: CallOptions): URL {
    // Paths are SDK constants; refuse anything that could re-target the request (e.g. "@evil.com/").
    if (typeof opts.path !== 'string' || !/^\/[A-Za-z0-9/_-]*$/.test(opts.path)) {
      throw new UnsentValidationError('Invalid request path');
    }
    const url = new URL(this.#cfg.baseUrl + opts.path);
    if (url.origin !== this.#origin) throw new UnsentValidationError('Request URL left the configured baseUrl origin');
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    return url;
  }

  private async attempt<T>(opts: CallOptions, bodyText: string | undefined, timeoutMs: number): Promise<CallResult<T>> {
    const url = this.buildUrl(opts);

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

    // One controller and one timer cover the whole exchange: connecting, headers AND the body,
    // so a server that trickles (or never ends) its body still hits the timeout.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onUserAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onUserAbort, { once: true });
    // The caller may have aborted while the request was being signed (before the listener existed).
    if (opts.signal?.aborted) controller.abort();
    let onControllerAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onControllerAbort = () => reject(new Error('aborted'));
      controller.signal.addEventListener('abort', onControllerAbort, { once: true });
    });
    aborted.catch(() => {});

    const failure = (cause: unknown, phase: 'connect' | 'read'): UnsentError => {
      if (timedOut) return new UnsentTimeoutError(`Request to ${url.pathname} timed out after ${timeoutMs} ms`, { cause });
      if (opts.signal?.aborted) return abortError(opts.signal);
      if (phase === 'read') return new UnsentConnectionError(`Connection dropped while reading the response from ${url.pathname}`, { cause });
      let detail = 'unknown error';
      try {
        detail = cause instanceof Error ? (cause.cause instanceof Error ? cause.cause.message : cause.message) : String(cause);
      } catch {
        /* hostile thrown value */
      }
      return new UnsentConnectionError(`Could not reach ${url.host}: ${this.#redact(String(detail)).slice(0, 300)}`, { cause });
    };

    try {
      let res: unknown;
      try {
        res = await Promise.race([
          this.#cfg.fetch(url.toString(), {
            method: opts.method,
            headers,
            body: bodyText,
            signal: controller.signal,
            // 'manual' rather than 'error': Cloudflare Workers does not implement 'error'. Redirects are never
            // followed (they would forward the API key to another host); see the 3xx check below.
            redirect: 'manual',
          }),
          aborted,
        ]);
      } catch (cause) {
        throw failure(cause, 'connect');
      }
      if (!isResponseLike(res)) {
        throw new UnsentError(`fetch returned something that is not a Response for ${url.pathname}`, { code: 'invalid_response' });
      }

      if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
        discard(res);
        const location = this.#redact(String(res.headers.get('Location') ?? '')).slice(0, 300);
        throw new UnsentError(
          `${url.pathname} was redirected${location ? ` to ${location}` : ''}. The SDK does not follow redirects because that would send your API key to another host. Set baseUrl to the final URL${url.protocol === 'http:' ? ' (use https://)' : ''}.`,
          { code: 'unexpected_redirect' },
        );
      }

      const announced = Number(res.headers.get('Content-Length') ?? '');
      if (Number.isFinite(announced) && announced > MAX_RESPONSE_BYTES) {
        discard(res);
        throw responseTooLarge(url.pathname);
      }

      let text: string;
      try {
        text = await readBody(res, aborted, url.pathname);
      } catch (cause) {
        if (cause instanceof UnsentError) throw cause;
        throw failure(cause, 'read');
      }

      const ok = res.status >= 200 && res.status < 300;
      if (!ok) text = this.#redact(text);
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

      if (!ok) {
        const dateHeader = res.headers.get('Date');
        const serverTime = dateHeader ? Date.parse(dateHeader) : NaN;
        throw apiErrorFromResponse(res.status, isJson ? parsed : text, {
          hasApiSecret: this.hasApiSecret,
          retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')),
          serverTimeMs: plausibleServerTime(serverTime) ? serverTime : undefined,
          statusText: this.#redact(typeof res.statusText === 'string' ? res.statusText : ''),
        });
      }
      if (!isJson) {
        throw new UnsentError(`Unexpected non-JSON response from ${url.pathname} (HTTP ${res.status}). Is baseUrl pointing at your Unsent deployment?`, {
          code: 'invalid_response',
        });
      }
      return { status: res.status, data: parsed as T, headers: res.headers };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onUserAbort);
      if (onControllerAbort) controller.signal.removeEventListener('abort', onControllerAbort);
    }
  }
}

function responseTooLarge(path: string): UnsentError {
  return new UnsentError(`The response from ${path} is larger than ${MAX_RESPONSE_BYTES} bytes; refusing to read it`, {
    code: 'response_too_large',
  });
}

function discard(res: Response): void {
  try {
    void res.body?.cancel().catch(() => {});
  } catch {
    /* already consumed or locked */
  }
}

/** Read the body as UTF-8 text, bounded by {@link MAX_RESPONSE_BYTES} and interruptible by `aborted`. */
async function readBody(res: Response, aborted: Promise<never>, path: string): Promise<string> {
  const body = (res as { body?: unknown }).body as ReadableStream<Uint8Array> | null | undefined;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    let out = '';
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new TypeError('response body chunk is not bytes');
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) throw responseTooLarge(path);
        out += decoder.decode(value, { stream: true });
      }
      return out + decoder.decode();
    } catch (err) {
      reader.cancel().catch(() => {});
      throw err;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* pending read on a cancelled stream */
      }
    }
  }
  if (typeof res.text !== 'function') return '';
  const text = await Promise.race([res.text(), aborted]);
  if (typeof text !== 'string') return '';
  if (text.length > MAX_RESPONSE_BYTES) throw responseTooLarge(path);
  return text;
}
