import { Env, processQueue } from './queue';
import { renderDashboard } from './dashboard';
import { verifyRequest, verifyApiKey } from './auth';

// Helper to parse recipients into normalized JSON string for D1 storage
function parseRecipient(field: any): string {
  if (!field) return '[]';
  if (Array.isArray(field)) return JSON.stringify(field);
  if (typeof field === 'object') return JSON.stringify(field);
  if (typeof field === 'string') {
    return JSON.stringify(field.split(',').map((s: string) => s.trim()).filter(Boolean));
  }
  throw new Error('Invalid recipient format');
}

// CORS headers — allow all security-related request headers
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, X-API-Key, X-Timestamp, X-Nonce, X-Signature',
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

    // 1. Dashboard UI — publicly accessible, no auth required
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(renderDashboard(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 2. CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 3. POST /api/send — Full security stack
    //    Body is read as text FIRST so we can pass the raw bytes to the
    //    signature verifier before JSON-parsing it.
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

        // Field validation
        if (!body.to || (typeof body.to === 'string' && !body.to.trim())) {
          return jsonResponse({ error: 'Missing recipient "to" field' }, 400);
        }
        if (!body.subject) {
          return jsonResponse({ error: 'Missing "subject" field' }, 400);
        }
        if (!body.body) {
          return jsonResponse({ error: 'Missing "body" field' }, 400);
        }

        const toJSON  = parseRecipient(body.to);
        const ccJSON  = body.cc  ? parseRecipient(body.cc)  : null;
        const bccJSON = body.bcc ? parseRecipient(body.bcc) : null;

        const insertResult = await env.DB.prepare(`
          INSERT INTO emails (to_json, cc_json, bcc_json, subject, body, status, attempts, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, 'queued', 0, ?6, ?7)
          RETURNING id
        `)
          .bind(toJSON, ccJSON, bccJSON, body.subject, body.body, Date.now(), Date.now())
          .first<{ id: number }>();

        if (!insertResult) {
          throw new Error('Failed to insert email into D1 database');
        }

        ctx.waitUntil(processQueue(env));

        return jsonResponse(
          { success: true, id: insertResult.id, message: 'Email successfully queued for sending' },
          202
        );
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 400);
      }
    }

    // 4. Read-only API endpoints — API key check only (no body to sign)
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

    // 6. GET /api/logs — Recent dispatch logs
    if (url.pathname === '/api/logs' && request.method === 'GET') {
      try {
        const logs = await env.DB.prepare(
          `SELECT id, to_json, subject, status, attempts, error, updated_at
           FROM emails
           ORDER BY updated_at DESC
           LIMIT 100`
        ).all();

        return jsonResponse(logs.results);
      } catch (err: any) {
        return jsonResponse({ error: err.message || String(err) }, 500);
      }
    }

    // Catch-all 404
    return jsonResponse({ error: 'Not Found' }, 404);
  },

  // 7. Cron trigger entrypoint
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Cron trigger activated. Running queue processor...');
    ctx.waitUntil(processQueue(env));
  },
};
