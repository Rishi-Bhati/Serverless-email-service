import { toWireAttachment, MAX_ATTACHMENTS, type WireAttachment } from './attachments';
import { normalizeRecipients, parseAddress } from './address';
import { randomUuid } from './crypto';
import { UnsentConfigError, UnsentConnectionError, UnsentError, UnsentTimeoutError, UnsentValidationError } from './errors';
import { HttpClient, MAX_TIMEOUT_MS, normalizeBaseUrl } from './http';
import { invalidResponse, isObject, mapEmail, mapEmailDetail, num, status as toStatus, str } from './mapping';
import type {
  Address,
  Email,
  EmailDetail,
  Health,
  ListEmailsOptions,
  ListEmailsResult,
  QueueStatus,
  RequestOptions,
  SendEmailOptions,
  SendEmailResult,
  UnsentOptions,
  WaitOptions,
} from './types';

/** After this many delivery attempts the service stops retrying a failed email. */
export const MAX_DELIVERY_ATTEMPTS = 3;

const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,255}$/;
const API_KEY_RE = /^[\x20-\x7e]+$/;
const MAX_SUBJECT = 1000;
const MAX_PROVIDER_ID = 255;
const MAX_RETRIES_LIMIT = 10;
const LIST_STATUSES: ReadonlySet<string> = new Set(['queued', 'sending', 'sent', 'failed']);
const LIST_SORTS: ReadonlySet<string> = new Set(['updated_at_desc', 'updated_at_asc', 'created_at_desc', 'created_at_asc', 'attempts_desc']);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function abortedError(signal?: AbortSignal): UnsentConnectionError {
  return new UnsentConnectionError('The wait was aborted', { code: 'aborted', cause: signal?.reason });
}

function isFinal(email: Pick<Email, 'status' | 'attempts'>): boolean {
  return email.status === 'sent' || (email.status === 'failed' && email.attempts >= MAX_DELIVERY_ATTEMPTS);
}

function safeMessage(err: unknown): string {
  try {
    if (err instanceof Error && typeof err.message === 'string') return err.message.slice(0, 200);
  } catch {
    /* hostile error object */
  }
  return 'unexpected value';
}

function isUnsentError(err: unknown): err is UnsentError {
  try {
    return err instanceof UnsentError;
  } catch {
    return false; // a Proxy whose getPrototypeOf trap throws
  }
}

/**
 * Run a public method so that only SDK errors ever escape. Anything else (a throwing getter, a Proxy trap,
 * a hostile `toString`) is reported as a validation error, because it can only come from the arguments.
 */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUnsentError(err)) throw err;
    throw new UnsentValidationError(`Invalid argument: ${safeMessage(err)}`, 'validation_error', err);
  }
}

function isAbortSignal(v: unknown): v is AbortSignal {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as AbortSignal).aborted === 'boolean' &&
    typeof (v as AbortSignal).addEventListener === 'function' &&
    typeof (v as AbortSignal).removeEventListener === 'function'
  );
}

function checkTimeout(v: unknown, name: string, Err: typeof UnsentValidationError | typeof UnsentConfigError): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0) || v > MAX_TIMEOUT_MS) {
    throw new Err(`${name} must be a positive number of milliseconds up to ${MAX_TIMEOUT_MS}`);
  }
  return v;
}

function checkRetries(v: unknown, name: string, Err: typeof UnsentValidationError | typeof UnsentConfigError): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_RETRIES_LIMIT) {
    throw new Err(`${name} must be an integer from 0 to ${MAX_RETRIES_LIMIT}`);
  }
  return v;
}

/**
 * Pick ONLY the documented transport options. Spreading the caller's object into the internal call let keys such
 * as `path`, `query`, `auth` or `body` through, so `list({ path: '@evil.com/' })` sent the API key to another host.
 */
function requestOptions(o: RequestOptions | undefined): { signal?: AbortSignal; timeoutMs?: number; maxRetries?: number } {
  if (o === undefined || o === null) return {};
  if (typeof o !== 'object') throw new UnsentValidationError('Request options must be an object');
  const signal: unknown = o.signal;
  const timeoutMs = checkTimeout(o.timeoutMs, 'timeoutMs', UnsentValidationError);
  const maxRetries = checkRetries(o.maxRetries, 'maxRetries', UnsentValidationError);
  if (signal !== undefined && signal !== null && !isAbortSignal(signal)) {
    throw new UnsentValidationError('signal must be an AbortSignal');
  }
  return {
    ...(signal ? { signal: signal as AbortSignal } : {}),
    ...(timeoutMs !== undefined && { timeoutMs }),
    ...(maxRetries !== undefined && { maxRetries }),
  };
}

