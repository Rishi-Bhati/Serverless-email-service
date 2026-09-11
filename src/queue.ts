import { WorkerMailer } from 'worker-mailer';
import {
  getActiveProviders,
  getProviderById,
  getActiveProviderByEmail,
  sendEmailViaProvider,
  incrementProviderDailySent,
  type ProviderRecord,
  type EmailMessage,
} from './providers';

export interface Env {
  DB: D1Database;
  API_KEY: string;
  API_SECRET: string;         // HMAC signing secret — configure on both server and client, never transmit
  SECURITY_MODE?: string;     // 'api-key-only' | 'signed' | 'full'  (default: 'full')
  NONCE_TTL_SECONDS?: string; // How long to keep used nonces in D1 (default: '300' = 5 minutes)
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_STARTTLS?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM_EMAIL?: string;
  SMTP_FROM_NAME?: string;
  SMTP_THROTTLE_DELAY_MS?: string;
  MAX_CONCURRENT_WORKERS?: string;
  SMTP_AUTH_TYPE?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  DASHBOARD_USERNAME?: string;
  DASHBOARD_PASSWORD?: string;
}

export interface EmailRow {
  id: number;
  to_json: string;
  cc_json: string | null;
  bcc_json: string | null;
  subject: string;
  body: string;
  status: string;
  attempts: number;
  error: string | null;
  from_email?: string | null;
  from_name?: string | null;
  provider_id?: string | null;
  provider_used?: string | null;
  failover_history?: string | null;
  created_at: number;
  updated_at: number;
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

