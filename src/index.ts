import { Env, processQueue } from './queue';
import { renderDashboard } from './dashboard';

// Helper to parse recipients into normalized JSON string for D1 storage
function parseRecipient(field: any): string {
  if (!field) return '[]';
  if (Array.isArray(field)) {
    // Check if empty array
    return JSON.stringify(field);
  }
  if (typeof field === 'object') {
    return JSON.stringify(field);
  }
  if (typeof field === 'string') {
    const list = field.split(',').map(s => s.trim()).filter(Boolean);
    return JSON.stringify(list);
  }
  throw new Error('Invalid recipient format');
}

// Authentication check
function isAuthorized(request: Request, env: Env): boolean {
  if (!env.API_KEY) {
    console.error('API_KEY is not configured in Worker secrets.');
    return false;
  }
  
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.substring(7).trim() 
    : authHeader.trim();
    
  return token === env.API_KEY;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Route: Render Dashboard UI (Publicly accessible page, but API queries require Key)
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(renderDashboard(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // 2. Auth Guard for all API endpoints
    if (url.pathname.startsWith('/api/')) {
      if (!isAuthorized(request, env)) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or missing API Key' }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }
    }

    // 3. Route: POST /api/send - Queue an email
    if (url.pathname === '/api/send' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        
        // Basic validation
        if (!body.to || (typeof body.to === 'string' && !body.to.trim())) {
          return new Response(JSON.stringify({ error: 'Missing recipient "to" field' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        if (!body.subject) {
          return new Response(JSON.stringify({ error: 'Missing "subject" field' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        if (!body.body) {
          return new Response(JSON.stringify({ error: 'Missing "body" field' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const toJSON = parseRecipient(body.to);
        const ccJSON = body.cc ? parseRecipient(body.cc) : null;
        const bccJSON = body.bcc ? parseRecipient(body.bcc) : null;

        // Insert into D1 database
        const insertResult = await env.DB.prepare(`
          INSERT INTO emails (to_json, cc_json, bcc_json, subject, body, status, attempts, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, 'queued', 0, ?6, ?7)
          RETURNING id
        `).bind(
          toJSON,
          ccJSON,
          bccJSON,
          body.subject,
          body.body,
          Date.now(),
          Date.now()
        ).first<{ id: number }>();

        if (!insertResult) {
          throw new Error('Failed to insert email into D1 database');
        }

        // Trigger queue processor asynchronously using ctx.waitUntil
        ctx.waitUntil(processQueue(env));

        return new Response(JSON.stringify({ 
          success: true, 
          id: insertResult.id,
          message: 'Email successfully queued for sending' 
        }), {
          status: 202, // Accepted
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || String(err) }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 4. Route: GET /api/status - Get queue statistics
    if (url.pathname === '/api/status' && request.method === 'GET') {
      try {
        const stats = await env.DB.prepare(`
          SELECT status, COUNT(*) as count 
          FROM emails 
          GROUP BY status
        `).all<{ status: string; count: number }>();

        const result = { queued: 0, sending: 0, sent: 0, failed: 0 };
        stats.results.forEach(row => {
          if (row.status in result) {
            result[row.status as keyof typeof result] = row.count;
          }
        });

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 5. Route: GET /api/logs - Retrieve recent dispatch logs
    if (url.pathname === '/api/logs' && request.method === 'GET') {
      try {
        const logs = await env.DB.prepare(`
          SELECT id, to_json, subject, status, attempts, error, updated_at 
          FROM emails 
          ORDER BY updated_at DESC 
          LIMIT 100
        `).all();

        return new Response(JSON.stringify(logs.results), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message || String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // Catch all 404
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  },

  // 6. Cron trigger entrypoint
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Cron trigger activated. Running queue processor...');
    ctx.waitUntil(processQueue(env));
  }
};