function checkId(id: unknown): number {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new UnsentValidationError('"id" must be a positive integer');
  return id;
}

function validDay(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function dayParam(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v instanceof Date) {
    const t = v.getTime();
    if (Number.isNaN(t)) throw new UnsentValidationError(`"${field}" is an invalid Date`);
    const year = v.getUTCFullYear();
    if (year < 0 || year > 9999) throw new UnsentValidationError(`"${field}" must be between years 0000 and 9999`);
    return v.toISOString().slice(0, 10);
  }
  // A calendar date, optionally followed by an ISO time ("2024-05-01T10:00:00Z"); only the day is sent.
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(v) || v.length > 64) {
    throw new UnsentValidationError(`"${field}" must be a Date or YYYY-MM-DD`);
  }
  const day = v.slice(0, 10);
  if (!validDay(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)))) {
    throw new UnsentValidationError(`"${field}" is not a real calendar date: ${day}`);
  }
  return day;
}

function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new UnsentValidationError(`"${field}" must be a string`);
  return v;
}

function checkProviderId(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !v.trim() || v.length > MAX_PROVIDER_ID || /[\x00-\x1f\x7f]/.test(v)) {
    throw new UnsentValidationError(`"providerId" must be a non-empty string up to ${MAX_PROVIDER_ID} characters without control characters`);
  }
  return v.trim();
}

/** `client.emails`: send and inspect emails. */
export class Emails {
  readonly #http: HttpClient;
  readonly #defaults: { from?: { email: string; name?: string }; providerId?: string };

  /** @internal */
  constructor(http: HttpClient, defaults: { from?: { email: string; name?: string }; providerId?: string }) {
    this.#http = http;
    this.#defaults = defaults;
  }

