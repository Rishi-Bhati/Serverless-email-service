import { toWireAttachment, MAX_ATTACHMENTS, type WireAttachment } from './attachments';
import { normalizeRecipients, parseAddress } from './address';
import { randomUuid } from './crypto';
import { UnsentConfigError, UnsentConnectionError, UnsentTimeoutError, UnsentValidationError } from './errors';
import { HttpClient, normalizeBaseUrl } from './http';
import { mapEmail, mapEmailDetail } from './mapping';
import type {
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
  EmailStatus,
} from './types';

/** After this many delivery attempts the service stops retrying a failed email. */
export const MAX_DELIVERY_ATTEMPTS = 3;

const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,255}$/;
const MAX_SUBJECT = 1000;

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

function dayParam(v: Date | string | undefined, field: string): string | undefined {
  if (v === undefined) return undefined;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new UnsentValidationError(`"${field}" is an invalid Date`);
    return v.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) throw new UnsentValidationError(`"${field}" must be a Date or YYYY-MM-DD`);
  return v.slice(0, 10);
}

/** `client.emails`: send and inspect emails. */
export class Emails {
  readonly #http: HttpClient;
  readonly #defaults: { from?: UnsentOptions['defaultFrom']; providerId?: string };

  /** @internal */
  constructor(http: HttpClient, defaults: { from?: UnsentOptions['defaultFrom']; providerId?: string }) {
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
  async send(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!options || typeof options !== 'object') throw new UnsentValidationError('send() needs an options object');

    const to = normalizeRecipients(options.to, 'to', true) as string[];
    const cc = normalizeRecipients(options.cc, 'cc', false);
    const bcc = normalizeRecipients(options.bcc, 'bcc', false);

    if (typeof options.subject !== 'string' || !options.subject.trim()) {
      throw new UnsentValidationError('"subject" is required');
    }
    if (options.subject.length > MAX_SUBJECT) {
      throw new UnsentValidationError(`"subject" is ${options.subject.length} characters (maximum ${MAX_SUBJECT})`);
    }

    const hasHtml = typeof options.html === 'string' && options.html.trim() !== '';
    const hasText = typeof options.text === 'string' && options.text.trim() !== '';
    if (options.html !== undefined && typeof options.html !== 'string') throw new UnsentValidationError('"html" must be a string');
    if (options.text !== undefined && typeof options.text !== 'string') throw new UnsentValidationError('"text" must be a string');
    if (!hasHtml && !hasText) throw new UnsentValidationError('Provide "html", "text", or both');
    // The API requires an HTML body; derive one from the text so text-only sends just work.
    const html = hasHtml ? (options.html as string) : `<div style="white-space:pre-wrap">${escapeHtml(options.text as string)}</div>`;

    const attachmentsIn = options.attachments;
    let attachments: WireAttachment[] | undefined;
    if (attachmentsIn !== undefined) {
      if (!Array.isArray(attachmentsIn)) throw new UnsentValidationError('"attachments" must be an array');
      if (attachmentsIn.length > MAX_ATTACHMENTS) {
        throw new UnsentValidationError(`Too many attachments (${attachmentsIn.length}, maximum ${MAX_ATTACHMENTS})`);
      }
      if (attachmentsIn.length > 0) attachments = await Promise.all(attachmentsIn.map((a, i) => toWireAttachment(a, i)));
    }

    const fromIn = options.from ?? this.#defaults.from;
    const from = fromIn === undefined ? undefined : parseAddress(fromIn, 'from');
    if (from && /[\r\n\0]/.test(from.email + (from.name ?? ''))) {
      throw new UnsentValidationError('"from" contains a line break or NUL character');
    }

    const providerId = options.providerId ?? this.#defaults.providerId;
    if (providerId !== undefined && (typeof providerId !== 'string' || !providerId.trim() || providerId.length > 255)) {
      throw new UnsentValidationError('"providerId" must be a non-empty string up to 255 characters');
    }

    let idempotencyKey: string | null;
    if (options.idempotencyKey === false) {
      idempotencyKey = null;
    } else if (options.idempotencyKey === undefined) {
      idempotencyKey = randomUuid();
    } else {
      if (typeof options.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_RE.test(options.idempotencyKey.trim())) {
        throw new UnsentValidationError(
          '"idempotencyKey" must be 1-255 printable ASCII characters without spaces (e.g. a UUID or "order-123:receipt")',
          'invalid_idempotency_key',
        );
      }
      idempotencyKey = options.idempotencyKey.trim();
    }

    // Provider and sender go in the signed body, never in headers, so the signature covers them.
    const body: Record<string, unknown> = {
      to,
      ...(cc && { cc }),
      ...(bcc && { bcc }),
      subject: options.subject,
      html,
      ...(hasText && { text: options.text }),
      ...(attachments && { attachments }),
      ...(from && { from }),
      ...(providerId && { provider_id: providerId.trim() }),
      ...(idempotencyKey && { idempotency_key: idempotencyKey }),
    };

    const res = await this.#http.call<Record<string, any>>({
      method: 'POST',
      path: '/api/send',
      body,
      sign: true,
      // Without a key a retry could duplicate the email, so only keyed sends are retried.
      retrySafe: idempotencyKey !== null,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
    const d = res.data;
    return {
      id: Number(d.id),
      status: (d.status as EmailStatus) ?? 'queued',
      idempotencyKey: typeof d.idempotency_key === 'string' ? d.idempotency_key : idempotencyKey,
      idempotentReplay: d.idempotent_replay === true || res.headers.get('Idempotent-Replayed') === 'true',
      targetProvider: String(d.targetProvider ?? ''),
      message: String(d.message ?? ''),
    };
  }

