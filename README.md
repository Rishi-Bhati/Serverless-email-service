# Serverless SMTP Email Queue Service

A high-performance, completely serverless, and free email queue service designed to be hosted on **Cloudflare Workers** and **Cloudflare D1** (SQLite database). 

It allows you to use your own SMTP credentials (such as Gmail, Amazon SES, SendGrid, etc.) as an API, with built-in protection against overloading your SMTP server, automated serial queue processing, and a gorgeous web admin dashboard to monitor everything in real time.

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
* **Secured API**: Guarded by Bearer Token authorization to prevent unauthorized email dispatches.

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
   - **`API_KEY`**: Create a custom secret key (e.g. a long random string) to protect your API.
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

## 📬 API Documentation

All API requests must include the `Authorization` header containing your configured `API_KEY`.

### 1. Send / Queue Email
* **Endpoint**: `POST /api/send`
* **Headers**:
  * `Authorization: Bearer YOUR_API_KEY`
  * `Content-Type: application/json`
* **JSON Payload Parameters**:
  * `to` (Required): String (comma-separated list), array of strings, or recipient object array `[{"name": "Alice", "email": "alice@example.com"}]`.
  * `cc` (Optional): Same format as `to`.
  * `bcc` (Optional): Same format as `to`.
  * `subject` (Required): String.
  * `body` (Required): String (HTML templates and plain-text are both supported).

#### Example Request
```bash
curl -X POST https://reportary-email-service.[your-subdomain].workers.dev/api/send \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient1@example.com, recipient2@example.com",
    "cc": ["cc1@example.com"],
    "subject": "Cloudflare Edge Dispatch",
    "body": "<h1>Task Update</h1><p>Email has been sent successfully!</p>"
  }'
```

#### Response (202 Accepted)
```json
{
  "success": true,
  "id": 1,
  "message": "Email successfully queued for sending"
}
```

---

### 2. View Queue Statistics
* **Endpoint**: `GET /api/status`
* **Headers**: `Authorization: Bearer YOUR_API_KEY`
* **Response**:
  ```json
  {
    "queued": 0,
    "sending": 0,
    "sent": 14,
    "failed": 2
  }
  ```

---

## 🖥️ Web Admin Dashboard

You can access a beautiful visual dashboard directly from the root URL of your deployed Worker in any browser:
`https://reportary-email-service.[your-subdomain].workers.dev`

1. Open the page.
2. Enter your `API_KEY` in the overlay login box.
3. You will be able to check real-time queue states, review dispatch history, inspect last failure logs, and send test emails interactively!
