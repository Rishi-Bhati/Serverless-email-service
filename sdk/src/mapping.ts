import { UnsentError } from './errors';
import type { AttachmentInfo, Email, EmailDetail, EmailStatus, FailoverAttempt } from './types';

type Wire = Record<string, unknown>;

const STATUSES: ReadonlySet<string> = new Set(['queued', 'sending', 'sent', 'failed']);

/**
 * Response values come from the network and are never trusted: no `String(x)` / `Number(x)` on objects
 * (a JSON object such as `{"toString": null}` makes both throw), and wrong types degrade to defaults.
 */
export function str(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

export function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
}

export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function isObject(v: unknown): v is Wire {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function invalidResponse(what: string): UnsentError {
  return new UnsentError(`Unexpected response shape: ${what}. Is baseUrl pointing at your Unsent deployment?`, {
    code: 'invalid_response',
  });
}

export function status(v: unknown): EmailStatus {
  return (typeof v === 'string' && STATUSES.has(v) ? v : 'queued') as EmailStatus;
}

function toDate(ms: unknown): Date {
  const d = new Date(num(ms));
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === 'string');
}

function parseFailover(raw: unknown): FailoverAttempt[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map((f: unknown) => {
    const o = isObject(f) ? f : {};
    return {
      provider: str(o.provider),
      type: str(o.type),
      error: str(o.error),
      timestamp: toDate(o.timestamp),
    };
  });
}

/** Decoded size of a base64 string. A loop, not /=+$/ (quadratic on long runs of "="). */
function base64Size(content: string): number {
  let padding = 0;
  while (padding < content.length && content.charCodeAt(content.length - 1 - padding) === 0x3d) padding++;
  return Math.max(0, Math.floor((content.length * 3) / 4) - padding);
}

function mapBase(w: Wire): Omit<Email, 'attachments'> {
  const html = typeof w.html_body === 'string' ? w.html_body : typeof w.body === 'string' ? w.body : '';
  // The API falls back to the HTML body when no plain-text alternative was stored.
  const text = typeof w.text_body === 'string' && w.text_body && w.text_body !== html ? w.text_body : null;
  return {
    id: num(w.id),
    status: status(w.status),
    to: strArray(w.to) ?? [],
    cc: strArray(w.cc),
    bcc: strArray(w.bcc),
    subject: str(w.subject),
    htmlBody: html,
    textBody: text,
    fromEmail: strOrNull(w.from_email),
    fromName: strOrNull(w.from_name),
    providerId: strOrNull(w.provider_id),
    providerUsed: strOrNull(w.provider_used),
    failoverHistory: parseFailover(w.failover_history),
    idempotencyKey: strOrNull(w.idempotency_key),
    attempts: num(w.attempts),
    error: strOrNull(w.error),
    createdAt: toDate(w.created_at),
    updatedAt: toDate(w.updated_at),
  };
}

function attachmentList(w: Wire): Wire[] {
  return (Array.isArray(w.attachments) ? w.attachments : []).map((a: unknown) => (isObject(a) ? a : {}));
}

export function mapEmail(w: unknown): Email {
  if (!isObject(w)) throw invalidResponse('an email is not an object');
  const attachments: AttachmentInfo[] = attachmentList(w).map((a) => ({
    filename: str(a.filename),
    mimeType: strOrNull(a.mimeType),
    size: typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : typeof a.content === 'string' ? base64Size(a.content) : 0,
  }));
  return { ...mapBase(w), attachments };
}

export function mapEmailDetail(w: unknown): EmailDetail {
  if (!isObject(w)) throw invalidResponse('"email" is missing or not an object');
  const attachments = attachmentList(w).map((a) => {
    const content = typeof a.content === 'string' ? a.content : '';
    return {
      filename: str(a.filename),
      mimeType: strOrNull(a.mimeType),
      size: base64Size(content),
      content,
    };
  });
  return { ...mapBase(w), attachments };
}
