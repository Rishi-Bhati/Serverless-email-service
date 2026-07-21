import { WorkerMailer } from 'worker-mailer';

export interface Env {
  DB: D1Database;
  API_KEY: string;
  API_SECRET: string;         // HMAC signing secret — configure on both server and client, never transmit
  SECURITY_MODE?: string;     // 'api-key-only' | 'signed' | 'full'  (default: 'full')
  NONCE_TTL_SECONDS?: string; // How long to keep used nonces in D1 (default: '300' = 5 minutes)
  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_SECURE: string;
  SMTP_STARTTLS?: string;
  SMTP_USERNAME: string;
  SMTP_PASSWORD: string;
  SMTP_FROM_EMAIL: string;
  SMTP_FROM_NAME: string;
  SMTP_THROTTLE_DELAY_MS?: string;
  MAX_CONCURRENT_WORKERS?: string;
  SMTP_AUTH_TYPE?: string;
}

export async function processQueue(env: Env): Promise<void> {
  const now = Date.now();

  // 1. Self-healing cleanup: Reset emails stuck in 'sending' for more than 5 minutes
  try {
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    
    // Mark stuck emails with >= 3 attempts as failed
    await env.DB.prepare(`
      UPDATE emails
      SET status = 'failed', error = 'Worker timeout / stuck in sending state', attempts = attempts + 1, updated_at = ?1
      WHERE status = 'sending' AND updated_at < ?2 AND attempts >= 3
    `).bind(now, fiveMinutesAgo).run();

    // Reset stuck emails with < 3 attempts back to queued
    await env.DB.prepare(`
      UPDATE emails
      SET status = 'queued', updated_at = ?1
      WHERE status = 'sending' AND updated_at < ?2 AND attempts < 3
    `).bind(now, fiveMinutesAgo).run();
  } catch (err) {
    console.error('Failed to run stuck emails cleanup:', err);
  }

  // 2. Concurrency check based on queue depth
  let queuedCount = 0;
  let activeCount = 0;

  try {
    const queuedResult = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM emails WHERE status = 'queued'"
    ).first<{ count: number }>();
    queuedCount = queuedResult?.count || 0;

    const activeResult = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM emails WHERE status = 'sending' AND updated_at > ?1"
    ).bind(now - 30000).first<{ count: number }>();
    activeCount = activeResult?.count || 0;
  } catch (err) {
    console.error('Failed to check queue status:', err);
    return;
  }

  const userMaxWorkers = parseInt(env.MAX_CONCURRENT_WORKERS || '3', 10);
  let allowedWorkers = 1;

  if (queuedCount > 50) {
    allowedWorkers = Math.min(5, userMaxWorkers);
  } else if (queuedCount > 10) {
    allowedWorkers = Math.min(3, userMaxWorkers);
  } else {
    allowedWorkers = 1;
  }

  // If there are already enough active workers, exit early
  if (activeCount >= allowedWorkers) {
    console.log(`Active workers (${activeCount}) >= allowed workers (${allowedWorkers}) for queue depth (${queuedCount}). Exiting.`);
    return;
  }

  console.log(`Starting queue processor. Active: ${activeCount}, Allowed: ${allowedWorkers}, Queued: ${queuedCount}`);

  let mailer: any = null;

  try {
    while (true) {
      // 3. Atomically acquire the next email to process
      const emailRow = await env.DB.prepare(`
        UPDATE emails
        SET status = 'sending', updated_at = ?1
        WHERE id = (
          SELECT id FROM emails
          WHERE status = 'queued' OR (status = 'failed' AND attempts < 3)
          ORDER BY created_at ASC
          LIMIT 1
        )
        RETURNING *
      `).bind(Date.now()).first<{
        id: number;
        to_json: string;
        cc_json: string | null;
        bcc_json: string | null;
        subject: string;
        body: string;
        attempts: number;
      }>();

      if (!emailRow) {
        // No more emails to process
        console.log('Queue processed successfully or empty.');
        break;
      }

      console.log(`Processing email ID: ${emailRow.id}`);

      // 4. Parse recipients
      let to: any;
      let cc: any;
      let bcc: any;

      try {
        to = JSON.parse(emailRow.to_json);
        cc = emailRow.cc_json ? JSON.parse(emailRow.cc_json) : undefined;
        bcc = emailRow.bcc_json ? JSON.parse(emailRow.bcc_json) : undefined;
      } catch (parseErr) {
        console.error(`Invalid JSON in recipients for email ID ${emailRow.id}:`, parseErr);
        await env.DB.prepare(`
          UPDATE emails
          SET status = 'failed', error = 'Failed to parse recipient JSON', attempts = attempts + 1, updated_at = ?1
          WHERE id = ?2
        `).bind(Date.now(), emailRow.id).run();
        continue;
      }

      // 5. Connect to SMTP if not already connected
      if (!mailer) {
        try {
          console.log(`Connecting to SMTP server ${env.SMTP_HOST}:${env.SMTP_PORT}...`);
          mailer = await WorkerMailer.connect({
            host: env.SMTP_HOST,
            port: parseInt(env.SMTP_PORT, 10),
            secure: env.SMTP_SECURE === 'true',
            startTls: env.SMTP_STARTTLS !== 'false',
            credentials: {
              username: env.SMTP_USERNAME,
              password: env.SMTP_PASSWORD,
            },
            authType: (env.SMTP_AUTH_TYPE as any) || 'plain',
            socketTimeoutMs: 15000,
            responseTimeoutMs: 15000,
          });
          console.log('SMTP connection established.');
        } catch (connErr: any) {
          const errorMsg = connErr.message || String(connErr);
          console.error('SMTP connection failed:', errorMsg);

          // Mark email as failed and increment attempts
          await env.DB.prepare(`
            UPDATE emails
            SET status = 'failed', error = ?1, attempts = attempts + 1, updated_at = ?2
            WHERE id = ?3
          `).bind(`Connection error: ${errorMsg}`, Date.now(), emailRow.id).run();
          
          // Exit loop as we can't connect to the SMTP server right now
          break;
        }
      }

      // 6. Send the email
      try {
        console.log(`Sending email ID ${emailRow.id} to ${JSON.stringify(to)}`);
        
        // Auto-detect HTML vs text
        const isHtml = emailRow.body.trim().startsWith('<') || emailRow.body.toLowerCase().includes('html');
        
        await mailer.send({
          from: { name: env.SMTP_FROM_NAME, email: env.SMTP_FROM_EMAIL },
          to,
          cc,
          bcc,
          subject: emailRow.subject,
          text: isHtml ? undefined : emailRow.body,
          html: isHtml ? emailRow.body : undefined,
        });

        // Update status to 'sent'
        await env.DB.prepare(
          "UPDATE emails SET status = 'sent', updated_at = ?1 WHERE id = ?2"
        ).bind(Date.now(), emailRow.id).run();

        console.log(`Email ID ${emailRow.id} sent successfully.`);
      } catch (sendErr: any) {
        const errorMsg = sendErr.message || String(sendErr);
        console.error(`Failed to send email ID ${emailRow.id}:`, errorMsg);

        // Mark as failed and increment attempts
        await env.DB.prepare(`
          UPDATE emails
          SET status = 'failed', error = ?1, attempts = attempts + 1, updated_at = ?2
          WHERE id = ?3
        `).bind(errorMsg, Date.now(), emailRow.id).run();

        // Close the connection as it might be in a bad state
        try {
          await mailer.close();
        } catch (_) {}
        mailer = null;
      }

      // 7. Throttle delay before the next email
      const throttleDelay = parseInt(env.SMTP_THROTTLE_DELAY_MS || '1000', 10);
      if (throttleDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, throttleDelay));
      }
    }
  } finally {
    // 8. Clean connection closure
    if (mailer) {
      try {
        console.log('Closing SMTP connection.');
        await mailer.close();
      } catch (closeErr) {
        console.error('Error closing SMTP connection:', closeErr);
      }
    }
  }
}
