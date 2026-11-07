import type { AttachmentInfo, Email, EmailDetail, EmailStatus, FailoverAttempt } from './types';

type Wire = Record<string, any>;

const STATUSES: ReadonlySet<string> = new Set(['queued', 'sending', 'sent', 'failed']);

function toDate(ms: unknown): Date {
  return new Date(typeof ms === 'number' ? ms : Number(ms) || 0);
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
  return list.map((f: Wire) => ({
    provider: String(f?.provider ?? ''),
    type: String(f?.type ?? ''),
    error: String(f?.error ?? ''),
    timestamp: toDate(f?.timestamp),
  }));
}

function base64Size(content: string): number {
  const padding = content.length - content.replace(/=+$/, '').length;
  return Math.max(0, Math.floor((content.length * 3) / 4) - padding);
}

function mapBase(w: Wire): Omit<Email, 'attachments'> {
  const html = typeof w.html_body === 'string' ? w.html_body : typeof w.body === 'string' ? w.body : '';
  // The API falls back to the HTML body when no plain-text alternative was stored.
  const text = typeof w.text_body === 'string' && w.text_body && w.text_body !== html ? w.text_body : null;
  return {
    id: Number(w.id),
    status: (STATUSES.has(w.status) ? w.status : 'queued') as EmailStatus,
    to: strArray(w.to) ?? [],
    cc: strArray(w.cc),
    bcc: strArray(w.bcc),
    subject: String(w.subject ?? ''),
    htmlBody: html,
    textBody: text,
    fromEmail: w.from_email ?? null,
    fromName: w.from_name ?? null,
    providerId: w.provider_id ?? null,
    providerUsed: w.provider_used ?? null,
    failoverHistory: parseFailover(w.failover_history),
    idempotencyKey: w.idempotency_key ?? null,
    attempts: Number(w.attempts) || 0,
    error: w.error ?? null,
    createdAt: toDate(w.created_at),
    updatedAt: toDate(w.updated_at),
  };
}

export function mapEmail(w: Wire): Email {
  const attachments: AttachmentInfo[] = (Array.isArray(w.attachments) ? w.attachments : []).map((a: Wire) => ({
    filename: String(a?.filename ?? ''),
    mimeType: a?.mimeType ?? null,
    size: typeof a?.size === 'number' ? a.size : typeof a?.content === 'string' ? base64Size(a.content) : 0,
  }));
  return { ...mapBase(w), attachments };
}

export function mapEmailDetail(w: Wire): EmailDetail {
  const attachments = (Array.isArray(w.attachments) ? w.attachments : []).map((a: Wire) => {
    const content = typeof a?.content === 'string' ? a.content : '';
    return {
      filename: String(a?.filename ?? ''),
      mimeType: a?.mimeType ?? null,
      size: base64Size(content),
      content,
    };
  });
  return { ...mapBase(w), attachments };
}