  /**
   * Queue an email for delivery.
   *
   * Resolves as soon as the service has accepted the email (HTTP 202); delivery happens in the background.
   * Use {@link Emails.wait} to block until it is actually sent.
   *
   * Retries on network errors, timeouts, 429 and 5xx are automatic and cannot cause duplicates:
   * every send carries an idempotency key (yours, or a generated UUID).
   */
  send(options: SendEmailOptions): Promise<SendEmailResult> {
    return guard(() => this.#send(options));
  }

  async #send(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!options || typeof options !== 'object') throw new UnsentValidationError('send() needs an options object');

    // Snapshot: read each option exactly once, so a getter cannot pass validation and then change.
    const o = {
      to: options.to as unknown,
      cc: options.cc as unknown,
      bcc: options.bcc as unknown,
      subject: options.subject as unknown,
      html: options.html as unknown,
      text: options.text as unknown,
      attachments: options.attachments as unknown,
      from: options.from as unknown,
      providerId: options.providerId as unknown,
      idempotencyKey: options.idempotencyKey as unknown,
    };
    const request = requestOptions(options);

    const to = normalizeRecipients(o.to, 'to', true) as string[];
    const cc = normalizeRecipients(o.cc, 'cc', false);
    const bcc = normalizeRecipients(o.bcc, 'bcc', false);

    if (typeof o.subject !== 'string' || !o.subject.trim()) {
      throw new UnsentValidationError('"subject" is required');
    }
    const subject = o.subject;
    if (subject.length > MAX_SUBJECT) {
      throw new UnsentValidationError(`"subject" is ${subject.length} characters (maximum ${MAX_SUBJECT})`);
    }

    const htmlIn = optionalString(o.html, 'html');
    const textIn = optionalString(o.text, 'text');
    const hasHtml = htmlIn !== undefined && htmlIn.trim() !== '';
    const hasText = textIn !== undefined && textIn.trim() !== '';
    if (!hasHtml && !hasText) throw new UnsentValidationError('Provide "html", "text", or both');
    // The API requires an HTML body; derive one from the text so text-only sends just work.
    const html = hasHtml ? (htmlIn as string) : `<div style="white-space:pre-wrap">${escapeHtml(textIn as string)}</div>`;

    let attachments: WireAttachment[] | undefined;
    if (o.attachments !== undefined && o.attachments !== null) {
      if (!Array.isArray(o.attachments)) throw new UnsentValidationError('"attachments" must be an array');
      const list: unknown[] = o.attachments;
      const n = list.length;
      if (n > MAX_ATTACHMENTS) {
        throw new UnsentValidationError(`Too many attachments (${n}, maximum ${MAX_ATTACHMENTS})`);
      }
      const items: unknown[] = [];
      for (let i = 0; i < n; i++) items.push(list[i]);
      // Sequential, so an oversize attachment fails before the others are encoded.
      const out: WireAttachment[] = [];
      for (let i = 0; i < items.length; i++) out.push(await toWireAttachment(items[i] as never, i));
      if (out.length > 0) attachments = out;
    }

    const from = o.from === undefined || o.from === null ? this.#defaults.from : parseAddress(o.from as Address, 'from');
    const providerId = o.providerId === undefined || o.providerId === null ? this.#defaults.providerId : checkProviderId(o.providerId);

    let idempotencyKey: string | null;
    if (o.idempotencyKey === false) {
      idempotencyKey = null;
    } else if (o.idempotencyKey === undefined) {
      idempotencyKey = randomUuid();
    } else {
      const k = typeof o.idempotencyKey === 'string' ? o.idempotencyKey.trim() : '';
      if (!IDEMPOTENCY_KEY_RE.test(k)) {
        throw new UnsentValidationError(
          '"idempotencyKey" must be 1-255 printable ASCII characters without spaces (e.g. a UUID or "order-123:receipt")',
          'invalid_idempotency_key',
        );
      }
      idempotencyKey = k;
    }

    // Provider and sender go in the signed body, never in headers, so the signature covers them.
    const body: Record<string, unknown> = {
      to,
      ...(cc && { cc }),
      ...(bcc && { bcc }),
      subject,
      html,
      ...(hasText && { text: textIn }),
      ...(attachments && { attachments }),
      ...(from && { from }),
      ...(providerId && { provider_id: providerId }),
      ...(idempotencyKey && { idempotency_key: idempotencyKey }),
    };

    const res = await this.#http.call<unknown>({
      method: 'POST',
      path: '/api/send',
      body,
      sign: true,
      // Without a key a retry could duplicate the email, so only keyed sends are retried.
      retrySafe: idempotencyKey !== null,
      ...request,
    });
    const d = res.data;
    if (!isObject(d)) throw invalidResponse('the send response is not an object');
    const id = num(d.id);
    if (!Number.isSafeInteger(id) || id < 1) throw invalidResponse('the send response has no email id');
    let replayed = d.idempotent_replay === true;
    try {
      replayed ||= res.headers.get('Idempotent-Replayed') === 'true';
    } catch {
      /* exotic Headers implementation */
    }
    return {
      id,
      status: toStatus(d.status),
      idempotencyKey: typeof d.idempotency_key === 'string' ? d.idempotency_key : idempotencyKey,
      idempotentReplay: replayed,
      targetProvider: str(d.targetProvider),
      message: str(d.message),
    };
  }

  /** Fetch one email, including attachment contents. Throws `UnsentNotFoundError` if it does not exist. */
  get(id: number, options: RequestOptions = {}): Promise<EmailDetail> {
    return guard(() => this.#get(id, requestOptions(options)));
  }

  async #get(idIn: unknown, request: ReturnType<typeof requestOptions> & { deadline?: number }): Promise<EmailDetail> {
    const id = checkId(idIn);
    const res = await this.#http.call<unknown>({ method: 'GET', path: `/api/emails/${id}`, retrySafe: true, ...request });
    if (!isObject(res.data)) throw invalidResponse('the email response is not an object');
    return mapEmailDetail(res.data.email);
  }

  /** List emails, newest-updated first by default. Attachment contents are not included. */
  list(options: ListEmailsOptions = {}): Promise<ListEmailsResult> {
    return guard(() => this.#list(options));
  }

  async #list(options: ListEmailsOptions): Promise<ListEmailsResult> {
    if (options === undefined || options === null) options = {};
    if (typeof options !== 'object') throw new UnsentValidationError('list() options must be an object');
    const limit: unknown = options.limit;
    const offset: unknown = options.offset;
    const statusIn: unknown = options.status;
    const searchIn: unknown = options.search;
    const fromIn: unknown = options.from;
    const toIn: unknown = options.to;
    const sortIn: unknown = options.sort;
    const request = requestOptions(options);

    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200)) {
      throw new UnsentValidationError('"limit" must be an integer from 1 to 200');
    }
    if (offset !== undefined && (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0)) {
      throw new UnsentValidationError('"offset" must be a non-negative integer');
    }
    if (statusIn !== undefined && (typeof statusIn !== 'string' || !LIST_STATUSES.has(statusIn))) {
      throw new UnsentValidationError(`"status" must be one of ${[...LIST_STATUSES].join(', ')}`);
    }
    if (sortIn !== undefined && (typeof sortIn !== 'string' || !LIST_SORTS.has(sortIn))) {
      throw new UnsentValidationError(`"sort" must be one of ${[...LIST_SORTS].join(', ')}`);
    }
    const search = optionalString(searchIn, 'search');
    const query = {
      limit: limit as number | undefined,
      offset: offset as number | undefined,
      status: statusIn as string | undefined,
      q: search,
      from: dayParam(fromIn, 'from'),
      to: dayParam(toIn, 'to'),
      sort: sortIn as string | undefined,
    };
    const res = await this.#http.call<unknown>({ method: 'GET', path: '/api/emails', query, retrySafe: true, ...request });
    const d = res.data;
    if (!isObject(d)) throw invalidResponse('the list response is not an object');
    if (d.emails !== undefined && d.emails !== null && !Array.isArray(d.emails)) throw invalidResponse('"emails" is not an array');
    const emails = ((d.emails as unknown[] | null | undefined) ?? []).map(mapEmail);
    const total = num(d.total);
    const off = num(d.offset);
    return { emails, total, limit: num(d.limit) || emails.length, offset: off, hasMore: off + emails.length < total };
  }

  /**
   * Iterate over every matching email, fetching pages as needed. Defaults to oldest-first so that
   * emails sent while iterating do not shift pages.
   */
  async *iterate(options: Omit<ListEmailsOptions, 'offset'> = {}): AsyncGenerator<Email, void, undefined> {
    const base = await guard(async () => {
      if (options === undefined || options === null) return {} as ListEmailsOptions;
      if (typeof options !== 'object') throw new UnsentValidationError('iterate() options must be an object');
      return { ...options } as ListEmailsOptions;
    });
    let offset = 0;
    for (;;) {
      const page = await this.list({ sort: 'created_at_asc', ...base, offset });
      for (const email of page.emails) yield email;
      if (!page.hasMore || page.emails.length === 0) return;
      offset += page.emails.length;
    }
  }

  /**
   * Poll until the email is delivered (`sent`) or has permanently failed (`failed` after all attempts),
   * then return it. Check `email.status`; a permanent failure does not throw.
   * Throws `UnsentTimeoutError` if it is still in flight after `timeoutMs` (default 60 s). The deadline also
   * bounds the individual status requests, so a hung server cannot stretch the wait.
   */
  wait(id: number, options: WaitOptions = {}): Promise<EmailDetail> {
    return guard(() => this.#wait(id, options));
  }

  async #wait(idIn: unknown, options: WaitOptions): Promise<EmailDetail> {
    const id = checkId(idIn);
    if (options === undefined || options === null) options = {};
    if (typeof options !== 'object') throw new UnsentValidationError('wait() options must be an object');
    const timeoutIn: unknown = options.timeoutMs;
    const intervalIn: unknown = options.intervalMs;
    const signalIn: unknown = options.signal;
    if (timeoutIn !== undefined && (typeof timeoutIn !== 'number' || !Number.isFinite(timeoutIn) || !(timeoutIn > 0))) {
      throw new UnsentValidationError('wait() timeoutMs must be a positive, finite number of milliseconds');
    }
    if (intervalIn !== undefined && (typeof intervalIn !== 'number' || !Number.isFinite(intervalIn) || !(intervalIn > 0))) {
      throw new UnsentValidationError('wait() intervalMs must be a positive, finite number of milliseconds');
    }
    if (signalIn !== undefined && signalIn !== null && !isAbortSignal(signalIn)) {
      throw new UnsentValidationError('signal must be an AbortSignal');
    }
    const signal = (signalIn ?? undefined) as AbortSignal | undefined;
    const timeoutMs = (timeoutIn as number | undefined) ?? 60_000;
    let interval = Math.min(5000, Math.max(100, (intervalIn as number | undefined) ?? 1000));
    const deadline = Date.now() + timeoutMs;
    const timedOut = (state: string) => new UnsentTimeoutError(`Email ${id} was still "${state}" after ${timeoutMs} ms`);
    let last = 'unknown';
    for (;;) {
      let email: EmailDetail;
      try {
        email = await this.#get(id, { ...(signal && { signal }), deadline });
      } catch (err) {
        if (err instanceof UnsentTimeoutError && Date.now() >= deadline - 1) throw timedOut(last);
        throw err;
      }
      last = email.status;
      if (isFinal(email)) return email;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timedOut(email.status);
      await new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(abortedError(signal));
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, Math.min(interval, remaining));
        const onAbort = () => {
          clearTimeout(timer);
          reject(abortedError(signal));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      interval = Math.min(5000, Math.round(interval * 1.5));
    }
  }
}

