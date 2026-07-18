export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reportary Mail Edge - Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0b0f19;
      --bg-card: #151b2c;
      --border-color: #242f47;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --color-primary: #6366f1;
      --color-primary-glow: rgba(99, 102, 241, 0.15);
      --color-cyan: #06b6d4;
      --color-green: #10b981;
      --color-red: #ef4444;
      --color-orange: #f59e0b;
      --font-display: 'Outfit', sans-serif;
      --font-body: 'Plus Jakarta Sans', sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: var(--font-body);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.5;
    }

    /* Auth Overlay */
    #auth-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(11, 15, 25, 0.95);
      backdrop-filter: blur(10px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      transition: opacity 0.3s ease;
    }

    .auth-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), 0 0 50px var(--color-primary-glow);
      text-align: center;
    }

    .auth-card h2 {
      font-family: var(--font-display);
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #fff 0%, var(--text-muted) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .auth-card p {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 24px;
    }

    .input-group {
      margin-bottom: 20px;
      text-align: left;
    }

    .input-group label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
      color: var(--text-muted);
    }

    .input-field {
      width: 100%;
      background-color: rgba(11, 15, 25, 0.6);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px 16px;
      color: white;
      font-family: inherit;
      font-size: 14px;
      transition: all 0.2s ease;
    }

    .input-field:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 10px rgba(99, 102, 241, 0.3);
    }

    .btn {
      width: 100%;
      background: linear-gradient(135deg, var(--color-primary) 0%, #4f46e5 100%);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px;
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }

    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
    }

    /* Main Dashboard Layout */
    header {
      background-color: var(--bg-card);
      border-bottom: 1px solid var(--border-color);
      padding: 16px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .logo-container {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-badge {
      background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-cyan) 100%);
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 18px;
      color: white;
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.4);
    }

    .logo-text {
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .logo-text span {
      background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-cyan) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .status-pill {
      background-color: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: var(--color-green);
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      background-color: var(--color-green);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--color-green);
    }

    .logout-btn {
      background-color: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 8px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.2s ease;
    }

    .logout-btn:hover {
      border-color: var(--color-red);
      color: var(--color-red);
    }

    .report-issue-btn {
      background: linear-gradient(135deg, var(--color-orange) 0%, #d97706 100%);
      color: white !important;
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 13px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
    }

    .report-issue-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(245, 158, 11, 0.4);
      filter: brightness(1.1);
    }

    main {
      flex: 1;
      padding: 40px;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 32px;
    }

    /* Stats Section */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
    }

    .stat-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s ease, border-color 0.2s ease;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: rgba(99, 102, 241, 0.4);
    }

    .stat-label {
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }

    .stat-value {
      font-family: var(--font-display);
      font-size: 36px;
      font-weight: 700;
      line-height: 1;
    }

    .stat-indicator {
      width: 4px;
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
    }

    .stat-queued .stat-indicator { background-color: var(--color-cyan); }
    .stat-sending .stat-indicator { background-color: var(--color-orange); }
    .stat-sent .stat-indicator { background-color: var(--color-green); }
    .stat-failed .stat-indicator { background-color: var(--color-red); }

    /* Dashboard Layout Grid */
    .content-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 32px;
    }

    @media (min-width: 1024px) {
      .content-grid {
        grid-template-columns: 3fr 2fr;
      }
    }

    .panel {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 28px;
      display: flex;
      flex-direction: column;
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .panel-title {
      font-family: var(--font-display);
      font-size: 18px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Logs Table */
    .table-container {
      overflow-x: auto;
      min-height: 250px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    th {
      color: var(--text-muted);
      font-weight: 600;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
    }

    td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(36, 47, 71, 0.5);
      vertical-align: middle;
    }

    tr:last-child td {
      border-bottom: none;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      gap: 4px;
    }

    .badge-queued { background-color: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.2); color: var(--color-cyan); }
    .badge-sending { background-color: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2); color: var(--color-orange); }
    .badge-sent { background-color: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); color: var(--color-green); }
    .badge-failed { background-color: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--color-red); }

    .err-text {
      color: var(--color-red);
      font-size: 11px;
      font-family: monospace;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: help;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      padding: 60px 0;
      gap: 12px;
    }

    /* Test Form */
    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--text-muted);
    }

    .form-control {
      width: 100%;
      background-color: rgba(11, 15, 25, 0.4);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 10px 14px;
      color: white;
      font-family: inherit;
      font-size: 13px;
      transition: all 0.2s ease;
    }

    .form-control:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    textarea.form-control {
      min-height: 120px;
      resize: vertical;
    }

    .test-form-btn {
      margin-top: 8px;
    }

    /* Docs Panel */
    .docs-section {
      margin-top: 24px;
      border-top: 1px solid var(--border-color);
      padding-top: 24px;
    }

    .docs-title {
      font-family: var(--font-display);
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--color-cyan);
    }

    code {
      font-family: 'Courier New', Courier, monospace;
      background-color: rgba(11, 15, 25, 0.8);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 2px 6px;
      font-size: 12px;
      color: #fb7185;
    }

    pre {
      background-color: rgba(11, 15, 25, 0.8);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px;
      font-family: monospace;
      font-size: 12px;
      overflow-x: auto;
      color: #e2e8f0;
      position: relative;
    }

    .copy-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .copy-btn:hover {
      color: white;
      border-color: var(--color-primary);
    }

    footer {
      text-align: center;
      padding: 24px;
      color: var(--text-muted);
      font-size: 12px;
      border-top: 1px solid var(--border-color);
      margin-top: auto;
    }

    /* Refresh Button Animation */
    .rotate {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>

  <!-- Auth Screen -->
  <div id="auth-overlay">
    <div class="auth-card">
      <div class="logo-badge" style="margin: 0 auto 16px auto;">R</div>
      <h2>Authenticate API</h2>
      <p>Please enter your API Key configured in your Worker secrets to unlock the dashboard.</p>
      <div class="input-group">
        <label for="dashboard-api-key">API Key</label>
        <input type="password" id="dashboard-api-key" class="input-field" placeholder="Enter API Key...">
      </div>
      <button class="btn" onclick="saveApiKey()">Authenticate</button>
      <div id="auth-error" style="color: var(--color-red); font-size: 12px; margin-top: 12px; display: none;">
        Authentication failed. Please verify your API Key.
      </div>
    </div>
  </div>

  <!-- Header -->
  <header>
    <div class="logo-container">
      <div class="logo-badge">R</div>
      <div class="logo-text">Reportary <span>Mail Edge</span></div>
    </div>
    <div class="header-actions">
      <a href="https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/" target="_blank" class="report-issue-btn">
        <svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
        Report Issues
      </a>
      <div class="status-pill">
        <div class="status-dot"></div>
        <span>Edge Active</span>
      </div>
      <button class="logout-btn" onclick="logout()">Disconnect</button>
    </div>
  </header>

  <!-- Main Grid -->
  <main>
    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card stat-queued">
        <div class="stat-indicator"></div>
        <div class="stat-label">Queued</div>
        <div class="stat-value" id="stats-queued">0</div>
      </div>
      <div class="stat-card stat-sending">
        <div class="stat-indicator"></div>
        <div class="stat-label">Sending</div>
        <div class="stat-value" id="stats-sending">0</div>
      </div>
      <div class="stat-card stat-sent">
        <div class="stat-indicator"></div>
        <div class="stat-label">Sent</div>
        <div class="stat-value" id="stats-sent">0</div>
      </div>
      <div class="stat-card stat-failed">
        <div class="stat-indicator"></div>
        <div class="stat-label">Failed</div>
        <div class="stat-value" id="stats-failed">0</div>
      </div>
    </div>

    <!-- Contents Layout -->
    <div class="content-grid">
      <!-- Left Panel: Logs -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
            </svg>
            Recent Dispatch Logs
          </div>
          <button class="logout-btn" onclick="fetchDashboardData(this)">
            Refresh Queue
          </button>
        </div>
        <div class="table-container">
          <table id="logs-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Tries</th>
                <th>Last Update</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody id="logs-body">
              <tr>
                <td colspan="7" class="empty-state">Loading data...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right Panel: Send Test & Docs -->
      <div style="display: flex; flex-direction: column; gap: 32px;">
        <!-- Test Sender Panel -->
        <div class="panel">
          <div class="panel-title" style="margin-bottom: 20px;">
            <svg style="width: 18px; height: 18px; margin-right: 4px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
            </svg>
            Send Test Email
          </div>
          <form id="test-email-form" onsubmit="sendTestEmail(event)">
            <div class="form-group">
              <label for="test-to">To (comma separated or JSON array)</label>
              <input type="text" id="test-to" class="form-control" placeholder="recipient@example.com" required>
            </div>
            <div class="form-group">
              <label for="test-cc">CC (optional)</label>
              <input type="text" id="test-cc" class="form-control" placeholder="cc@example.com">
            </div>
            <div class="form-group">
              <label for="test-bcc">BCC (optional)</label>
              <input type="text" id="test-bcc" class="form-control" placeholder="bcc@example.com">
            </div>
            <div class="form-group">
              <label for="test-subject">Subject</label>
              <input type="text" id="test-subject" class="form-control" placeholder="Testing Reportary Mail Edge" required>
            </div>
            <div class="form-group">
              <label for="test-body">Body (HTML supported)</label>
              <textarea id="test-body" class="form-control" placeholder="<h1>Hello</h1><p>Testing my Cloudflare worker service.</p>" required></textarea>
            </div>
            <button type="submit" class="btn test-form-btn" id="send-test-btn">Enqueue Test Email</button>
            <div id="test-result" style="margin-top: 12px; font-size: 13px; font-weight: 500; display: none;"></div>
          </form>
        </div>

        <!-- API Documentation Panel -->
        <div class="panel">
          <div class="panel-title" style="margin-bottom: 12px;">
            <svg style="width: 18px; height: 18px; margin-right: 4px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
            </svg>
            API Integration
          </div>
          <div class="docs-section" style="border-top: none; padding-top: 0;">
            <div class="docs-title">Endpoint</div>
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">
              Queue an email with a <code>POST</code> request:
            </p>
            <code style="display: block; font-size: 12px; padding: 10px; margin-bottom: 16px;" id="endpoint-code">https://[your-worker].workers.dev/api/send</code>
            
            <div class="docs-title">Example payload</div>
            <pre><button class="copy-btn" onclick="copyText('json-payload')">Copy</button><code id="json-payload" style="background: none; border: none; padding: 0; color: #a5b4fc;">{
  "to": ["recipient@example.com"],
  "cc": [],
  "bcc": [],
  "subject": "System Report",
  "body": "&lt;h1&gt;Daily Update&lt;/h1&gt;&lt;p&gt;Success!&lt;/p&gt;"
}</code></pre>
          </div>
          <div class="docs-section">
            <div class="docs-title">cURL Command</div>
            <pre><button class="copy-btn" onclick="copyText('curl-code')">Copy</button><code id="curl-code" style="background: none; border: none; padding: 0; color: #a5b4fc;">curl -X POST https://[your-worker].workers.dev/api/send \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "user@example.com",
    "subject": "Hello",
    "body": "World"
  }'</code></pre>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer>
    &copy; 2026 Reportary. Running on Cloudflare Workers and D1 Serverless SQLite.
  </footer>

  <script>
    // Update API docs endpoint URL automatically based on hostname
    document.getElementById('endpoint-code').textContent = window.location.origin + '/api/send';
    document.getElementById('curl-code').textContent = \`curl -X POST \${window.location.origin}/api/send \\\\
  -H "Authorization: Bearer YOUR_API_KEY" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "to": "user@example.com",
    "subject": "Hello",
    "body": "World"
  }'\`;

    // Helper functions
    function getApiKey() {
      return localStorage.getItem('reportary_api_key');
    }

    function saveApiKey() {
      const keyField = document.getElementById('dashboard-api-key');
      const apiKey = keyField.value.trim();
      if (apiKey) {
        localStorage.setItem('reportary_api_key', apiKey);
        checkAuth();
      }
    }

    function logout() {
      localStorage.removeItem('reportary_api_key');
      document.getElementById('auth-overlay').style.display = 'flex';
    }

    function copyText(elementId) {
      const text = document.getElementById(elementId).textContent;
      navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
      });
    }

    async function checkAuth() {
      const key = getApiKey();
      if (!key) {
        document.getElementById('auth-overlay').style.display = 'flex';
        return;
      }

      // Hide auth overlay and attempt to load data
      document.getElementById('auth-overlay').style.display = 'none';
      const success = await fetchDashboardData();
      if (!success) {
        // If fetch returns 401, key is bad. Show auth screen with error.
        logout();
        document.getElementById('auth-error').style.display = 'block';
      } else {
        document.getElementById('auth-error').style.display = 'none';
      }
    }

    // Fetch stats and logs from Worker API
    async function fetchDashboardData(btn = null) {
      const key = getApiKey();
      if (!key) return false;

      let icon = null;
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Syncing...';
      }

      try {
        // Fetch stats
        const statsRes = await fetch('/api/status', {
          headers: { 'Authorization': 'Bearer ' + key }
        });
        
        if (statsRes.status === 401) {
          return false;
        }

        const stats = await statsRes.json();
        document.getElementById('stats-queued').textContent = stats.queued || 0;
        document.getElementById('stats-sending').textContent = stats.sending || 0;
        document.getElementById('stats-sent').textContent = stats.sent || 0;
        document.getElementById('stats-failed').textContent = stats.failed || 0;

        // Fetch logs
        const logsRes = await fetch('/api/logs', {
          headers: { 'Authorization': 'Bearer ' + key }
        });
        const logs = await logsRes.json();
        
        const tbody = document.getElementById('logs-body');
        if (!logs || logs.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No emails queued or sent yet.</td></tr>';
        } else {
          tbody.innerHTML = '';
          logs.forEach(log => {
            const tr = document.createElement('tr');
            
            // Format time
            const date = new Date(log.updated_at);
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + 
                            ' ' + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            
            // Recipient parsing for displaying nicely
            let toDisp = '';
            try {
              const toObj = JSON.parse(log.to_json);
              if (Array.isArray(toObj)) {
                toDisp = toObj.map(o => typeof o === 'string' ? o : o.email).join(', ');
              } else if (typeof toObj === 'object') {
                toDisp = toObj.email || JSON.stringify(toObj);
              } else {
                toDisp = String(toObj);
              }
            } catch (_) {
              toDisp = log.to_json;
            }

            // Error content
            const errDisp = log.error ? \`<div class="err-text" title="\${log.error}">\${log.error}</div>\` : '-';

            tr.innerHTML = \`
              <td style="color: var(--text-muted); font-weight:600;">#\${log.id}</td>
              <td style="font-weight: 500; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="\${toDisp}">\${toDisp}</td>
              <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${log.subject}</td>
              <td><span class="status-badge badge-\${log.status}">\${log.status}</span></td>
              <td style="text-align: center;">\${log.attempts}</td>
              <td style="color: var(--text-muted); font-size:12px;">\${timeStr}</td>
              <td>\${errDisp}</td>
            \`;
            tbody.appendChild(tr);
          });
        }

        return true;
      } catch (err) {
        console.error('Fetch error:', err);
        return false;
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Refresh Queue';
        }
      }
    }

    // Submit test email
    async function sendTestEmail(event) {
      event.preventDefault();
      const key = getApiKey();
      if (!key) return;

      const toField = document.getElementById('test-to').value.trim();
      const ccField = document.getElementById('test-cc').value.trim();
      const bccField = document.getElementById('test-bcc').value.trim();
      const subjectField = document.getElementById('test-subject').value.trim();
      const bodyField = document.getElementById('test-body').value.trim();
      
      const submitBtn = document.getElementById('send-test-btn');
      const resultDiv = document.getElementById('test-result');
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Enqueuing...';
      resultDiv.style.display = 'none';

      // Parse CC and BCC
      let cc = undefined;
      let bcc = undefined;
      
      if (ccField) {
        cc = ccField.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (bccField) {
        bcc = bccField.split(',').map(s => s.trim()).filter(Boolean);
      }

      // Handle direct comma-separated TO list or JSON format
      let to;
      if (toField.startsWith('[') || toField.startsWith('{')) {
        try {
          to = JSON.parse(toField);
        } catch (_) {
          to = toField.split(',').map(s => s.trim()).filter(Boolean);
        }
      } else {
        to = toField.split(',').map(s => s.trim()).filter(Boolean);
      }

      try {
        const res = await fetch('/api/send', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ to, cc, bcc, subject: subjectField, body: bodyField })
        });

        const data = await res.json();
        resultDiv.style.display = 'block';

        if (res.status === 200 || res.status === 202 || res.status === 201) {
          resultDiv.style.color = 'var(--color-green)';
          resultDiv.textContent = 'Success! Email added to queue (ID: ' + data.id + '). Sending background job...';
          // Clear form
          document.getElementById('test-subject').value = '';
          document.getElementById('test-body').value = '';
          // Refresh dashboard data
          setTimeout(() => fetchDashboardData(), 1000);
        } else {
          resultDiv.style.color = 'var(--color-red)';
          resultDiv.textContent = 'Error: ' + (data.error || 'Failed to queue email.');
        }
      } catch (err) {
        resultDiv.style.display = 'block';
        resultDiv.style.color = 'var(--color-red)';
        resultDiv.textContent = 'Network error: ' + err.message;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enqueue Test Email';
      }
    }

    // Auto-refresh stats every 8 seconds
    setInterval(() => {
      if (getApiKey()) {
        fetchDashboardData();
      }
    }, 8000);

    // Initial load
    checkAuth();
  </script>
</body>
</html>`;
}
