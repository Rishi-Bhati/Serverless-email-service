# Serverless SMTP Email Queue Service

A high-performance, completely serverless, and free email queue service designed to be hosted on **Cloudflare Workers** and **Cloudflare D1** (SQLite database). 

It allows you to use your own SMTP credentials (such as Gmail, Amazon SES, SendGrid, etc.) as an API, with built-in protection against overloading your SMTP server, automated serial queue processing, and a gorgeous web admin dashboard to monitor everything in real time.

[![Report Issues Here](https://img.shields.io/badge/Report-Issues%20Here-orange?style=for-the-badge)](https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/)

---

## 🌟 Key Features

* **Zero Hosting Cost**: Runs entirely on Cloudflare's Free Tier (100k free Worker requests/day, 100k free D1 Database writes/day, 5 million free D1 reads/day).
* **SMTP Connection Reuse**: Connects to the SMTP server once per worker loop and sends multiple emails, dramatically reducing connection handshake overhead and memory usage.
* **Dynamic Concurrency Scaling**: Automatically adjusts the number of concurrent senders based on the queue depth:
  * `< 10` emails: runs 1 worker (strict one-by-one serialization).
  * `10 - 50` emails: runs up to 3 concurrent workers.
  * `> 50` emails: runs up to 5 concurrent workers.
* **Atomic Locking**: Uses SQLite's native `UPDATE ... RETURNING` statements to ensure that multiple concurrent workers never pick up or send the same email twice.
* **Self-Healing Queue**: Includes automated cron fallback triggers and self-healing cleanup tasks to recover any emails stuck in a `sending` state if a worker times out.
* **Sleek Admin Dashboard**: A premium dark-mode SPA served directly on your Worker root URL (`/`) to monitor logs, check queue counts, and send test emails interactively.
* **Hardened HMAC Request Signing**: Optional cryptographic validation chain (HMAC-SHA256 + nonce + timestamp) to defend against replay attacks, request tampering, and old captures.

---

## 🚀 Setup & Deployment Guide

Follow these steps to deploy your own instance of the Serverless Mail Service on Cloudflare.

### Prerequisites

* Node.js (version 18 or higher)
* A Cloudflare account (Free Tier is perfect)
* SMTP credentials (e.g. Gmail App Password, AWS SES SMTP keys, etc.)

---

### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/your-username/Serverless-email-service.git
cd Serverless-email-service
npm install
```

### Step 2: Login to Cloudflare

Authenticate your local terminal with your Cloudflare account using Wrangler:

```bash
npx wrangler login
```

### Step 3: Create your D1 Database

Run the wrangler command to provision a free SQLite database in your Cloudflare account:

```bash
npx wrangler d1 create reportary-email-db
```

This command will output code similar to the following:
```toml
[[d1_databases]]
binding = "DB"
database_name = "reportary-email-db"
database_id = "your-database-uuid-here"
```

### Step 4: Configure `wrangler.toml`

Open the `wrangler.toml` file in your root folder and replace the `database_id` value with the UUID returned from the previous step:

```toml
name = "reportary-email-service"
main = "src/index.ts"
compatibility_date = "2024-05-29"
compatibility_flags = [ "nodejs_compat" ]

[[d1_databases]]
binding = "DB"
database_name = "reportary-email-db"
database_id = "your-database-uuid-here"  # Paste your UUID here

[triggers]
crons = [ "* * * * *" ] # Every 1 minute queue processing fallback
```

### Step 5: Run Database Migrations

Apply the database schema to your local development environment and remote Cloudflare database:

```bash
# Create local D1 database tables
npm run db:migrate:local

# Create remote production database tables
npm run db:migrate:prod
```

### Step 6: Set up environment secrets

1. Copy the `.env` file containing configuration parameters.
2. Open the `.env` file and replace the placeholder values with your real credentials:
   - **`API_KEY`**: Create a custom API key (sent in request headers) to identify your client.
   - **`API_SECRET`**: A private signing secret (configured on both sides, never sent over the network) for HMAC calculations.
   - **`SECURITY_MODE`**: Level of validation to enforce (`api-key-only` | `signed` | `full`). Defaults to `full`.
   - **`SMTP_HOST` & `SMTP_PORT`**: SMTP endpoint details (e.g. `smtp.gmail.com` and `587`).
   - **`SMTP_SECURE`**: Set to `true` if connecting on port 465 (SSL/TLS direct), or `false` on port 587 (STARTTLS).
   - **`SMTP_USERNAME` & `SMTP_PASSWORD`**: Your SMTP credentials.
   - **`SMTP_FROM_EMAIL`**: The default email address associated with your SMTP sender account.
3. Save the `.env` file.
4. Upload these secrets securely to Cloudflare:
   ```bash
   npm run secrets:deploy -- --prod
   ```
   *(This script will also write `.dev.vars` locally so you can run the app in dev mode using `npm run dev`)*

### Step 7: Deploy to Cloudflare Edge

Deploy the worker codebase and the cron trigger to production:

```bash
npm run deploy
```

Once successful, the console will output your live URL:
`https://reportary-email-service.[your-subdomain].workers.dev`

---

## 🔒 Security Levels

You can adjust the validation strictness using the `SECURITY_MODE` secret:

| Security Level | Header Checks | Replay Prevention | Tamper Protection |
|---|---|---|---|
| `api-key-only` | `X-API-Key` | ✗ No | ✗ No |
| `signed` | `X-API-Key`, `X-Timestamp`, `X-Signature` | ✗ No (within 3m window) | ✓ Yes (HMAC body hash) |
| `full` (default) | `X-API-Key`, `X-Timestamp`, `X-Nonce`, `X-Signature` | ✓ Yes (nonce check in D1) | ✓ Yes (HMAC body hash) |

---

## 📬 API Documentation

Depending on the `SECURITY_MODE` enabled, you will need to construct and sign your requests before sending them to `POST /api/send`.

### Request Headers

* `X-API-Key` *(Required in all modes)*: Your API key string.
* `X-Timestamp` *(Required in signed & full)*: Current Unix epoch timestamp in seconds. Must be within ±3 minutes of server time.
* `X-Nonce` *(Required in full)*: Unique string per request (e.g. UUID). The server checks D1 to ensure this nonce hasn't been used before.
* `X-Signature` *(Required in signed & full)*: The computed HMAC-SHA256 hex string.

---

### Request Signing Guide

To compute the `X-Signature` hash:

1. **Calculate the SHA-256 hash** of the raw JSON request body bytes:
   ```
   body_hash = SHA256(raw_request_body)  # represented as hex
   ```
2. **Build the canonical message** by joining parts with a literal newline (`\n`) character:
   ```
   canonical_message = timestamp + "\n" + nonce + "\n" + body_hash
   ```
   *(Note: in `signed` mode, the nonce is empty, so there will be two consecutive newlines between timestamp and body hash)*
3. **Compute the HMAC-SHA256 signature** using your private `API_SECRET` as the key:
   ```
   signature = HMAC_SHA256(API_SECRET, canonical_message)  # represented as hex
   ```

---

### Code Examples

#### cURL / Bash (`full` mode)
```bash
API_KEY="rpt_your_api_key"
API_SECRET="your_api_secret"

BODY='{"to":"user@example.com","subject":"Hello","body":"<h1>Hi!</h1>"}'
TIMESTAMP=$(date +%s)
NONCE=$(uuidgen)

# 1. Body hash
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 | awk '{print $2}')

# 2. Canonical message
MESSAGE="$TIMESTAMP
$NONCE
$BODY_HASH"

# 3. Signature
SIGNATURE=$(printf '%s' "$MESSAGE" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

curl -X POST https://reportary-email-service.[your-subdomain].workers.dev/api/send \
  -H "X-API-Key: $API_KEY" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Nonce: $NONCE" \
  -H "X-Signature: $SIGNATURE" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

#### JavaScript (`full` mode)
```javascript
async function sendSignedEmail(apiKey, apiSecret, payload) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();

  // 1. Hash body
  const bodyBytes = new TextEncoder().encode(body);
  const hashBuf = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  // 2. Canonical message
  const message = `${timestamp}\n${nonce}\n${bodyHash}`;

  // 3. HMAC-SHA256
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  return fetch('https://reportary-email-service.[your-subdomain].workers.dev/api/send', {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Signature': signature,
      'Content-Type': 'application/json'
    },
    body
  });
}
```

---

## 🖥️ Web Admin Dashboard

You can access the visual dashboard directly from the root URL of your deployed Worker:
`https://reportary-email-service.[your-subdomain].workers.dev`

1. Select your configured **Security Mode**.
2. Enter your **API Key** (and **API Secret** if running in signed/full modes).
3. Check real-time queue states, review dispatch history, inspect failure logs, and send signed test emails directly from the browser!

---

## ⚠️ Report Issues

If you run into any issues or errors while installing, configuring, or running this mail service, please report them here:

👉 **[Report Issues & Feedback Here](https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/)**