type EnvSource = Record<string, string | undefined>;

function processEnv(): EnvSource {
  try {
    const env = (globalThis as { process?: { env?: EnvSource } }).process?.env;
    return env && typeof env === 'object' ? env : {};
  } catch {
    return {};
  }
}

function clean(v: unknown, name: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new UnsentConfigError(`${name} must be a string`);
  const t = v.trim();
  return t ? t : undefined;
}

/**
 * The Unsent client.
 *
 * ```ts
 * const unsent = new Unsent({ baseUrl, apiKey, apiSecret });
 * await unsent.send({ to: 'user@example.com', subject: 'Hi', html: '<p>Hello</p>' });
 * ```
 *
 * With no arguments it reads `UNSENT_BASE_URL`, `UNSENT_API_KEY` and `UNSENT_API_SECRET` from the environment.
 */
export class Unsent {
  /** Send and inspect emails. */
  readonly emails!: Emails;
  readonly #http!: HttpClient;

  constructor(options: UnsentOptions = {}) {
    try {
      this.#http = this.#init(options);
    } catch (err) {
      if (isUnsentError(err)) throw err;
      throw new UnsentConfigError(`Invalid Unsent options: ${safeMessage(err)}`, 'invalid_config', err);
    }
  }

  #init(options: UnsentOptions): HttpClient {
    if (options === undefined || options === null) options = {};
    if (typeof options !== 'object') throw new UnsentConfigError('Unsent options must be an object');
    const o = {
      baseUrl: options.baseUrl as unknown,
      apiKey: options.apiKey as unknown,
      apiSecret: options.apiSecret as unknown,
      defaultFrom: options.defaultFrom as unknown,
      defaultProviderId: options.defaultProviderId as unknown,
      timeoutMs: options.timeoutMs as unknown,
      maxRetries: options.maxRetries as unknown,
      fetch: options.fetch as unknown,
      dangerouslyAllowBrowser: options.dangerouslyAllowBrowser as unknown,
    };
    const env = processEnv();
    const baseUrlRaw = clean(o.baseUrl, 'baseUrl') ?? clean(env.UNSENT_BASE_URL, 'UNSENT_BASE_URL');
    const apiKey = clean(o.apiKey, 'apiKey') ?? clean(env.UNSENT_API_KEY, 'UNSENT_API_KEY');
    const apiSecret = clean(o.apiSecret, 'apiSecret') ?? clean(env.UNSENT_API_SECRET, 'UNSENT_API_SECRET');