  /** Fetch one email, including attachment contents. Throws `UnsentNotFoundError` if it does not exist. */
  async get(id: number, options: RequestOptions = {}): Promise<EmailDetail> {
    if (!Number.isSafeInteger(id) || id < 1) throw new UnsentValidationError('"id" must be a positive integer');
    const res = await this.#http.call<{ email: Record<string, any> }>({
      method: 'GET',
      path: `/api/emails/${id}`,
      retrySafe: true,
      ...options,
    });
    return mapEmailDetail(res.data.email);
  }

  /** List emails, newest-updated first by default. Attachment contents are not included. */
  async list(options: ListEmailsOptions = {}): Promise<ListEmailsResult> {
    const { limit, offset, status, search, from, to, sort, ...request } = options;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      throw new UnsentValidationError('"limit" must be an integer from 1 to 200');
    }
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
      throw new UnsentValidationError('"offset" must be a non-negative integer');
    }
    const res = await this.#http.call<{ emails: Record<string, any>[]; total: number; limit: number; offset: number }>({
      method: 'GET',
      path: '/api/emails',
      query: { limit, offset, status, q: search, from: dayParam(from, 'from'), to: dayParam(to, 'to'), sort },
      retrySafe: true,
      ...request,
    });
    const emails = (res.data.emails ?? []).map(mapEmail);
    const total = Number(res.data.total) || 0;
    const off = Number(res.data.offset) || 0;
    return { emails, total, limit: Number(res.data.limit) || emails.length, offset: off, hasMore: off + emails.length < total };
  }

  /**
   * Iterate over every matching email, fetching pages as needed. Defaults to oldest-first so that
   * emails sent while iterating do not shift pages.
   */
  async *iterate(options: Omit<ListEmailsOptions, 'offset'> = {}): AsyncGenerator<Email, void, undefined> {
    let offset = 0;
    for (;;) {
      const page = await this.list({ sort: 'created_at_asc', ...options, offset });
      for (const email of page.emails) yield email;
      if (!page.hasMore || page.emails.length === 0) return;
      offset += page.emails.length;
    }
  }

  /**
   * Poll until the email is delivered (`sent`) or has permanently failed (`failed` after all attempts),
   * then return it. Check `email.status`; a permanent failure does not throw.
   * Throws `UnsentTimeoutError` if it is still in flight after `timeoutMs` (default 60 s).
   */
  async wait(id: number, options: WaitOptions = {}): Promise<EmailDetail> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    let interval = Math.max(100, options.intervalMs ?? 1000);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const email = await this.get(id, { signal: options.signal });
      if (isFinal(email)) return email;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new UnsentTimeoutError(`Email ${id} was still "${email.status}" after ${timeoutMs} ms`);
      }
      await new Promise<void>((resolve, reject) => {
        const signal = options.signal;
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
  return ((globalThis as { process?: { env?: EnvSource } }).process?.env) ?? {};
}

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
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
  readonly emails: Emails;
  readonly #http: HttpClient;

  constructor(options: UnsentOptions = {}) {
    if (!options || typeof options !== 'object') throw new UnsentConfigError('Unsent options must be an object');
    const env = processEnv();
    const baseUrlRaw = clean(options.baseUrl) ?? clean(env.UNSENT_BASE_URL);
    const apiKey = clean(options.apiKey) ?? clean(env.UNSENT_API_KEY);
    const apiSecret = clean(options.apiSecret) ?? clean(env.UNSENT_API_SECRET);

    if (!baseUrlRaw) {
      throw new UnsentConfigError('Missing baseUrl. Pass { baseUrl } or set UNSENT_BASE_URL (e.g. https://unsent.example.com).');
    }
    if (!apiKey) {
      throw new UnsentConfigError('Missing apiKey. Pass { apiKey } or set UNSENT_API_KEY (the API_KEY of your deployment).');
    }
    if (
      typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      !options.dangerouslyAllowBrowser
    ) {
      throw new UnsentConfigError(
        'The Unsent SDK looks like it is running in a browser, where your apiKey/apiSecret would be visible to every visitor. ' +
          'Call it from your server instead, or set dangerouslyAllowBrowser: true if you accept that risk.',
        'browser_not_allowed',
      );
    }

    const timeoutMs = options.timeoutMs ?? 30_000;
    if (typeof timeoutMs !== 'number' || !(timeoutMs > 0) || !Number.isFinite(timeoutMs)) {
      throw new UnsentConfigError('timeoutMs must be a positive number of milliseconds');
    }
    const maxRetries = options.maxRetries ?? 3;
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
      throw new UnsentConfigError('maxRetries must be an integer from 0 to 10');
    }
    const fetchImpl = options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
    if (!fetchImpl) {
      throw new UnsentConfigError('No global fetch found. Use Node 20+, or pass { fetch } explicitly.');
    }

    this.#http = new HttpClient({
      baseUrl: normalizeBaseUrl(baseUrlRaw),
      apiKey,
      apiSecret,
      timeoutMs,
      maxRetries,
      fetch: fetchImpl,
    });
    this.emails = new Emails(this.#http, { from: options.defaultFrom, providerId: options.defaultProviderId });
  }

  /**
   * Build a client from an environment-like object, e.g. Cloudflare Worker bindings:
   * `Unsent.fromEnv(env)`. Reads `UNSENT_BASE_URL`, `UNSENT_API_KEY`, `UNSENT_API_SECRET`.
   */
  static fromEnv(env: EnvSource, overrides: UnsentOptions = {}): Unsent {
    return new Unsent({
      baseUrl: clean(env.UNSENT_BASE_URL),
      apiKey: clean(env.UNSENT_API_KEY),
      apiSecret: clean(env.UNSENT_API_SECRET),
      ...overrides,
    });
  }

  /** Shortcut for `emails.send()`. */
  send(options: SendEmailOptions): Promise<SendEmailResult> {
    return this.emails.send(options);
  }

  /** Queue counters. Also a cheap way to verify your credentials are accepted. */
  async status(options: RequestOptions = {}): Promise<QueueStatus> {
    const res = await this.#http.call<QueueStatus>({ method: 'GET', path: '/api/status', retrySafe: true, ...options });
    const d = res.data;
    return { queued: d.queued ?? 0, sending: d.sending ?? 0, sent: d.sent ?? 0, failed: d.failed ?? 0 };
  }

  /** Public liveness probe. Needs no credentials, so it does not verify them; use {@link Unsent.status} for that. */
  async health(options: RequestOptions = {}): Promise<Health> {
    const res = await this.#http.call<Record<string, any>>({ method: 'GET', path: '/api/health', auth: false, retrySafe: true, ...options });
    return {
      status: String(res.data.status ?? ''),
      runtime: String(res.data.runtime ?? ''),
      d1: String(res.data.d1 ?? ''),
      timestamp: new Date(Number(res.data.timestamp) || Date.now()),
    };
  }

  toJSON(): Record<string, never> {
    return {};
  }
}