    // Reset stuck emails with < 3 attempts back to queued (increment attempts to prevent poison-pill loops)
    await env.DB.prepare(`
      UPDATE emails
      SET status = 'queued', attempts = attempts + 1, updated_at = ?1
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

  if (activeCount >= allowedWorkers) {
    console.log(`Active workers (${activeCount}) >= allowed workers (${allowedWorkers}) for queue depth (${queuedCount}). Exiting.`);
    return;
  }

  console.log(`Starting queue processor. Active: ${activeCount}, Allowed: ${allowedWorkers}, Queued: ${queuedCount}`);

  let sharedSmtpMailer: any = null;
  let sharedSmtpMailerKey: string | null = null;
  let processedCount = 0;
  const MAX_PER_BATCH = 25;
  const batchStartTime = Date.now();

  try {
    while (processedCount < MAX_PER_BATCH) {
      processedCount++;
      const currentTimestamp = Date.now();
      // 3. Atomically acquire next email to process (with exponential backoff for failed retries)
      const emailRow = await env.DB.prepare(`
        UPDATE emails
        SET status = 'sending', updated_at = ?1
        WHERE id = (
          SELECT id FROM emails
          WHERE status = 'queued' OR (status = 'failed' AND attempts < 3 AND updated_at < (?1 - (attempts * 30000)))
          ORDER BY created_at ASC
          LIMIT 1
        )
        RETURNING *
      `).bind(currentTimestamp).first<EmailRow>();

      if (!emailRow) {
        console.log('Queue empty or all eligible emails processed.');
        break;
      }

      console.log(`Processing email ID: ${emailRow.id}`);

      // 4. Parse recipients
      let to: string[];
      let cc: string[] | undefined;
      let bcc: string[] | undefined;

      try {
        to = JSON.parse(emailRow.to_json);
        cc = emailRow.cc_json ? JSON.parse(emailRow.cc_json) : undefined;
        bcc = emailRow.bcc_json ? JSON.parse(emailRow.bcc_json) : undefined;
      } catch (parseErr) {
        console.error(`Invalid JSON recipients for email ID ${emailRow.id}:`, parseErr);
        await env.DB.prepare(`
          UPDATE emails
          SET status = 'failed', error = 'Failed to parse recipient JSON', attempts = attempts + 1, updated_at = ?1
          WHERE id = ?2
        `).bind(Date.now(), emailRow.id).run();
        continue;
      }

      const emailMessage: EmailMessage = {
        to,
        cc,
        bcc,
        subject: emailRow.subject,
        body: emailRow.body,
        fromEmail: emailRow.from_email || undefined,
        fromName: emailRow.from_name || undefined,
      };

      // 5. Determine candidate providers
      let candidateProviders: ProviderRecord[] = [];
      const activeProviders = await getActiveProviders(env.DB).catch(() => []);

      if (emailRow.provider_id) {
        // Explicit provider ID was requested
        const explicitProvider = await getProviderById(env.DB, emailRow.provider_id);
        if (explicitProvider && explicitProvider.is_active === 1) {
          candidateProviders = [explicitProvider];
        } else {
          const errMsg = `Explicitly requested provider "${emailRow.provider_id}" is inactive or not found`;
          await env.DB.prepare(`
            UPDATE emails
            SET status = 'failed', error = ?1, attempts = attempts + 1, updated_at = ?2
            WHERE id = ?3
          `).bind(errMsg, Date.now(), emailRow.id).run();
          continue;
        }
      } else if (emailRow.from_email) {
        // Explicit sender email requested: find all active providers configured for this email
        const matching = activeProviders.filter(
          p => p.from_email.toLowerCase() === emailRow.from_email!.toLowerCase()
        );
        if (matching.length > 0) {
          candidateProviders = matching;
        } else {
          // If no provider explicitly matches in D1, check if other active providers exist or fallback
          candidateProviders = activeProviders;
        }
      } else {
        // Default priority order: use active providers sorted by is_default DESC, priority ASC, id ASC
        candidateProviders = activeProviders;
      }

      // 6. Execute delivery with automatic priority failover
      let sendSuccess = false;
      let usedProviderName = '';
      let usedFromEmail = emailRow.from_email || '';
      let usedFromName = emailRow.from_name || '';

      let failoverHistory: Array<{ provider: string; type: string; error: string; timestamp: number }> = [];
      if (emailRow.failover_history) {
        try {
          failoverHistory = JSON.parse(emailRow.failover_history);
        } catch (_) {}
      }

      // Check if we have D1-configured providers
      if (candidateProviders.length > 0) {
        for (const provider of candidateProviders) {
          // Check daily limit quota
          if (provider.daily_limit > 0 && provider.daily_sent_count >= provider.daily_limit) {
            console.log(`Provider "${provider.name}" reached daily limit (${provider.daily_sent_count}/${provider.daily_limit}). Skipping.`);
            failoverHistory.push({
              provider: provider.name,
              type: provider.type,
              error: `Daily limit reached (${provider.daily_sent_count}/${provider.daily_limit} sent today)`,
              timestamp: Date.now(),
            });
            continue;
          }

          try {
            console.log(`Attempting send for email ${emailRow.id} via provider "${provider.name}" (${provider.type}, Priority ${provider.priority})...`);

            const mailerToPass = (provider.type === 'smtp' && sharedSmtpMailerKey === provider.id) ? sharedSmtpMailer : null;
            if (provider.type === 'smtp' && sharedSmtpMailer && sharedSmtpMailerKey !== provider.id) {
              try { await sharedSmtpMailer.close(); } catch (_) {}
              sharedSmtpMailer = null;
              sharedSmtpMailerKey = null;
            }
            const result = await sendEmailViaProvider(provider, emailMessage, mailerToPass, env.API_SECRET);
            if (provider.type === 'smtp' && result.mailerInstance) {
              sharedSmtpMailer = result.mailerInstance;
              sharedSmtpMailerKey = provider.id;
            }

            // Success!
            sendSuccess = true;
            usedProviderName = `${provider.name} (${provider.type})`;
            usedFromEmail = emailRow.from_email || provider.from_email;
            usedFromName = emailRow.from_name || provider.from_name || '';

            provider.daily_sent_count++;
            await incrementProviderDailySent(env.DB, provider.id);
            console.log(`Email ID ${emailRow.id} sent successfully via "${provider.name}".`);
            break;
          } catch (sendErr: any) {
            const errText = sendErr.message || String(sendErr);
            console.error(`Provider "${provider.name}" failed for email ${emailRow.id}:`, errText);

            failoverHistory.push({
              provider: provider.name,
              type: provider.type,
              error: errText,
              timestamp: Date.now(),
            });

            // If SMTP failure, reset shared connection
            if (provider.type === 'smtp' && sharedSmtpMailer) {
              try { await sharedSmtpMailer.close(); } catch (_) {}
              sharedSmtpMailer = null;
              sharedSmtpMailerKey = null;
            }
          }
        }
      }

      // 7. Fallback to legacy environment variables if D1 providers failed or none configured
      if (!sendSuccess && env.SMTP_HOST && env.SMTP_USERNAME && env.SMTP_PASSWORD) {
        try {
          console.log(`Using fallback environment SMTP settings for email ${emailRow.id}...`);
          if (!sharedSmtpMailer || sharedSmtpMailerKey !== '__env__') {
            if (sharedSmtpMailer) { try { await sharedSmtpMailer.close(); } catch (_) {} }
            sharedSmtpMailer = await WorkerMailer.connect({
              host: env.SMTP_HOST,
              port: parseInt(env.SMTP_PORT || '587', 10),
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
            sharedSmtpMailerKey = '__env__';
          }

          const fallbackFromEmail = emailRow.from_email || env.SMTP_FROM_EMAIL || env.SMTP_USERNAME;
          const fallbackFromName = emailRow.from_name || env.SMTP_FROM_NAME || '';
          const isHtml = emailRow.body.trim().startsWith('<') || emailRow.body.toLowerCase().includes('html');

          await sharedSmtpMailer.send({
            from: { name: fallbackFromName, email: fallbackFromEmail },
            to,
            cc,
            bcc,
            subject: emailRow.subject,
            text: isHtml ? undefined : emailRow.body,
            html: isHtml ? emailRow.body : undefined,
          });

          sendSuccess = true;
          usedProviderName = 'Default Env SMTP';
          usedFromEmail = fallbackFromEmail;
          usedFromName = fallbackFromName;
        } catch (envErr: any) {
          const errText = envErr.message || String(envErr);
          console.error(`Env SMTP failed for email ${emailRow.id}:`, errText);
          failoverHistory.push({
            provider: 'Env SMTP',
            type: 'smtp',
            error: errText,
            timestamp: Date.now(),
          });
          if (sharedSmtpMailer) {
            try { await sharedSmtpMailer.close(); } catch (_) {}
            sharedSmtpMailer = null;
          }
        }
      } else if (!sendSuccess) {
        failoverHistory.push({
          provider: 'None',
          type: 'none',
          error: 'No email providers configured in D1 database or environment variables.',
          timestamp: Date.now(),
        });
      }

      // 8. Update email status in D1
      if (sendSuccess) {
        await env.DB.prepare(`
          UPDATE emails
          SET status = 'sent',
              provider_used = ?1,
              from_email = ?2,
              from_name = ?3,
              failover_history = ?4,
              error = NULL,
              updated_at = ?5
          WHERE id = ?6
        `).bind(
          usedProviderName,
          usedFromEmail,
          usedFromName,
          failoverHistory.length > 0 ? JSON.stringify(failoverHistory) : null,
          Date.now(),
          emailRow.id
        ).run();
      } else {
        const errorSummary = failoverHistory.length > 0
          ? failoverHistory.map(f => `[${f.provider}]: ${f.error}`).join(' | ')
          : 'All providers failed or daily quota exhausted';

        await env.DB.prepare(`
          UPDATE emails
          SET status = 'failed',
              error = ?1,
              failover_history = ?2,
              attempts = attempts + 1,
              updated_at = ?3
          WHERE id = ?4
        `).bind(
          errorSummary,
          JSON.stringify(failoverHistory),
          Date.now(),
          emailRow.id
        ).run();
      }

      // 9. Throttle delay & wall-clock budget protection (prevent Cloudflare 30s isolate kill)
      if (Date.now() - batchStartTime > 20000) {
        console.log('Batch execution reached 20s wall-clock threshold; yielding to subsequent invocation.');
        break;
      }
      const throttleDelay = parseInt(env.SMTP_THROTTLE_DELAY_MS || '250', 10);
      if (throttleDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(throttleDelay, 500)));
      }
    }
  } finally {
    // 10. Clean SMTP connection
    if (sharedSmtpMailer) {
      try {
        console.log('Closing shared SMTP connection.');
        await sharedSmtpMailer.close();
      } catch (closeErr) {
        console.error('Error closing SMTP connection:', closeErr);
      }
    }
  }
}