    if (!baseUrlRaw) {
      throw new UnsentConfigError('Missing baseUrl. Pass { baseUrl } or set UNSENT_BASE_URL (e.g. https://unsent.example.com).');
    }
    if (!apiKey) {
      throw new UnsentConfigError('Missing apiKey. Pass { apiKey } or set UNSENT_API_KEY (the API_KEY of your deployment).');
    }
    // The key goes into a header verbatim. Runtimes reject bad header values with errors that quote the value,
    // which would put the key into logs; reject it here without echoing it.
    if (!API_KEY_RE.test(apiKey)) {
      throw new UnsentConfigError('apiKey must contain only printable ASCII characters (no line breaks, control or non-ASCII characters)', 'invalid_api_key');
    }
    if (
      typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      o.dangerouslyAllowBrowser !== true
    ) {
      throw new UnsentConfigError(
        'The Unsent SDK looks like it is running in a browser, where your apiKey/apiSecret would be visible to every visitor. ' +
          'Call it from your server instead, or set dangerouslyAllowBrowser: true if you accept that risk.',
        'browser_not_allowed',
      );
    }

    const timeoutMs = checkTimeout(o.timeoutMs, 'timeoutMs', UnsentConfigError) ?? 30_000;
    const maxRetries = checkRetries(o.maxRetries, 'maxRetries', UnsentConfigError) ?? 3;
    if (o.fetch !== undefined && o.fetch !== null && typeof o.fetch !== 'function') {
      throw new UnsentConfigError('fetch must be a function');
    }
    const fetchImpl =
      (o.fetch as typeof fetch | undefined) ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new UnsentConfigError('No global fetch found. Use Node 20+, or pass { fetch } explicitly.');
    }

    let defaultFrom: { email: string; name?: string } | undefined;
    let defaultProviderId: string | undefined;
    try {
      defaultFrom = o.defaultFrom === undefined || o.defaultFrom === null ? undefined : parseAddress(o.defaultFrom as Address, 'defaultFrom');
      defaultProviderId = checkProviderId(o.defaultProviderId);
    } catch (err) {
      throw new UnsentConfigError(err instanceof Error ? err.message : 'Invalid default sender');
    }

    const http = new HttpClient({
      baseUrl: normalizeBaseUrl(baseUrlRaw),
      apiKey,
      apiSecret,
      timeoutMs,
      maxRetries,
      fetch: fetchImpl,
    });
    (this as { emails: Emails }).emails = new Emails(http, { from: defaultFrom, providerId: defaultProviderId });
    return http;
  }

  /**
   * Build a client from an environment-like object, e.g. Cloudflare Worker bindings:
   * `Unsent.fromEnv(env)`. Reads `UNSENT_BASE_URL`, `UNSENT_API_KEY`, `UNSENT_API_SECRET`.
   */
  static fromEnv(env: EnvSource, overrides: UnsentOptions = {}): Unsent {
    let opts: UnsentOptions;
    try {
      if (!env || typeof env !== 'object') throw new UnsentConfigError('fromEnv() needs an environment object');
      if (overrides !== undefined && overrides !== null && typeof overrides !== 'object') {
        throw new UnsentConfigError('fromEnv() overrides must be an object');
      }
      opts = {
        baseUrl: clean(env.UNSENT_BASE_URL, 'UNSENT_BASE_URL'),
        apiKey: clean(env.UNSENT_API_KEY, 'UNSENT_API_KEY'),
        apiSecret: clean(env.UNSENT_API_SECRET, 'UNSENT_API_SECRET'),
        ...(overrides ?? {}),
      };
    } catch (err) {
      if (isUnsentError(err)) throw err;
      throw new UnsentConfigError(`Invalid environment: ${safeMessage(err)}`, 'invalid_config', err);
    }
    return new Unsent(opts);
  }

  /** Shortcut for `emails.send()`. */
  send(options: SendEmailOptions): Promise<SendEmailResult> {
    return this.emails.send(options);
  }

  /** Queue counters. Also a cheap way to verify your credentials are accepted. */
  status(options: RequestOptions = {}): Promise<QueueStatus> {
    return guard(async () => {
      const res = await this.#http.call<unknown>({ method: 'GET', path: '/api/status', retrySafe: true, ...requestOptions(options) });
      const d = res.data;
      if (!isObject(d)) throw invalidResponse('the status response is not an object');
      return { queued: num(d.queued), sending: num(d.sending), sent: num(d.sent), failed: num(d.failed) };
    });
  }

  /** Public liveness probe. Needs no credentials, so it does not verify them; use {@link Unsent.status} for that. */
  health(options: RequestOptions = {}): Promise<Health> {
    return guard(async () => {
      const res = await this.#http.call<unknown>({ method: 'GET', path: '/api/health', auth: false, retrySafe: true, ...requestOptions(options) });
      const d = res.data;
      if (!isObject(d)) throw invalidResponse('the health response is not an object');
      const ts = new Date(num(d.timestamp) || Date.now());
      return {
        status: str(d.status),
        runtime: str(d.runtime),
        d1: str(d.d1),
        timestamp: Number.isNaN(ts.getTime()) ? new Date() : ts,
      };
    });
  }

  toJSON(): Record<string, never> {
    return {};
  }
}
