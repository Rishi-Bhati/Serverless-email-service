/** An email address, either `"a@b.com"`, `"Name <a@b.com>"`, or `{ email, name }`. */
export type Address = string | { email: string; name?: string };

/** A file to attach. */
export interface Attachment {
  /** File name shown to the recipient, e.g. `invoice.pdf`. Defaults to `File.name` when `content` is a `File`. */
  filename?: string;
  /**
   * The file bytes. A `string` is treated as **already base64-encoded** (the API's wire format);
   * pass a `Uint8Array`/`Buffer`/`ArrayBuffer`/`Blob` and the SDK encodes it for you.
   */
  content: string | Uint8Array | ArrayBuffer | Blob;
  /** MIME type, e.g. `application/pdf`. Alias: `mimeType`. */
  contentType?: string;
  /** Alias of `contentType` (the API's field name). */
  mimeType?: string;
}

/** Per-call transport options, accepted by every method. */
export interface RequestOptions {
  /** Abort the call (and any retries). */
  signal?: AbortSignal;
  /** Per-attempt timeout in ms. Overrides the client default. */
  timeoutMs?: number;
  /** Maximum retries after the first attempt. Overrides the client default. `0` disables retries. */
  maxRetries?: number;
}

export interface SendEmailOptions extends RequestOptions {
  /**
   * Sender. Must match a provider configured in your Unsent dashboard. Omit it to use the default provider.
   * Falls back to the client's `defaultFrom`.
   */
  from?: Address;
  /** One or more recipients (max 100). */
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  /** HTML body. Provide `html`, `text`, or both. */
  html?: string;
  /** Plain-text body. If `html` is omitted, the SDK derives an HTML body from it. */
  text?: string;
  attachments?: Attachment[];
  /** Force a specific provider by its ID (see the dashboard). Falls back to the client's `defaultProviderId`. */
  providerId?: string;
  /**
   * Key that makes retries safe: the same key + same message never sends twice (remembered ~24h by default).
   * Omitted, the SDK generates a UUID per call and reuses it for automatic retries.
   * Pass your own (e.g. `order-123:receipt`) to deduplicate across processes/calls.
   * Pass `false` to disable idempotency; the SDK then never retries a send that might have been delivered.
   */
  idempotencyKey?: string | false;
}

export type EmailStatus = 'queued' | 'sending' | 'sent' | 'failed';

export interface SendEmailResult {
  /** Email ID. Use with `emails.get(id)` / `emails.wait(id)`. */
  id: number;
  /** `queued` for a new email; the current status when this was an idempotent replay. */
  status: EmailStatus;
  /** The key used for this send (yours, or the SDK-generated one). `null` if idempotency was disabled. */
  idempotencyKey: string | null;
  /** `true` when the key matched an email already queued; no new email was created. */
  idempotentReplay: boolean;
  /** Provider name the server targeted, or `Automatic Priority / Default`. */
  targetProvider: string;
  message: string;
}

export interface FailoverAttempt {
  provider: string;
  type: string;
  error: string;
  timestamp: Date;
}

export interface AttachmentInfo {
  filename: string;
  mimeType: string | null;
  /** Decoded size in bytes. */
  size: number;
}

/** An email as stored by the service. */
export interface Email {
  id: number;
  status: EmailStatus;
  to: string[];
  cc: string[] | null;
  bcc: string[] | null;
  subject: string;
  htmlBody: string;
  /** `null` when the email was sent without a plain-text alternative. */
  textBody: string | null;
  fromEmail: string | null;
  fromName: string | null;
  /** Provider ID requested at send time, if any. */
  providerId: string | null;
  /** Name of the provider that actually delivered it. */
  providerUsed: string | null;
  /** Providers that failed before this one succeeded (or all of them, if it failed). */
  failoverHistory: FailoverAttempt[];
  idempotencyKey: string | null;
  attempts: number;
  /** Last delivery error, if any. */
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachments: AttachmentInfo[];
}

/** Full email, from `emails.get(id)`. Attachments include their base64 content. */
export interface EmailDetail extends Omit<Email, 'attachments'> {
  attachments: Array<AttachmentInfo & { content: string }>;
}

export interface ListEmailsOptions extends RequestOptions {
  /** 1-200, default 100. */
  limit?: number;
  offset?: number;
  status?: EmailStatus;
  /** Matches subject, recipients, sender, provider, body and error text. */
  search?: string;
  /** Created on/after this day (UTC). `Date` or `YYYY-MM-DD`. */
  from?: Date | string;
  /** Created on/before this day (UTC). `Date` or `YYYY-MM-DD`. */
  to?: Date | string;
  sort?: 'updated_at_desc' | 'updated_at_asc' | 'created_at_desc' | 'created_at_asc' | 'attempts_desc';
}

export interface ListEmailsResult {
  emails: Email[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface WaitOptions {
  /** Give up after this many ms with an `UnsentTimeoutError`. Default 60000. */
  timeoutMs?: number;
  /** First poll interval in ms; backs off up to 5s. Default 1000. */
  intervalMs?: number;
  /** Stop waiting early. */
  signal?: AbortSignal;
}

export interface QueueStatus {
  queued: number;
  sending: number;
  sent: number;
  failed: number;
}

export interface Health {
  status: string;
  runtime: string;
  d1: string;
  timestamp: Date;
}

export interface UnsentOptions {
  /** Your deployment URL, e.g. `https://unsent.example.com`. Default: `UNSENT_BASE_URL` env var. */
  baseUrl?: string;
  /** The `API_KEY` of your deployment. Default: `UNSENT_API_KEY` env var. */
  apiKey?: string;
  /**
   * The `API_SECRET` of your deployment; used to HMAC-sign requests. Default: `UNSENT_API_SECRET` env var.
   * Required unless your server runs with `SECURITY_MODE=api-key-only`. Safe to pass in every mode.
   */
  apiSecret?: string;
  /** Default sender for `send()`. */
  defaultFrom?: Address;
  /** Default provider ID for `send()`. */
  defaultProviderId?: string;
  /** Per-attempt timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Retries after the first attempt for network errors, 408, 429 and 5xx. Default 3. */
  maxRetries?: number;
  /** Custom `fetch` (testing, proxies, instrumentation). Default: `globalThis.fetch`. */
  fetch?: typeof fetch;
  /**
   * The SDK refuses to run in a browser because that would expose your API secret to every visitor.
   * Set this to `true` only if you understand the risk (e.g. an internal tool).
   */
  dangerouslyAllowBrowser?: boolean;
}
