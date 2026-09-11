import { WorkerMailer } from 'worker-mailer';
import { decryptCredentials } from './crypto';

export type ProviderType = 'smtp' | 'resend' | 'sendgrid' | 'mailgun' | 'postmark';

export interface SmtpCredentials {
  host: string;
  port: number | string;
  secure?: boolean | string;
  starttls?: boolean | string;
  username: string;
  password: string;
  auth_type?: 'plain' | 'login';
  throttle_delay_ms?: number | string;
}

export interface ResendCredentials {
  api_key: string;
}

export interface SendGridCredentials {
  api_key: string;
}

export interface MailgunCredentials {
  api_key: string;
  domain: string;
  region?: 'us' | 'eu';
}

export interface PostmarkCredentials {
  server_token: string;
}

export type ProviderCredentials =
  | SmtpCredentials
  | ResendCredentials
  | SendGridCredentials
  | MailgunCredentials
  | PostmarkCredentials
  | Record<string, any>;

export interface ProviderRecord {
  id: string;
  name: string;
  type: ProviderType;
  credentials_json: string;
  from_email: string;
  from_name: string | null;
  priority: number;
  is_default: number;
  daily_limit: number;
  daily_sent_count: number;
  last_reset_date: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface EmailMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  fromEmail?: string;
  fromName?: string;
}

export interface SendResult {
  success: boolean;
  providerId: string;
  providerName: string;
  providerType: ProviderType;
  messageId?: string;
  error?: string;
}

/**
 * Returns current UTC date string YYYY-MM-DD
 */
export function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Validate that an outbound network host is not an internal/private IP or cloud metadata service (SSRF prevention).
 */
export function isDisallowedHost(host: string): boolean {
  if (!host) return true;
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '::') return true;
  if (h === 'metadata' || h === 'metadata.google.internal' || h === 'instance-data') return true;
  if (h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.localhost')) return true;

  // Integer decimal IP representation (e.g. 2130706433) or hex (0x7f000001)
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return true;

  // Loopback 127.0.0.0/8
  if (/^127\.\d+\.\d+\.\d+$/.test(h)) return true;

  // Link-local / Cloud metadata 169.254.0.0/16
  if (/^169\.254\.\d+\.\d+$/.test(h)) return true;

  // Private network ranges (RFC 1918): 10.0.0.0/8, 192.168.0.0/16, 172.16.0.0/12
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  const match172 = /^172\.(\d+)\.\d+\.\d+$/.exec(h);
  if (match172 && parseInt(match172[1], 10) >= 16 && parseInt(match172[1], 10) <= 31) return true;

  // Zero-network / broadcast
  if (/^0\.\d+\.\d+\.\d+$/.test(h)) return true;

  // IPv6 local / link-local / unique-local
  if (/^fe80:/i.test(h) || /^fc00:/i.test(h) || /^fd00:/i.test(h)) return true;

  return false;
}

/**
 * Sanitizes provider record so secrets (API keys, passwords) are masked
 * when returning data over APIs or displaying in dashboard.
 */
export async function sanitizeProvider(p: ProviderRecord, secret?: string): Promise<Record<string, any>> {
  let creds: any = {};
  try {
    creds = await decryptCredentials(p.credentials_json || '{}', secret);
  } catch {
    creds = {};
  }

  const maskedCreds: Record<string, any> = { ...creds };
  if (maskedCreds.password) {
    maskedCreds.password = '••••••••';
  }
  if (maskedCreds.api_key) {
    const key = String(maskedCreds.api_key);
    maskedCreds.api_key = key.length > 12 ? `${key.slice(0, 3)}••••••••` : '••••••••';
  }
  if (maskedCreds.server_token) {
    const token = String(maskedCreds.server_token);
    maskedCreds.server_token = token.length > 12 ? `${token.slice(0, 3)}••••••••` : '••••••••';
  }

  return {
    id: p.id,
    name: p.name,
    type: p.type,
    from_email: p.from_email,
    from_name: p.from_name,
    priority: p.priority,
    is_default: p.is_default === 1,
    daily_limit: p.daily_limit,
    daily_sent_count: p.daily_sent_count,
    daily_remaining: p.daily_limit > 0 ? Math.max(0, p.daily_limit - p.daily_sent_count) : null,
    last_reset_date: p.last_reset_date,
    is_active: p.is_active === 1,
    created_at: p.created_at,
    updated_at: p.updated_at,
    credentials: maskedCreds,
  };
}

