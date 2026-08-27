import { Env, processQueue } from './queue';
import { renderDashboard } from './dashboard';
import { verifyRequest, verifyApiKey, validateSenderAuthorization } from './auth';
import { encryptCredentials, decryptCredentials } from './crypto';
import {
  getAllProviders,
  getProviderById,
  sanitizeProvider,
  sendEmailViaProvider,
  getTodayUtc,
  ProviderRecord,
  ProviderType,
} from './providers';

// Helper to parse recipients into normalized JSON string for D1 storage
function parseRecipient(field: any): string {
  if (!field) return '[]';
  let list: string[] = [];
  if (Array.isArray(field)) {
    list = field.map(x => (typeof x === 'object' && x ? String(x.email || '') : String(x || '')));
  } else if (typeof field === 'object') {
    list = [String(field.email || '')];
  } else if (typeof field === 'string') {
    list = field.split(',');
  } else {
    throw new Error('Invalid recipient format');
  }

  const cleanList = list
    .map(s => s.replace(/[\r\n\0]/g, '').trim())
    .filter(Boolean);

  if (cleanList.length === 0) {
    throw new Error('No valid recipient addresses provided');
  }

  return JSON.stringify(cleanList);
}

// CORS headers — allow all security-related and multi-provider request headers
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, X-API-Key, X-Timestamp, X-Nonce, X-Signature, X-Sender-Email, X-Provider-Id',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Dashboard UI — publicly accessible
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(renderDashboard(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "frame-ancestors 'none'",
        },
      });
    }

    // 2. CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 3. POST /api/send — Queue an email for sending
    if (url.pathname === '/api/send' && request.method === 'POST') {
      try {
        const rawBody = await request.text();

        const authResult = await verifyRequest(request, rawBody, env);
        if (!authResult.ok) {
          return jsonResponse(
            { error: 'Unauthorized', reason: authResult.reason },
            401
          );
        }

        let body: any;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        // Validate basic fields
        if (!body.to || (typeof body.to === 'string' && !body.to.trim())) {
          return jsonResponse({ error: 'Missing recipient "to" field' }, 400);
        }
        if (!body.subject || (typeof body.subject === 'string' && !body.subject.trim())) {
          return jsonResponse({ error: 'Missing "subject" field' }, 400);
        }

        // Sanitize subject against CRLF header injection and limit length
        const cleanSubject = String(body.subject).replace(/[\r\n\0]+/g, ' ').trim().slice(0, 1000);
        if (!cleanSubject) {
          return jsonResponse({ error: 'Invalid or empty "subject" field' }, 400);
        }

        // Accept both 'html' (advertised in docs) and 'body' (legacy) field names
        const htmlBody: string | undefined = body.html || body.body;
        if (!htmlBody || (typeof htmlBody === 'string' && !htmlBody.trim())) {
          return jsonResponse({ error: 'Missing "html" (or "body") field' }, 400);
        }

        // Determine sender email & name
        let senderEmail: string | undefined = authResult.explicitSenderEmail;
        let senderName: string | undefined;

        if (body.from) {
          if (typeof body.from === 'object') {
            senderEmail = senderEmail || body.from.email;
            senderName = body.from.name;
          } else if (typeof body.from === 'string') {
            senderEmail = senderEmail || body.from;
          }
        }
        if (body.from_email) senderEmail = senderEmail || body.from_email;
        if (body.from_name) senderName = senderName || body.from_name;

        // Sanitize sender fields against CRLF injection
        if (senderName) {
          senderName = String(senderName).replace(/[\r\n\0]+/g, ' ').trim().slice(0, 200);
        }
        if (senderEmail) {
          senderEmail = String(senderEmail).replace(/[\r\n\0\s]+/g, '').trim().slice(0, 254);
        }

        const explicitProviderId = authResult.explicitProviderId || body.provider_id || undefined;

        // Security check: validate that explicit sender or provider is authorized
        const senderAuth = await validateSenderAuthorization(env, senderEmail, explicitProviderId);
        if (!senderAuth.ok) {
          return jsonResponse(
            { error: 'Unauthorized Sender/Provider', reason: senderAuth.reason },
            400
          );
        }

        const hasCc = body.cc && (!Array.isArray(body.cc) || body.cc.length > 0) && (typeof body.cc !== 'string' || body.cc.trim());
        const hasBcc = body.bcc && (!Array.isArray(body.bcc) || body.bcc.length > 0) && (typeof body.bcc !== 'string' || body.bcc.trim());
        const toJSON  = parseRecipient(body.to);
        const ccJSON  = hasCc ? parseRecipient(body.cc) : null;
        const bccJSON = hasBcc ? parseRecipient(body.bcc) : null;

        const insertResult = await env.DB.prepare(`
          INSERT INTO emails (
            to_json, cc_json, bcc_json, subject, body,
            from_email, from_name, provider_id, status,
            attempts, created_at, updated_at
          )
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', 0, ?9, ?10)
          RETURNING id
        `)
          .bind(
            toJSON,
            ccJSON,
            bccJSON,
            cleanSubject,
            htmlBody,
            senderEmail || null,
            senderName || null,
            explicitProviderId || null,
            Date.now(),
            Date.now()
          )
          .first<{ id: number }>();

        if (!insertResult) {
          throw new Error('Failed to insert email into D1 database');
        }

        ctx.waitUntil(processQueue(env));

        return jsonResponse(
          {
            success: true,
            id: insertResult.id,
            message: 'Email successfully queued for sending',
            targetProvider: explicitProviderId || (senderAuth.provider ? senderAuth.provider.name : 'Automatic Priority / Default'),
          },
          202
        );
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 400);
      }
    }

    // 4. Authenticate all other /api/* endpoints with API Key
    if (url.pathname.startsWith('/api/')) {
      const authorized = await verifyApiKey(request, env);
      if (!authorized) {
        return jsonResponse(
          { error: 'Unauthorized: Invalid or missing API Key' },
          401
        );
      }
    }

    // 5. GET /api/status — Queue statistics
    if (url.pathname === '/api/status' && request.method === 'GET') {
      try {
        const stats = await env.DB.prepare(
          'SELECT status, COUNT(*) as count FROM emails GROUP BY status'
        ).all<{ status: string; count: number }>();

        const result = { queued: 0, sending: 0, sent: 0, failed: 0 };
        stats.results.forEach(row => {
          if (row.status in result) {
            result[row.status as keyof typeof result] = row.count;
          }
        });

        return jsonResponse(result);
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 500);
      }
    }

    // 6. GET /api/logs & GET /api/emails — List emails with pagination, search, status & date filtering
    if ((url.pathname === '/api/logs' || url.pathname === '/api/emails') && request.method === 'GET') {
      try {
        const limitParam = url.searchParams.get('limit');
        const offsetParam = url.searchParams.get('offset');
        const statusParam = url.searchParams.get('status');
        const qParam = url.searchParams.get('q') || url.searchParams.get('search');
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const sortParam = url.searchParams.get('sort') || 'updated_at_desc';

        const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10))) : 100;
        const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : 0;

        let query = `SELECT id, to_json, cc_json, bcc_json, subject, body, from_email, from_name, provider_id, provider_used, failover_history, status, attempts, error, created_at, updated_at FROM emails`;
        const conditions: string[] = [];
        const bindings: any[] = [];

        if (statusParam && ['queued', 'sending', 'sent', 'failed'].includes(statusParam)) {
          conditions.push(`status = ?${bindings.length + 1}`);
          bindings.push(statusParam);
        }

        if (fromParam && fromParam.trim()) {
          const fromTs = Date.parse(fromParam.trim() + 'T00:00:00Z');
          if (!isNaN(fromTs)) {
            conditions.push(`created_at >= ?${bindings.length + 1}`);
            bindings.push(fromTs);
          }
        }

        if (toParam && toParam.trim()) {
          const toTs = Date.parse(toParam.trim() + 'T23:59:59.999Z');
          if (!isNaN(toTs)) {
            conditions.push(`created_at <= ?${bindings.length + 1}`);
            bindings.push(toTs);
          }
        }

        if (qParam && qParam.trim()) {
          const likeTerm = `%${qParam.trim()}%`;
          conditions.push(`(subject LIKE ?${bindings.length + 1} OR to_json LIKE ?${bindings.length + 1} OR from_email LIKE ?${bindings.length + 1} OR provider_used LIKE ?${bindings.length + 1} OR body LIKE ?${bindings.length + 1} OR error LIKE ?${bindings.length + 1})`);
          bindings.push(likeTerm);
        }

        if (conditions.length > 0) {
          query += ` WHERE ` + conditions.join(' AND ');
        }

        let orderBy = 'updated_at DESC';
        if (sortParam === 'updated_at_asc') orderBy = 'updated_at ASC';
        else if (sortParam === 'created_at_desc') orderBy = 'created_at DESC';
        else if (sortParam === 'created_at_asc') orderBy = 'created_at ASC';
        else if (sortParam === 'attempts_desc') orderBy = 'attempts DESC';

        query += ` ORDER BY ${orderBy}`;
        query += ` LIMIT ?${bindings.length + 1} OFFSET ?${bindings.length + 2}`;
        bindings.push(limit, offset);

        const logs = await env.DB.prepare(query).bind(...bindings).all();

        let countQuery = `SELECT COUNT(*) as total FROM emails`;
        if (conditions.length > 0) {
          countQuery += ` WHERE ` + conditions.join(' AND ');
        }
        const countBindings = bindings.slice(0, -2);
        const countResult = await env.DB.prepare(countQuery).bind(...countBindings).first<{ total: number }>();
        const total = countResult?.total || 0;

        const formatted = (logs.results || []).map((row: any) => {
          let to = [];
          let cc = undefined;
          let bcc = undefined;
          try { to = JSON.parse(row.to_json); } catch { to = [row.to_json]; }
          try { if (row.cc_json) cc = JSON.parse(row.cc_json); } catch {}
          try { if (row.bcc_json) bcc = JSON.parse(row.bcc_json); } catch {}
          return {
            ...row,
            to,
            cc,
            bcc,
            html_body: row.body,
            text_body: row.body,
            error_message: row.error,
          };
        });

        return jsonResponse({
          emails: formatted,
          results: formatted,
          total,
          limit,
          offset,
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 500);
      }
    }

    // Single email detail or deletion: /api/emails/:id or /api/logs/:id
    const emailIdMatch = url.pathname.match(/^\/api\/(?:emails|logs)\/(\d+)$/);
    if (emailIdMatch) {
      const emailId = parseInt(emailIdMatch[1], 10);
      if (request.method === 'GET') {
        const row = await env.DB.prepare('SELECT * FROM emails WHERE id = ?1').bind(emailId).first<any>();
        if (!row) return jsonResponse({ error: 'Email not found' }, 404);
        let to = [];
        try { to = JSON.parse(row.to_json); } catch { to = [row.to_json]; }
        let cc = null;
        if (row.cc_json) { try { cc = JSON.parse(row.cc_json); } catch { cc = [row.cc_json]; } }
        let bcc = null;
        if (row.bcc_json) { try { bcc = JSON.parse(row.bcc_json); } catch { bcc = [row.bcc_json]; } }
        return jsonResponse({
          email: {
            ...row,
            to,
            cc,
            bcc,
            html_body: row.body,
            text_body: row.body,
            error_message: row.error,
          },
        });
      }
      if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM emails WHERE id = ?1').bind(emailId).run();
        return jsonResponse({ success: true, message: `Email ${emailId} deleted` });
      }
    }

    // ── 7. Provider Management Endpoints ─────────────────────────────────────

    // GET /api/providers — List all configured providers
    if (url.pathname === '/api/providers' && request.method === 'GET') {
      try {
        const rawProviders = await getAllProviders(env.DB);
        const providers = await Promise.all(rawProviders.map(p => sanitizeProvider(p, env.API_SECRET)));
        return jsonResponse({ providers, count: providers.length });
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 500);
      }
    }

    // POST /api/providers — Add new provider
    if (url.pathname === '/api/providers' && request.method === 'POST') {
      try {
        const body: any = await request.json();

        if (!body.name || !body.type || !body.from_email || !body.credentials) {
          return jsonResponse(
            { error: 'Missing required fields: name, type, from_email, credentials' },
            400
          );
        }

        const validTypes: ProviderType[] = ['smtp', 'resend', 'sendgrid', 'mailgun', 'postmark'];
        if (!validTypes.includes(body.type)) {
          return jsonResponse(
            { error: `Invalid type "${body.type}". Supported: ${validTypes.join(', ')}` },
            400
          );
        }

        const id = (body.id || `${body.type}_${Date.now()}`).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const existing = await getProviderById(env.DB, id);
        if (existing) {
          return jsonResponse({ error: `Provider ID "${id}" already exists.` }, 400);
        }

        const priority = parseInt(String(body.priority || 1), 10);
        const isDefault = body.is_default ? 1 : 0;
        const dailyLimit = parseInt(String(body.daily_limit || 0), 10);
        const isActive = body.is_active !== false && body.is_active !== 0 ? 1 : 0;
        
        // Encrypt credentials JSON using AES-256-GCM before writing to D1 database
        const credsToEncrypt = typeof body.credentials === 'string' ? JSON.parse(body.credentials) : body.credentials;
        const credsJson = await encryptCredentials(credsToEncrypt, env.API_SECRET);
        
        const now = Date.now();
        const today = getTodayUtc();

        // If setting this as default, unset existing defaults
        if (isDefault === 1) {
          await env.DB.prepare('UPDATE providers SET is_default = 0 WHERE is_default = 1').run();
        }

        await env.DB.prepare(`
          INSERT INTO providers (
            id, name, type, credentials_json, from_email, from_name,
            priority, is_default, daily_limit, daily_sent_count, last_reset_date,
            is_active, created_at, updated_at
          )
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?13)
        `).bind(
          id,
          body.name.trim(),
          body.type,
          credsJson,
          body.from_email.trim(),
          body.from_name ? body.from_name.trim() : null,
          priority,
          isDefault,
          dailyLimit,
          today,
          isActive,
          now,
          now
        ).run();

        const created = await getProviderById(env.DB, id);
        return jsonResponse(
          { success: true, message: 'Provider created successfully', provider: created ? await sanitizeProvider(created, env.API_SECRET) : null },
          201
        );
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 400);
      }
    }

    // PUT /api/providers — Update provider
    if (url.pathname === '/api/providers' && request.method === 'PUT') {
      try {
        const body: any = await request.json();
        const id = body.id || url.searchParams.get('id');

        if (!id) {
          return jsonResponse({ error: 'Missing provider "id"' }, 400);
        }

        const existing = await getProviderById(env.DB, id);
        if (!existing) {
          return jsonResponse({ error: `Provider "${id}" not found` }, 404);
        }

        const validTypes: ProviderType[] = ['smtp', 'resend', 'sendgrid', 'mailgun', 'postmark'];
        if (body.type !== undefined && !validTypes.includes(body.type)) {
          return jsonResponse(
            { error: `Invalid type "${body.type}". Supported: ${validTypes.join(', ')}` },
            400
          );
        }

        const name = body.name !== undefined ? body.name.trim() : existing.name;
        const type = body.type !== undefined ? body.type : existing.type;
        const fromEmail = body.from_email !== undefined ? body.from_email.trim() : existing.from_email;
        const fromName = body.from_name !== undefined ? (body.from_name ? body.from_name.trim() : null) : existing.from_name;
        const priority = body.priority !== undefined ? parseInt(String(body.priority), 10) : existing.priority;
        const dailyLimit = body.daily_limit !== undefined ? parseInt(String(body.daily_limit), 10) : existing.daily_limit;
        const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
        const isDefault = body.is_default !== undefined ? (body.is_default ? 1 : 0) : existing.is_default;

        let credsJson = existing.credentials_json;
        if (body.credentials) {
          let oldCreds: any = {};
          try {
            oldCreds = await decryptCredentials(existing.credentials_json, env.API_SECRET);
          } catch (_) {}

          let newCreds: any = typeof body.credentials === 'string' ? JSON.parse(body.credentials) : body.credentials;
          if (newCreds.password === '••••••••' || newCreds.password === '') {
            newCreds.password = oldCreds.password;
          }
          if (typeof newCreds.api_key === 'string' && newCreds.api_key.includes('••••••••')) {
            newCreds.api_key = oldCreds.api_key;
          }
          if (typeof newCreds.server_token === 'string' && newCreds.server_token.includes('••••••••')) {
            newCreds.server_token = oldCreds.server_token;
          }

          const merged = { ...oldCreds, ...newCreds };
          credsJson = await encryptCredentials(merged, env.API_SECRET);
        }

        if (isDefault === 1 && existing.is_default !== 1) {
          await env.DB.prepare('UPDATE providers SET is_default = 0 WHERE is_default = 1').run();
        }

        await env.DB.prepare(`
          UPDATE providers
          SET name = ?1, type = ?2, credentials_json = ?3, from_email = ?4,
              from_name = ?5, priority = ?6, is_default = ?7, daily_limit = ?8,
              is_active = ?9, updated_at = ?10
          WHERE id = ?11
        `).bind(
          name,
          type,
          credsJson,
          fromEmail,
          fromName,
          priority,
          isDefault,
          dailyLimit,
          isActive,
          Date.now(),
          id
        ).run();

        const updated = await getProviderById(env.DB, id);
        return jsonResponse({
          success: true,
          message: 'Provider updated successfully',
          provider: updated ? await sanitizeProvider(updated, env.API_SECRET) : null,
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 400);
      }
    }

    // DELETE /api/providers — Delete provider
    if (url.pathname === '/api/providers' && request.method === 'DELETE') {
      try {
        const id = url.searchParams.get('id');
        if (!id) {
          return jsonResponse({ error: 'Missing "id" query parameter' }, 400);
        }

        const res = await env.DB.prepare('DELETE FROM providers WHERE id = ?1').bind(id).run();
        return jsonResponse({
          success: true,
          message: `Provider "${id}" deleted successfully`,
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 500);
      }
    }

    // POST /api/providers/set-default — Set default provider
    if (url.pathname === '/api/providers/set-default' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const id = body.id;
        if (!id) {
          return jsonResponse({ error: 'Missing provider "id"' }, 400);
        }

        const existing = await getProviderById(env.DB, id);
        if (!existing) {
          return jsonResponse({ error: `Provider "${id}" not found` }, 404);
        }
        if (existing.is_active !== 1) {
          return jsonResponse({ error: `Provider "${id}" is inactive. Cannot set as default.` }, 400);
        }

        await env.DB.prepare('UPDATE providers SET is_default = 0').run();
        await env.DB.prepare('UPDATE providers SET is_default = 1, updated_at = ?1 WHERE id = ?2')
          .bind(Date.now(), id).run();

        return jsonResponse({ success: true, message: `Provider "${id}" set as default.` });
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 400);
      }
    }

    // POST /api/providers/test — Test provider connectivity and dispatch
    if (url.pathname === '/api/providers/test' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const id = body.id || body.provider_id;
        const testTo = body.to || body.from_email || 'test@example.com';

        let provider: ProviderRecord | null = null;

        if (id) {
          provider = await getProviderById(env.DB, id);
        }

        if (!provider && body.type && body.credentials && body.from_email) {
          const validTypes: ProviderType[] = ['smtp', 'resend', 'sendgrid', 'mailgun', 'postmark'];
          if (!validTypes.includes(body.type)) {
            return jsonResponse({ error: `Invalid provider type "${body.type}". Supported: ${validTypes.join(', ')}` }, 400);
          }

          provider = {
            id: 'temp_test',
            name: body.name || 'Ad-hoc Test Provider',
            type: body.type,
            credentials_json: typeof body.credentials === 'string' ? body.credentials : JSON.stringify(body.credentials),
            from_email: body.from_email,
            from_name: body.from_name || 'ESET Mail Tester',
            priority: 1,
            is_default: 0,
            daily_limit: 0,
            daily_sent_count: 0,
            last_reset_date: getTodayUtc(),
            is_active: 1,
            created_at: Date.now(),
            updated_at: Date.now(),
          };
        }

        if (!provider) {
          return jsonResponse({ error: 'Provider not found or missing test credentials.' }, 400);
        }

        const testMsg = {
          to: [testTo],
          subject: `Test verification from ${provider.name} (${provider.type.toUpperCase()})`,
          body: `<h1>ESET Mail Provider Test</h1><p>Congratulations! Your email provider <b>${provider.name}</b> (${provider.type}) is configured correctly and working seamlessly.</p><p>Timestamp: ${new Date().toISOString()}</p>`,
          fromEmail: provider.from_email,
          fromName: provider.from_name || undefined,
        };

        const result = await sendEmailViaProvider(provider, testMsg, null, env.API_SECRET);
        return jsonResponse({
          success: true,
          message: `Test email sent successfully via "${provider.name}" (${provider.type}).`,
          messageId: result.messageId,
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 400);
      }
    }

    // Catch-all 404
    return jsonResponse({ error: 'Not Found' }, 404);
  },

  // 8. Cron trigger entrypoint
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Cron trigger activated. Running queue processor...');
    ctx.waitUntil(processQueue(env));
  },
};