/**
 * Fetch all providers from D1 (for administration / dashboard)
 */
export async function getAllProviders(db: D1Database): Promise<ProviderRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM providers ORDER BY is_default DESC, priority ASC, id ASC`
  ).all<ProviderRecord>();
  return result.results || [];
}

/**
 * Fetch active providers, automatically checking & resetting daily quotas if day changed
 */
export async function getActiveProviders(db: D1Database): Promise<ProviderRecord[]> {
  const today = getTodayUtc();
  const providers = await getAllProviders(db);
  const active = providers.filter(p => p.is_active === 1);

  // Check if any provider needs daily reset
  for (const p of active) {
    if (p.last_reset_date !== today) {
      await db.prepare(
        `UPDATE providers SET daily_sent_count = 0, last_reset_date = ?1, updated_at = ?2 WHERE id = ?3`
      ).bind(today, Date.now(), p.id).run();
      p.daily_sent_count = 0;
      p.last_reset_date = today;
    }
  }

  return active;
}

/**
 * Find provider by ID
 */
export async function getProviderById(db: D1Database, id: string): Promise<ProviderRecord | null> {
  const p = await db.prepare(
    `SELECT * FROM providers WHERE id = ?1`
  ).bind(id).first<ProviderRecord>();

  if (!p) return null;

  const today = getTodayUtc();
  if (p.last_reset_date !== today) {
    await db.prepare(
      `UPDATE providers SET daily_sent_count = 0, last_reset_date = ?1, updated_at = ?2 WHERE id = ?3`
    ).bind(today, Date.now(), p.id).run();
    p.daily_sent_count = 0;
    p.last_reset_date = today;
  }
  return p;
}

/**
 * Find active provider by from_email
 */
export async function getActiveProviderByEmail(db: D1Database, fromEmail: string): Promise<ProviderRecord | null> {
  const normalized = fromEmail.trim().toLowerCase();
  const active = await getActiveProviders(db);
  return active.find(p => p.from_email.trim().toLowerCase() === normalized) || null;
}

/**
 * Increment daily sent count for a provider
 */
export async function incrementProviderDailySent(db: D1Database, providerId: string): Promise<void> {
  await db.prepare(
    `UPDATE providers SET daily_sent_count = daily_sent_count + 1, updated_at = ?1 WHERE id = ?2`
  ).bind(Date.now(), providerId).run();
}

/**
 * Send an email via a specific provider record
 */
export async function sendEmailViaProvider(
  provider: ProviderRecord,
  message: EmailMessage,
  sharedMailer?: any,
  encryptionSecret?: string
): Promise<{ success: boolean; messageId?: string; mailerInstance?: any }> {
  let creds: any = {};
  try {
    creds = await decryptCredentials(provider.credentials_json || '{}', encryptionSecret);
  } catch (err: any) {
    throw new Error(`Invalid or undecryptable credentials for provider "${provider.name}": ${err.message}`);
  }

  const senderEmail = (message.fromEmail || provider.from_email || '').replace(/[\r\n\0]+/g, '').trim();
  const senderName = (message.fromName || provider.from_name || '').replace(/[\r\n\0]+/g, '').trim();
  const cleanSubject = (message.subject || '').replace(/[\r\n\0]+/g, ' ').trim();
  const isHtml = message.body.trim().startsWith('<') || message.body.toLowerCase().includes('html');

  switch (provider.type) {
    case 'smtp': {
      if (!creds.host || isDisallowedHost(creds.host)) {
        throw new Error(`SSRF protection: Prohibited or invalid host "${creds.host || ''}"`);
      }
      const port = parseInt(String(creds.port || 587), 10);
      const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];
      if (!ALLOWED_SMTP_PORTS.includes(port)) {
        throw new Error(`SSRF protection: Port ${port} is not an allowed SMTP port (allowed: ${ALLOWED_SMTP_PORTS.join(', ')})`);
      }
      let mailer = sharedMailer;
      if (!mailer) {
        mailer = await WorkerMailer.connect({
          host: creds.host,
          port,
          secure: creds.secure === true || creds.secure === 'true',
          startTls: creds.starttls !== false && creds.starttls !== 'false',
          credentials: {
            username: creds.username,
            password: creds.password,
          },
          authType: (creds.auth_type as any) || 'plain',
          socketTimeoutMs: 15000,
          responseTimeoutMs: 15000,
        });
      }

      await mailer.send({
        from: { name: senderName, email: senderEmail },
        to: message.to,
        cc: message.cc && message.cc.length ? message.cc : undefined,
        bcc: message.bcc && message.bcc.length ? message.bcc : undefined,
        subject: cleanSubject,
        text: isHtml ? undefined : message.body,
        html: isHtml ? message.body : undefined,
      });

      return { success: true, mailerInstance: mailer };
    }

    case 'resend': {
      const apiKey = creds.api_key;
      if (!apiKey) throw new Error('Missing Resend API Key');

      const formattedFrom = senderName ? `${senderName} <${senderEmail}>` : senderEmail;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: formattedFrom,
          to: message.to,
          cc: message.cc && message.cc.length ? message.cc : undefined,
          bcc: message.bcc && message.bcc.length ? message.bcc : undefined,
          subject: cleanSubject,
          text: isHtml ? undefined : message.body,
          html: isHtml ? message.body : undefined,
        }),
      });

      const resBody: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorText = resBody.message || resBody.error || `Resend API Error ${res.status}: ${res.statusText}`;
        throw new Error(errorText);
      }

      return { success: true, messageId: resBody.id };
    }

    case 'sendgrid': {
      const apiKey = creds.api_key;
      if (!apiKey) throw new Error('Missing SendGrid API Key');

      const personalizations: any = {
        to: message.to.map(e => ({ email: e })),
      };
      if (message.cc && message.cc.length) {
        personalizations.cc = message.cc.map(e => ({ email: e }));
      }
      if (message.bcc && message.bcc.length) {
        personalizations.bcc = message.bcc.map(e => ({ email: e }));
      }

      const payload = {
        personalizations: [personalizations],
        from: { email: senderEmail, ...(senderName ? { name: senderName } : {}) },
        subject: cleanSubject,
        content: [
          {
            type: isHtml ? 'text/html' : 'text/plain',
            value: message.body,
          },
        ],
      };

      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errDesc = `SendGrid API Error ${res.status}: ${res.statusText}`;
        try {
          const errJson: any = await res.json();
          if (errJson.errors && Array.isArray(errJson.errors)) {
            errDesc = errJson.errors.map((e: any) => e.message).join(', ');
          }
        } catch (_) {}
        throw new Error(errDesc);
      }

      return { success: true };
    }

    case 'mailgun': {
      const apiKey = creds.api_key;
      const domain = creds.domain;
      const region = creds.region || 'us';
      if (!apiKey || !domain) throw new Error('Missing Mailgun API Key or Domain');
      if (!/^[a-zA-Z0-9.-]+$/.test(domain)) {
        throw new Error('Invalid Mailgun domain format');
      }

      const host = region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
      const endpoint = `https://${host}/v3/${encodeURIComponent(domain)}/messages`;

      const formData = new FormData();
      formData.append('from', senderName ? `${senderName} <${senderEmail}>` : senderEmail);
      message.to.forEach(r => formData.append('to', r));
      if (message.cc) message.cc.forEach(r => formData.append('cc', r));
      if (message.bcc) message.bcc.forEach(r => formData.append('bcc', r));
      formData.append('subject', cleanSubject);
      if (isHtml) {
        formData.append('html', message.body);
      } else {
        formData.append('text', message.body);
      }

      const basicAuth = btoa(`api:${apiKey}`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
        },
        body: formData,
      });

      const resBody: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(resBody.message || `Mailgun API Error ${res.status}: ${res.statusText}`);
      }

      return { success: true, messageId: resBody.id };
    }

    case 'postmark': {
      const serverToken = creds.server_token;
      if (!serverToken) throw new Error('Missing Postmark Server Token');

      const payload = {
        From: senderName ? `${senderName} <${senderEmail}>` : senderEmail,
        To: message.to.join(', '),
        Cc: message.cc && message.cc.length ? message.cc.join(', ') : undefined,
        Bcc: message.bcc && message.bcc.length ? message.bcc.join(', ') : undefined,
        Subject: cleanSubject,
        HtmlBody: isHtml ? message.body : undefined,
        TextBody: isHtml ? undefined : message.body,
      };

      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': serverToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const resBody: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(resBody.Message || `Postmark API Error ${res.status}: ${res.statusText}`);
      }

      return { success: true, messageId: resBody.MessageID };
    }

    default:
      throw new Error(`Unsupported provider type "${provider.type}"`);
  }
}
