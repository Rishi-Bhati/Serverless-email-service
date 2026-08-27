export function renderDashboard(): string {
  // Template literal – uses backtick; inner JS template literals use \` escaping
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ESET Mail – Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root{
      --bg-dark:#0b0f19;--bg-card:#151b2c;--border:#242f47;
      --text:#f3f4f6;--muted:#9ca3af;
      --primary:#6366f1;--primary-glow:rgba(99,102,241,.15);
      --cyan:#06b6d4;--green:#10b981;--red:#ef4444;--orange:#f59e0b;--purple:#a78bfa;
      --ff-display:'Outfit',sans-serif;--ff-body:'Plus Jakarta Sans',sans-serif;--ff-mono:'JetBrains Mono',monospace;
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg-dark);color:var(--text);font-family:var(--ff-body);min-height:100vh;display:flex;flex-direction:column;line-height:1.5}

    /* AUTH OVERLAY */
    #auth-overlay{position:fixed;inset:0;background:rgba(11,15,25,.96);backdrop-filter:blur(12px);display:flex;justify-content:center;align-items:center;z-index:1000}
    .auth-card{background:var(--bg-card);border:1px solid var(--border);border-radius:20px;padding:40px;width:100%;max-width:460px;box-shadow:0 24px 48px rgba(0,0,0,.5),0 0 60px var(--primary-glow);text-align:center}
    .auth-card h2{font-family:var(--ff-display);font-size:26px;font-weight:700;margin-bottom:6px;background:linear-gradient(135deg,#fff,var(--muted));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .auth-card>p{color:var(--muted);font-size:13px;margin-bottom:24px}
    .auth-mode-group{display:flex;background:rgba(11,15,25,.7);border:1px solid var(--border);border-radius:10px;padding:4px;margin-bottom:20px}
    .auth-mode-btn{flex:1;background:none;border:none;color:var(--muted);padding:8px 6px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;font-family:var(--ff-body);transition:all .2s;white-space:nowrap}
    .auth-mode-btn.active{background:linear-gradient(135deg,var(--primary),#4f46e5);color:#fff;box-shadow:0 2px 8px rgba(99,102,241,.3)}
    .ig{margin-bottom:16px;text-align:left}
    .ig label{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px;color:var(--muted)}
    .ifield{width:100%;background:rgba(11,15,25,.6);border:1px solid var(--border);border-radius:8px;padding:11px 14px;color:#fff;font-family:inherit;font-size:14px;transition:all .2s}
    .ifield:focus{outline:none;border-color:var(--primary);box-shadow:0 0 10px rgba(99,102,241,.25)}
    select.ifield option{background:#151b2c}
    .auth-hint{font-size:11px;color:var(--muted);text-align:left;margin-bottom:20px;line-height:1.6;padding:10px 12px;background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15);border-radius:8px}
    .auth-hint b{color:var(--purple)}
    .btn{width:100%;background:linear-gradient(135deg,var(--primary),#4f46e5);color:#fff;border:none;border-radius:8px;padding:13px;font-family:var(--ff-display);font-weight:600;font-size:15px;cursor:pointer;transition:all .2s;box-shadow:0 4px 14px rgba(99,102,241,.35)}
    .btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(99,102,241,.45)}
    .bsm{padding:7px 14px;font-size:13px;width:auto;border-radius:7px;font-weight:600;cursor:pointer;border:none;font-family:var(--ff-body);transition:all .2s}
    .b-primary{background:linear-gradient(135deg,var(--primary),#4f46e5);color:#fff}
    .b-danger{background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3)}
    .b-warn{background:rgba(245,158,11,.15);color:var(--orange);border:1px solid rgba(245,158,11,.3)}
    .b-ghost{background:rgba(255,255,255,.06);color:var(--muted);border:1px solid var(--border)}
    .b-green{background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.3)}

    /* HEADER */
    header{background:var(--bg-card);border-bottom:1px solid var(--border);padding:14px 36px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100}
    .logo-wrap{display:flex;align-items:center;gap:12px}
    .logo-badge{background:linear-gradient(135deg,var(--primary),var(--cyan));width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;color:#fff;box-shadow:0 0 15px rgba(99,102,241,.4)}
    .logo-text{font-family:var(--ff-display);font-size:18px;font-weight:700;letter-spacing:-.02em}
    .logo-text span{background:linear-gradient(135deg,var(--primary),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .nav-tabs{display:flex;gap:4px;background:rgba(11,15,25,.6);border:1px solid var(--border);border-radius:9px;padding:4px}
    .nav-tab{background:none;border:none;color:var(--muted);padding:7px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;font-family:var(--ff-body);transition:all .2s;display:flex;align-items:center;gap:6px}
    .nav-tab.active{background:var(--primary);color:#fff}
    .nav-tab:hover:not(.active){color:var(--text);background:rgba(255,255,255,.06)}
    .hdr-right{display:flex;align-items:center;gap:14px}
    .status-pill{background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);color:var(--green);padding:5px 11px;border-radius:20px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px}
    .status-dot{width:7px;height:7px;background:var(--green);border-radius:50%;box-shadow:0 0 7px var(--green)}
    .ghost-btn{background:none;border:1px solid var(--border);color:var(--muted);padding:7px 13px;border-radius:8px;cursor:pointer;font-size:13px;font-family:var(--ff-body);transition:all .2s}
    .ghost-btn:hover{border-color:var(--red);color:var(--red)}

    /* MAIN */
    main{flex:1;padding:36px 40px;max-width:1400px;width:100%;margin:0 auto;display:grid;gap:28px}
    .view{display:none;flex-direction:column;gap:28px}
    .view.active{display:flex}

    /* STATS */
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px}
    .stat-card{background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:22px;display:flex;flex-direction:column;position:relative;overflow:hidden;transition:transform .2s,border-color .2s}
    .stat-card:hover{transform:translateY(-2px);border-color:rgba(99,102,241,.4)}
    .stat-label{color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
    .stat-value{font-family:var(--ff-display);font-size:34px;font-weight:700;line-height:1}
    .stat-indicator{width:4px;position:absolute;top:0;left:0;bottom:0}
    .stat-queued .stat-indicator{background:var(--cyan)}
    .stat-sending .stat-indicator{background:var(--orange)}
    .stat-sent .stat-indicator{background:var(--green)}
    .stat-failed .stat-indicator{background:var(--red)}
    .content-grid{display:grid;grid-template-columns:1fr;gap:28px}
    @media(min-width:1024px){.content-grid{grid-template-columns:3fr 2fr}}
    .panel{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:26px;display:flex;flex-direction:column}
    .panel-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
    .panel-title{font-family:var(--ff-display);font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px}

    /* TABLE */
    .table-wrap{overflow-x:auto;min-height:160px}
    table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}
    th{color:var(--muted);font-weight:600;padding:11px 14px;border-bottom:1px solid var(--border);text-transform:uppercase;font-size:11px;letter-spacing:.05em}
    td{padding:12px 14px;border-bottom:1px solid rgba(36,47,71,.5);vertical-align:middle}
    tr:last-child td{border-bottom:none}
    .badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;gap:4px}
    .b-queued{background:rgba(6,182,212,.1);border:1px solid rgba(6,182,212,.2);color:var(--cyan)}
    .b-sending{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);color:var(--orange)}
    .b-sent{background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);color:var(--green)}
    .b-failed{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:var(--red)}
    .b-active{background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.2);color:var(--green)}
    .b-disabled{background:rgba(156,163,175,.1);border:1px solid rgba(156,163,175,.2);color:var(--muted)}
    .empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted);padding:50px 0;gap:10px}
    .err-text{color:var(--red);font-size:11px;font-family:var(--ff-mono);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help}

    /* LOG DETAIL */
    .log-row{cursor:pointer;transition:background .15s}
    .log-row:hover{background:rgba(255,255,255,.02)!important}
    .expand-caret{transition:transform .2s;cursor:pointer;display:inline-block}
    .expand-caret.rotated{transform:rotate(90deg)}
    .detail-row{background:rgba(11,15,25,.4)}
    .detail-box{padding:20px;border-radius:8px;background:var(--bg-dark);border:1px solid var(--border);border-left:4px solid var(--primary);display:flex;flex-direction:column;gap:16px;margin:8px 4px}
    .detail-grid{display:grid;grid-template-columns:1fr;gap:16px}
    @media(min-width:768px){.detail-grid{grid-template-columns:1fr 1fr}}
    .detail-blk{display:flex;flex-direction:column;gap:6px}
    .detail-lbl{font-size:11px;text-transform:uppercase;font-weight:600;color:var(--muted);letter-spacing:.05em}
    .detail-val{font-size:13px;color:var(--text);line-height:1.6}
    .detail-mono{font-family:var(--ff-mono);font-size:12px;background:rgba(0,0,0,.3);padding:10px 14px;border-radius:6px;border:1px solid var(--border);max-height:180px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
    .dtabs{display:flex;border-bottom:1px solid var(--border);gap:4px;margin-bottom:8px}
    .dtab{background:none;border:none;color:var(--muted);padding:6px 12px;cursor:pointer;font-size:12px;font-weight:500;border-bottom:2px solid transparent;transition:all .2s;font-family:var(--ff-body)}
    .dtab.active{color:var(--primary);border-bottom-color:var(--primary)}
    .preview-iframe{width:100%;height:250px;border:1px solid var(--border);border-radius:6px;background:#fff}

    /* FILTER BAR */
    .filter-bar{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-bottom:20px;background:var(--bg-card);border:1px solid var(--border);padding:16px 24px;border-radius:12px}
    .flbl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px;display:block}
    .finput{background:rgba(11,15,25,.6);border:1px solid var(--border);border-radius:7px;padding:8px 12px;color:#fff;font-family:var(--ff-body);font-size:13px;min-width:140px;transition:border-color .2s}
    .finput:focus{outline:none;border-color:var(--primary)}
    select.finput option{background:#151b2c}
    .pag{display:flex;justify-content:space-between;align-items:center;padding:16px 20px}
    .pag-info{font-size:13px;color:var(--muted)}
    .pag-btns{display:flex;gap:8px}
    .pag-btn{background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--muted);padding:7px 16px;border-radius:8px;cursor:pointer;font-size:13px;font-family:var(--ff-body);transition:all .2s}
    .pag-btn:hover{border-color:var(--primary);color:var(--primary)}
    .pag-btn:disabled{opacity:.4;cursor:not-allowed}

    /* QUOTA BAR */
    .qbar-wrap{display:flex;align-items:center;gap:8px;min-width:120px}
    .qbar-track{flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden}
    .qbar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--green),var(--cyan));transition:width .4s}
    .qbar-fill.warn{background:linear-gradient(90deg,var(--orange),#d97706)}
    .qbar-fill.danger{background:linear-gradient(90deg,var(--red),#dc2626)}
    .qbar-text{font-size:11px;color:var(--muted);white-space:nowrap}

    /* PROVIDER TYPE BADGE */
    .tbadge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
    .t-smtp{background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.25);color:var(--primary)}
    .t-resend{background:rgba(6,182,212,.12);border:1px solid rgba(6,182,212,.25);color:var(--cyan)}
    .t-sendgrid{background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.25);color:var(--green)}
    .t-mailgun{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.25);color:var(--orange)}
    .t-postmark{background:rgba(167,139,250,.12);border:1px solid rgba(167,139,250,.25);color:var(--purple)}
    .def-star{color:var(--orange);font-size:14px}
    .row-actions{display:flex;gap:6px;flex-wrap:wrap}

    /* MODAL */
    .modal-overlay{position:fixed;inset:0;background:rgba(11,15,25,.85);backdrop-filter:blur(8px);display:none;justify-content:center;align-items:center;z-index:500}
    .modal-overlay.open{display:flex}
    .modal-card{background:var(--bg-card);border:1px solid var(--border);border-radius:18px;padding:36px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.6)}
    .modal-title{font-family:var(--ff-display);font-size:20px;font-weight:700;margin-bottom:24px;display:flex;align-items:center;gap:10px}
    .modal-footer{display:flex;gap:12px;justify-content:flex-end;margin-top:24px}
    .cred-section{border:1px solid var(--border);border-radius:10px;padding:16px;margin:4px 0 12px}
    .cred-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:12px}
    .cbrow{display:flex;align-items:center;gap:10px;margin-bottom:16px}
    .cbrow input[type=checkbox]{width:18px;height:18px;cursor:pointer;accent-color:var(--primary)}
    .cbrow label{font-size:14px;cursor:pointer}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media(max-width:640px){.form-row{grid-template-columns:1fr}}

    /* QUICK REF */
    .qr-grid{display:grid;gap:10px}
    .qr-item{background:rgba(11,15,25,.6);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;flex-direction:column;gap:4px}
    .qr-lbl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
    .qr-val{font-family:var(--ff-mono);font-size:12px;word-break:break-all}

    /* API DOCS */
    .docs-hero{background:linear-gradient(135deg,rgba(99,102,241,.12),rgba(6,182,212,.08));border:1px solid rgba(99,102,241,.2);border-radius:16px;padding:32px;text-align:center}
    .docs-hero h2{font-family:var(--ff-display);font-size:26px;font-weight:700;margin-bottom:8px;background:linear-gradient(135deg,#fff,var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .docs-hero p{color:var(--muted);font-size:14px;max-width:600px;margin:0 auto}
    .docs-card{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:26px}
    .docs-card+.docs-card{margin-top:0}
    .docs-title{font-family:var(--ff-display);font-size:17px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    pre{background:rgba(0,0,0,.4);border:1px solid var(--border);border-radius:10px;padding:20px;overflow-x:auto;font-family:var(--ff-mono);font-size:13px;line-height:1.7}
    .hl-k{color:var(--cyan)}.hl-v{color:var(--green)}.hl-s{color:var(--orange)}.hl-c{color:#6b7280;font-style:italic}
    .ep-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
    .ep-post{background:rgba(16,185,129,.15);color:var(--green)}
    .ep-get{background:rgba(6,182,212,.15);color:var(--cyan)}
    .ep-put{background:rgba(245,158,11,.15);color:var(--orange)}
    .ep-delete{background:rgba(239,68,68,.15);color:var(--red)}
    .ep-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(36,47,71,.4)}
    .ep-row:last-child{border-bottom:none}
    .ep-path{font-family:var(--ff-mono);font-size:13px}
    .ep-desc{font-size:13px;color:var(--muted);margin-left:auto}
    .cmp-table{width:100%;border-collapse:collapse;font-size:13px}
    .cmp-table th{background:rgba(11,15,25,.7);padding:12px 16px;text-align:left;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-bottom:1px solid var(--border)}
    .cmp-table td{padding:12px 16px;border-bottom:1px solid rgba(36,47,71,.4)}
    .cmp-table tr:last-child td{border-bottom:none}
    .chk-yes{color:var(--green);font-weight:700}.chk-no{color:var(--red);font-weight:700}
    .info-box{background:rgba(99,102,241,.07);border:1px solid rgba(99,102,241,.2);border-radius:10px;padding:16px 20px;display:flex;gap:12px;align-items:flex-start}
    .info-icon{font-size:18px;flex-shrink:0;margin-top:1px}
    .info-text{font-size:13px;color:var(--muted);line-height:1.7}
    .info-text b{color:var(--text)}

    /* SECTION HEADER */
    .sec-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
    .sec-title{font-family:var(--ff-display);font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}
    hr.div{border:none;border-top:1px solid var(--border);margin:10px 0}

    /* TOAST */
    #toast{position:fixed;bottom:30px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:12px 22px;font-size:14px;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .3s,transform .3s;z-index:9999;pointer-events:none}
    #toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    #toast.tok{border-color:rgba(16,185,129,.4);color:var(--green)}
    #toast.terr{border-color:rgba(239,68,68,.4);color:var(--red)}
    .mono{font-family:var(--ff-mono);font-size:12px}
    .docs-section{display:flex;flex-direction:column;gap:24px}
  </style>
</head>
<body>

<!-- AUTH OVERLAY -->
<div id="auth-overlay">
  <div class="auth-card">
    <div style="font-size:36px;margin-bottom:12px">✉️</div>
    <h2>ESET Mail</h2>
    <p>Authenticate to access your dashboard</p>
    <div class="auth-mode-group">
      <button class="auth-mode-btn active" onclick="setAuthMode('apikey')" id="mbtn-apikey">API Key</button>
      <button class="auth-mode-btn" onclick="setAuthMode('hmac')" id="mbtn-hmac">HMAC Signed</button>
    </div>
    <div id="auth-apikey-form">
      <div class="ig"><label>API Key</label><input class="ifield" type="password" id="ak-input" placeholder="sk-…" autocomplete="off"></div>
      <div class="auth-hint"><b>API Key mode</b> — Simple bearer token. Set <code>API_KEY</code> in your Worker env vars.</div>
      <button class="btn" onclick="doAuth()">🔓 Unlock Dashboard</button>
    </div>
    <div id="auth-hmac-form" style="display:none">
      <div class="ig"><label>API Key</label><input class="ifield" type="password" id="ak-input-hmac" placeholder="sk-…" autocomplete="off"></div>
      <div class="ig"><label>Secret Key</label><input class="ifield" type="password" id="sk-input" placeholder="your-hmac-secret" autocomplete="off"></div>
      <div class="auth-hint"><b>HMAC Signed mode</b> — Requests signed with <b>HMAC-SHA256</b> using your <code>API_SECRET</code>. <code>X-API-Key</code> authenticates access, and provider routing headers are bound into the signature to prevent MITM.</div>
      <button class="btn" onclick="doAuth()">🔐 Unlock Dashboard</button>
    </div>
    <p id="auth-err" style="color:var(--red);margin-top:14px;font-size:13px;display:none"></p>
  </div>
</div>

<!-- HEADER -->
<header>
  <div class="logo-wrap">
    <div class="logo-badge">✉</div>
    <div class="logo-text">ESET <span>Mail</span></div>
  </div>
  <nav class="nav-tabs">
    <button class="nav-tab active" onclick="switchView('v-dash')" id="tab-dash">📊 Dashboard</button>
    <button class="nav-tab" onclick="switchView('v-prov')" id="tab-prov">🔌 Providers</button>
    <button class="nav-tab" onclick="switchView('v-logs')" id="tab-logs">📋 Logs</button>
    <button class="nav-tab" onclick="switchView('v-docs')" id="tab-docs">📖 API Docs</button>
  </nav>
  <div class="hdr-right">
    <div class="status-pill"><div class="status-dot"></div> Live</div>
    <button class="ghost-btn" onclick="logout()">↩ Logout</button>
  </div>
</header>

<main>

<!-- ══════════════ VIEW: DASHBOARD ══════════════ -->
<div id="v-dash" class="view active">
  <div class="stats-grid">
    <div class="stat-card stat-queued"><div class="stat-indicator"></div><div class="stat-label">Queued</div><div class="stat-value" id="st-queued">—</div></div>
    <div class="stat-card stat-sending"><div class="stat-indicator"></div><div class="stat-label">Sending</div><div class="stat-value" id="st-sending">—</div></div>
    <div class="stat-card stat-sent"><div class="stat-indicator"></div><div class="stat-label">Sent</div><div class="stat-value" id="st-sent">—</div></div>
    <div class="stat-card stat-failed"><div class="stat-indicator"></div><div class="stat-label">Failed</div><div class="stat-value" id="st-failed">—</div></div>
  </div>
  <div class="content-grid">
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">📬 Recent Emails</div>
        <button class="ghost-btn" onclick="fetchDash(this)">↻ Refresh</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Recipient</th><th>Subject</th><th>Status</th><th>Provider</th><th>Time</th></tr></thead>
          <tbody id="dash-emails"><tr><td colspan="5"><div class="empty-state">⏳ Loading…</div></td></tr></tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🧪 Send Test Email</div></div>
      <form onsubmit="sendTest(event)">
        <div class="ig"><label>To</label><input class="ifield" type="email" id="te-to" placeholder="recipient@example.com" required></div>
        <div class="ig"><label>Subject</label><input class="ifield" type="text" id="te-subj" placeholder="Hello from ESET Mail"></div>
        <div class="ig"><label>Body (HTML)</label><textarea class="ifield" id="te-body" rows="3" placeholder="&lt;p&gt;Test body&lt;/p&gt;"></textarea></div>
        <div class="ig">
          <label>Route via Provider (optional)</label>
          <select class="ifield" id="te-prov">
            <option value="">— Auto (priority order) —</option>
          </select>
        </div>
        <button class="btn" type="submit" id="te-btn">📤 Send Test Email</button>
      </form>
      <hr class="div" style="margin-top:20px">
      <div class="panel-title" style="margin:14px 0 10px">⚡ Quick Reference</div>
      <div class="qr-grid">
        <div class="qr-item"><div class="qr-lbl">API Base</div><div class="qr-val" id="qr-base">—</div></div>
        <div class="qr-item"><div class="qr-lbl">Auth Method</div><div class="qr-val" id="qr-auth">—</div></div>
        <div class="qr-item"><div class="qr-lbl">Active Providers</div><div class="qr-val" id="qr-provs">—</div></div>
      </div>
    </div>
  </div>
</div>

<!-- ══════════════ VIEW: PROVIDERS ══════════════ -->
<div id="v-prov" class="view">
  <div class="sec-hdr">
    <div class="sec-title">🔌 Email Providers</div>
    <button class="bsm b-primary" onclick="openAddProv()">＋ Add Provider</button>
  </div>
  <div class="info-box">
    <div class="info-icon">ℹ️</div>
    <div class="info-text">
      The <b>default provider</b> (⭐) is tried first in the failover chain regardless of priority number.
      Providers that exceed their daily limit are automatically skipped. If env-var SMTP credentials are configured,
      they serve as the <b>final fallback</b> (labeled <em>Default Env SMTP</em>).
    </div>
  </div>
  <div class="panel" style="padding:0">
    <div class="panel-header" style="padding:20px 26px 16px">
      <div class="panel-title">Provider List</div>
      <button class="ghost-btn" onclick="fetchProviders(this)">↻ Refresh</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th style="width:40px">#</th><th>Name</th><th>Type</th><th>From Email</th><th>Daily Quota</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody id="prov-body"><tr><td colspan="7"><div class="empty-state">⏳ Loading…</div></td></tr></tbody>
      </table>
    </div>
  </div>
</div>

<!-- ══════════════ VIEW: LOGS ══════════════ -->
<div id="v-logs" class="view">
  <div class="sec-hdr"><div class="sec-title">📋 Detailed Logs</div></div>
  <div class="filter-bar">
    <div><label class="flbl">Status</label><select class="finput" id="fl-status"><option value="">All</option><option value="queued">Queued</option><option value="sending">Sending</option><option value="sent">Sent</option><option value="failed">Failed</option></select></div>
    <div><label class="flbl">Search</label><input class="finput" type="text" id="fl-search" placeholder="recipient / subject…"></div>
    <div><label class="flbl">From Date</label><input class="finput" type="date" id="fl-from"></div>
    <div><label class="flbl">To Date</label><input class="finput" type="date" id="fl-to"></div>
    <div style="display:flex;gap:8px;align-items:flex-end;margin-left:auto">
      <button class="bsm b-primary" onclick="fetchLogs(this)">🔍 Apply</button>
      <button class="bsm b-ghost" onclick="resetFilters()">✕ Reset</button>
    </div>
  </div>
  <div class="panel" style="padding:0">
    <div class="table-wrap">
      <table>
        <thead><tr><th style="width:30px"></th><th>ID</th><th>Recipient</th><th>Subject</th><th>Status</th><th>Provider</th><th>From</th><th>Created</th></tr></thead>
        <tbody id="logs-body"><tr><td colspan="8"><div class="empty-state">⏳ Loading…</div></td></tr></tbody>
      </table>
    </div>
    <div class="pag">
      <div class="pag-info" id="pag-info">—</div>
      <div class="pag-btns">
        <button class="pag-btn" id="btn-prev" onclick="changePage(-1)" disabled>← Prev</button>
        <button class="pag-btn" id="btn-next" onclick="changePage(1)" disabled>Next →</button>
      </div>
    </div>
  </div>
</div>

<!-- ══════════════ VIEW: API DOCS ══════════════ -->
<div id="v-docs" class="view">
  <div class="docs-section">
    <div class="docs-hero">
      <h2>📖 API Reference</h2>
      <p>Secure queue-based email sending with multi-provider failover. Full HMAC request signing with optional per-call provider routing.</p>
    </div>

    <div class="docs-card">
      <div class="docs-title">🔐 Authentication Comparison</div>
      <table class="cmp-table">
        <thead><tr><th>Feature</th><th>API Key</th><th>HMAC Signed</th></tr></thead>
        <tbody>
          <tr><td>Replay Protection</td><td class="chk-no">✗</td><td class="chk-yes">✓ Timestamp + Nonce</td></tr>
          <tr><td>Body Tampering Detection</td><td class="chk-no">✗</td><td class="chk-yes">✓ SHA-256 body hash</td></tr>
          <tr><td>Provider Header MITM</td><td class="chk-no">✗</td><td class="chk-yes">✓ Headers bound into signature</td></tr>
          <tr><td>Setup Complexity</td><td class="chk-yes">✓ Simple</td><td>Requires signing logic</td></tr>
        </tbody>
      </table>
    </div>

    <div class="docs-card">
      <div class="docs-title"><span class="ep-badge ep-post">POST</span>&nbsp;/api/send</div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px">Queue an email. The cron worker picks it up and sends via configured providers with automatic failover.</p>
      <pre><span class="hl-c">// Standard request (API Key auth)</span>
POST /api/send
<span class="hl-k">X-API-Key:</span> <span class="hl-s">sk-your-key</span>
<span class="hl-k">Content-Type:</span> <span class="hl-v">application/json</span>

<span class="hl-c">// Or HMAC auth — with optional provider routing headers:</span>
<span class="hl-k">X-Timestamp:</span>    <span class="hl-v">1722000000</span>
<span class="hl-k">X-Nonce:</span>        <span class="hl-v">abc123</span>
<span class="hl-k">X-Signature:</span>    <span class="hl-v">sha256=…</span>
<span class="hl-k">X-Provider-Id:</span>  <span class="hl-s">prov_smtp_01</span>   <span class="hl-c">// force specific provider</span>
<span class="hl-k">X-Sender-Email:</span> <span class="hl-s">noreply@acme.com</span> <span class="hl-c">// or match by from_email</span>

{
  <span class="hl-k">"to":</span>      <span class="hl-s">"alice@example.com"</span>,
  <span class="hl-k">"subject":</span> <span class="hl-s">"Hello!"</span>,
  <span class="hl-k">"html":</span>    <span class="hl-s">"&lt;p&gt;Hi&lt;/p&gt;"</span>,
  <span class="hl-k">"text":</span>    <span class="hl-s">"Hi"</span>,            <span class="hl-c">// optional</span>
  <span class="hl-k">"cc":</span>      <span class="hl-s">"bob@example.com"</span>, <span class="hl-c">// optional</span>
  <span class="hl-k">"bcc":</span>     <span class="hl-s">"audit@acme.com"</span>  <span class="hl-c">// optional</span>
}</pre>
    </div>

    <div class="docs-card">
      <div class="docs-title">🔑 HMAC Signing (JavaScript)</div>
      <pre><span class="hl-c">// Standard (no provider headers)</span>
<span class="hl-k">const</span> ts       = Math.floor(Date.now()/1000).toString();
<span class="hl-k">const</span> nonce    = crypto.randomUUID();
<span class="hl-k">const</span> bodyHash = await sha256hex(JSON.stringify(body));
<span class="hl-k">const</span> canon    = \`\${ts}\\n\${nonce}\\n\${bodyHash}\`;
<span class="hl-k">const</span> sig      = await hmacSha256hex(secretKey, canon);

<span class="hl-c">// With provider routing — headers bound into signature:</span>
<span class="hl-k">const</span> qualifier = \`provider:\${providerId}\`;
<span class="hl-c">// OR: const qualifier = \`email:noreply@acme.com\`;</span>
<span class="hl-k">const</span> canon     = \`\${ts}\\n\${nonce}\\n\${qualifier}\\n\${bodyHash}\`;
<span class="hl-k">const</span> sig       = await hmacSha256hex(secretKey, canon);</pre>
    </div>

    <div class="docs-card">
      <div class="docs-title">🔀 Multi-Provider Routing &amp; Failover</div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:14px">Three provider selection strategies, evaluated in order:</p>
      <table class="cmp-table" style="margin-bottom:16px">
        <thead><tr><th>Strategy</th><th>How to Use</th><th>When</th></tr></thead>
        <tbody>
          <tr><td><b>Explicit by ID</b></td><td><code>X-Provider-Id: &lt;id&gt;</code></td><td>Route to a specific provider</td></tr>
          <tr><td><b>Explicit by Email</b></td><td><code>X-Sender-Email: &lt;email&gt;</code></td><td>Match provider by from_email</td></tr>
          <tr><td><b>Auto Failover</b></td><td>No routing headers</td><td>Default → priority order → env SMTP</td></tr>
        </tbody>
      </table>
      <div class="info-box" style="margin-bottom:16px">
        <div class="info-icon">🛡️</div>
        <div class="info-text"><b>MITM Protection:</b> When using HMAC, any <code>X-Provider-Id</code> or <code>X-Sender-Email</code> header is <b>bound into the request signature</b>. If an attacker modifies these headers in transit, signature verification fails and the server returns <code>401 Unauthorized</code>.</div>
      </div>
      <pre><span class="hl-c">// Failover priority chain:</span>
1. Explicit provider_id  (X-Provider-Id header)
2. Explicit from_email   (X-Sender-Email header)
3. ⭐ Default provider   (is_default = true)
4. Remaining active providers by priority ASC
5. Environment variable SMTP fallback

<span class="hl-c">// Providers that exceed daily_limit are skipped.
// Failover history is recorded in the email record.</span></pre>
    </div>

    <div class="docs-card">
      <div class="docs-title">🔌 Provider Management</div>
      <div class="ep-row"><span class="ep-badge ep-get">GET</span><span class="ep-path">/api/providers</span><span class="ep-desc">List all providers (credentials masked)</span></div>
      <div class="ep-row"><span class="ep-badge ep-post">POST</span><span class="ep-path">/api/providers</span><span class="ep-desc">Create a new provider</span></div>
      <div class="ep-row"><span class="ep-badge ep-put">PUT</span><span class="ep-path">/api/providers</span><span class="ep-desc">Update provider (partial credentials merge)</span></div>
      <div class="ep-row"><span class="ep-badge ep-delete">DELETE</span><span class="ep-path">/api/providers?id=&lt;id&gt;</span><span class="ep-desc">Delete a provider</span></div>
      <div class="ep-row"><span class="ep-badge ep-post">POST</span><span class="ep-path">/api/providers/set-default</span><span class="ep-desc">Set provider as default</span></div>
      <div class="ep-row"><span class="ep-badge ep-post">POST</span><span class="ep-path">/api/providers/test</span><span class="ep-desc">Send a test email via specific provider</span></div>
      <pre style="margin-top:16px"><span class="hl-c">// POST /api/providers body (example: SMTP)</span>
{
  <span class="hl-k">"id":</span>          <span class="hl-s">"prov_smtp_01"</span>,  <span class="hl-c">// alphanumeric + _ -</span>
  <span class="hl-k">"name":</span>        <span class="hl-s">"Main SMTP"</span>,
  <span class="hl-k">"type":</span>        <span class="hl-s">"smtp"</span>,         <span class="hl-c">// smtp|resend|sendgrid|mailgun|postmark</span>
  <span class="hl-k">"from_email":</span>  <span class="hl-s">"noreply@acme.com"</span>,
  <span class="hl-k">"from_name":</span>   <span class="hl-s">"Acme"</span>,          <span class="hl-c">// optional</span>
  <span class="hl-k">"priority":</span>    <span class="hl-v">1</span>,               <span class="hl-c">// lower = higher priority</span>
  <span class="hl-k">"is_default":</span>  <span class="hl-v">true</span>,
  <span class="hl-k">"daily_limit":</span> <span class="hl-v">500</span>,             <span class="hl-c">// 0 = unlimited</span>
  <span class="hl-k">"credentials":</span> {
    <span class="hl-k">"host":</span> <span class="hl-s">"smtp.gmail.com"</span>, <span class="hl-k">"port":</span> <span class="hl-v">587</span>,
    <span class="hl-k">"username":</span> <span class="hl-s">"you@gmail.com"</span>, <span class="hl-k">"password":</span> <span class="hl-s">"app-password"</span>
  }
}</pre>
    </div>

    <div class="docs-card">
      <div class="docs-title">📊 Other Endpoints</div>
      <div class="ep-row"><span class="ep-badge ep-get">GET</span><span class="ep-path">/api/status</span><span class="ep-desc">Queue stats (counts by status)</span></div>
      <div class="ep-row"><span class="ep-badge ep-get">GET</span><span class="ep-path">/api/emails</span><span class="ep-desc">List emails — ?status=&search=&limit=&offset=&from=&to=</span></div>
      <div class="ep-row"><span class="ep-badge ep-get">GET</span><span class="ep-path">/api/emails/:id</span><span class="ep-desc">Get single email detail</span></div>
      <div class="ep-row"><span class="ep-badge ep-delete">DELETE</span><span class="ep-path">/api/emails/:id</span><span class="ep-desc">Delete an email record</span></div>
    </div>
  </div>
</div>

</main>

<!-- PROVIDER MODAL -->
<div class="modal-overlay" id="prov-modal">
  <div class="modal-card">
    <div class="modal-title" id="prov-modal-title">➕ Add Provider</div>
    <form id="prov-form" onsubmit="saveProv(event)">
      <input type="hidden" id="prov-editing-id">
      <div class="form-row">
        <div class="ig"><label>Provider ID *</label><input class="ifield" type="text" id="pf-id" placeholder="prov_smtp_01" pattern="[a-zA-Z0-9_\\-]+" required></div>
        <div class="ig"><label>Display Name *</label><input class="ifield" type="text" id="pf-name" placeholder="Main SMTP" required></div>
      </div>
      <div class="ig">
        <label>Provider Type *</label>
        <select class="ifield" id="pf-type" onchange="onTypeChange()" required>
          <option value="">— Select type —</option>
          <option value="smtp">SMTP</option>
          <option value="resend">Resend</option>
          <option value="sendgrid">SendGrid</option>
          <option value="mailgun">Mailgun</option>
          <option value="postmark">Postmark</option>
        </select>
      </div>
      <div class="form-row">
        <div class="ig"><label>From Email *</label><input class="ifield" type="email" id="pf-from-email" placeholder="noreply@acme.com" required></div>
        <div class="ig"><label>From Name</label><input class="ifield" type="text" id="pf-from-name" placeholder="Acme Notifications"></div>
      </div>
      <div class="form-row">
        <div class="ig"><label>Priority (lower = first)</label><input class="ifield" type="number" id="pf-priority" value="10" min="1"></div>
        <div class="ig"><label>Daily Limit (0 = unlimited)</label><input class="ifield" type="number" id="pf-daily" value="0" min="0"></div>
      </div>
      <div class="cbrow"><input type="checkbox" id="pf-default"><label for="pf-default">⭐ Set as default provider</label></div>
      <div class="cbrow"><input type="checkbox" id="pf-active" checked><label for="pf-active">✅ Provider is active</label></div>

      <!-- SMTP -->
      <div class="cred-section" id="cred-smtp" style="display:none">
        <div class="cred-title">📧 SMTP Credentials</div>
        <div class="form-row">
          <div class="ig" style="margin-bottom:0"><label>Host *</label><input class="ifield" type="text" id="cs-host" placeholder="smtp.gmail.com"></div>
          <div class="ig" style="margin-bottom:0"><label>Port</label><input class="ifield" type="number" id="cs-port" value="587"></div>
        </div>
        <div style="height:12px"></div>
        <div class="form-row">
          <div class="ig" style="margin-bottom:0"><label>Username *</label><input class="ifield" type="text" id="cs-user" placeholder="you@gmail.com"></div>
          <div class="ig" style="margin-bottom:0"><label>Password *</label><input class="ifield" type="password" id="cs-pass" placeholder="app password"></div>
        </div>
      </div>

      <!-- Resend -->
      <div class="cred-section" id="cred-resend" style="display:none">
        <div class="cred-title">📨 Resend Credentials</div>
        <div class="ig" style="margin-bottom:0"><label>API Key *</label><input class="ifield" type="password" id="cr-key" placeholder="re_…"></div>
      </div>

      <!-- SendGrid -->
      <div class="cred-section" id="cred-sendgrid" style="display:none">
        <div class="cred-title">📤 SendGrid Credentials</div>
        <div class="ig" style="margin-bottom:0"><label>API Key *</label><input class="ifield" type="password" id="csg-key" placeholder="SG.…"></div>
      </div>

      <!-- Mailgun -->
      <div class="cred-section" id="cred-mailgun" style="display:none">
        <div class="cred-title">📬 Mailgun Credentials</div>
        <div class="form-row">
          <div class="ig" style="margin-bottom:0"><label>API Key *</label><input class="ifield" type="password" id="cmg-key" placeholder="key-…"></div>
          <div class="ig" style="margin-bottom:0"><label>Domain *</label><input class="ifield" type="text" id="cmg-domain" placeholder="mg.acme.com"></div>
        </div>
        <div style="height:12px"></div>
        <div class="ig" style="margin-bottom:0"><label>Region</label><select class="ifield" id="cmg-region"><option value="us">US (api.mailgun.net)</option><option value="eu">EU (api.eu.mailgun.net)</option></select></div>
      </div>

      <!-- Postmark -->
      <div class="cred-section" id="cred-postmark" style="display:none">
        <div class="cred-title">📮 Postmark Credentials</div>
        <div class="ig" style="margin-bottom:0"><label>Server Token *</label><input class="ifield" type="password" id="cpm-token" placeholder="xxxxxxxx-xxxx-…"></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="bsm b-ghost" onclick="closeProv()">Cancel</button>
        <button type="submit" class="bsm b-primary" id="prov-save-btn">💾 Save Provider</button>
      </div>
    </form>
  </div>
</div>

<!-- TEST PROVIDER MODAL -->
<div class="modal-overlay" id="test-prov-modal">
  <div class="modal-card" style="max-width:440px">
    <div class="modal-title">🧪 Test Provider</div>
    <p style="color:var(--muted);font-size:13px;margin-bottom:20px" id="tp-desc">Send a test email immediately via this provider.</p>
    <form onsubmit="execTest(event)">
      <input type="hidden" id="tp-id">
      <div class="ig"><label>Send To *</label><input class="ifield" type="email" id="tp-to" placeholder="recipient@example.com" required></div>
      <div id="tp-result" style="display:none;padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px"></div>
      <div class="modal-footer">
        <button type="button" class="bsm b-ghost" onclick="closeTestProv()">Close</button>
        <button type="submit" class="bsm b-primary" id="tp-btn">📤 Send Test</button>
      </div>
    </form>
  </div>
</div>

<div id="toast"></div>

<script>
// ── State ──────────────────────────────────────────────────
let authMode = 'apikey', authToken = '', authSecret = '';
let logsPage = 0, logsPerPage = 20, logsTotal = 0;
let provsCache = [];

// ── Helpers ────────────────────────────────────────────────
function toast(msg, ok=true){
  const el=document.getElementById('toast');
  el.textContent=msg; el.className='show '+(ok?'tok':'terr');
  clearTimeout(el._t); el._t=setTimeout(()=>{el.className=''},3200);
}
async function sha256hex(s){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function hmacHex(key,msg){
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const s=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg));
  return 'sha256='+Array.from(new Uint8Array(s)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function buildHdrs(bodyStr, qual=''){
  if(authMode==='apikey') return {'Content-Type':'application/json','X-API-Key':authToken};
  const ts=Math.floor(Date.now()/1000).toString(), n=crypto.randomUUID();
  const bh=await sha256hex(bodyStr);
  const canon=(qual?[ts,n,qual,bh]:[ts,n,bh]).join(String.fromCharCode(10));
  const sig=await hmacHex(authSecret,canon);
  return {'Content-Type':'application/json','X-API-Key':authToken,'X-Timestamp':ts,'X-Nonce':n,'X-Signature':sig};
}
async function api(path,opts={}){
  const method=opts.method||'GET';
  const bodyStr=opts.body?JSON.stringify(opts.body):'';
  const hdrs=await buildHdrs(bodyStr,opts.qual||'');
  if(opts.provId) hdrs['X-Provider-Id']=opts.provId;
  if(opts.senderEmail) hdrs['X-Sender-Email']=opts.senderEmail;
  const res=await fetch(path,{method,headers:hdrs,body:bodyStr||undefined});
  const ct=res.headers.get('content-type')||'';
  if(ct.includes('application/json')) return res.json();
  return {_status:res.status,_text:await res.text()};
}
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').split(String.fromCharCode(92)).join('&#92;');
const fmt=iso=>{if(!iso)return'—';const d=new Date(iso);return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};
function sbadge(s){const m={queued:'b-queued',sending:'b-sending',sent:'b-sent',failed:'b-failed'};return '<span class="badge '+(m[s]||'')+'">'+esc(s)+'</span>';}
function tbadge(t){return '<span class="tbadge t-'+esc(t)+'">'+esc(t)+'</span>';}
function qbar(sent,lim){
  if(!lim)return'<span class="qbar-text">Unlimited</span>';
  const p=Math.min(100,Math.round(sent/lim*100));
  const c=p>=90?'danger':p>=70?'warn':'';
  return '<div class="qbar-wrap"><div class="qbar-track"><div class="qbar-fill '+c+'" style="width:'+p+'%"></div></div><span class="qbar-text">'+sent+'/'+lim+'</span></div>';
}

// ── Auth ───────────────────────────────────────────────────
function setAuthMode(m){
  authMode=m;
  if(m==='hmac'&&document.getElementById('ak-input').value&&!document.getElementById('ak-input-hmac').value){
    document.getElementById('ak-input-hmac').value=document.getElementById('ak-input').value;
  }else if(m==='apikey'&&document.getElementById('ak-input-hmac').value&&!document.getElementById('ak-input').value){
    document.getElementById('ak-input').value=document.getElementById('ak-input-hmac').value;
  }
  document.getElementById('auth-apikey-form').style.display=m==='apikey'?'':'none';
  document.getElementById('auth-hmac-form').style.display=m==='hmac'?'':'none';
  document.getElementById('mbtn-apikey').classList.toggle('active',m==='apikey');
  document.getElementById('mbtn-hmac').classList.toggle('active',m==='hmac');
}
async function doAuth(){
  const errEl=document.getElementById('auth-err'); errEl.style.display='none';
  if(authMode==='apikey'){
    authToken=document.getElementById('ak-input').value.trim();
    if(!authToken){errEl.textContent='Enter API Key';errEl.style.display='';return;}
  }else{
    authToken=document.getElementById('ak-input-hmac').value.trim()||document.getElementById('ak-input').value.trim();
    authSecret=document.getElementById('sk-input').value.trim();
    if(!authToken){errEl.textContent='Enter API Key';errEl.style.display='';return;}
    if(!authSecret){errEl.textContent='Enter Secret Key';errEl.style.display='';return;}
  }
  try{
    const r=await api('/api/status');
    if(r.error){errEl.textContent='Auth failed: '+(r.reason||r.error);errEl.style.display='';return;}
    document.getElementById('auth-overlay').style.display='none';
    document.getElementById('qr-base').textContent=window.location.origin;
    document.getElementById('qr-auth').textContent=authMode==='apikey'?'API Key (X-API-Key)':'HMAC-SHA256';
    fetchDash(); fetchProviders();
  }catch(e){errEl.textContent='Connection error: '+e.message;errEl.style.display='';}
}
function logout(){authToken='';authSecret='';document.getElementById('auth-overlay').style.display='';}

// ── Nav ────────────────────────────────────────────────────
function switchView(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const m={'v-dash':'tab-dash','v-prov':'tab-prov','v-logs':'tab-logs','v-docs':'tab-docs'};
  document.getElementById(m[id]).classList.add('active');
  if(id==='v-logs') fetchLogs();
  if(id==='v-prov') fetchProviders();
}

// ── Dashboard ──────────────────────────────────────────────
async function fetchDash(btn){
  if(btn){btn.textContent='⏳';btn.disabled=true;}
  try{
    const[st,em]=await Promise.all([api('/api/status'),api('/api/emails?limit=10')]);
    document.getElementById('st-queued').textContent=st.queued??'—';
    document.getElementById('st-sending').textContent=st.sending??'—';
    document.getElementById('st-sent').textContent=st.sent??'—';
    document.getElementById('st-failed').textContent=st.failed??'—';
    const tb=document.getElementById('dash-emails');
    const emails=em.emails||[];
    if(!emails.length){tb.innerHTML='<tr><td colspan="5"><div class="empty-state">📭 No emails yet</div></td></tr>';return;}
    tb.innerHTML=emails.map(e=>{
      const to=Array.isArray(e.to)?e.to[0]:e.to;
      return '<tr><td class="mono">'+esc(to)+'</td><td>'+esc(e.subject||'(no subject)')+'</td><td>'+sbadge(e.status)+'</td><td class="mono" style="font-size:11px;color:var(--muted)">'+esc(e.provider_used||'—')+'</td><td class="mono" style="font-size:11px;color:var(--muted)">'+fmt(e.created_at)+'</td></tr>';
    }).join('');
  }catch(e){toast('Dashboard error: '+e.message,false);}
  finally{if(btn){btn.textContent='↻ Refresh';btn.disabled=false;}}
}

// ── Test Email ─────────────────────────────────────────────
async function sendTest(ev){
  ev.preventDefault();
  const btn=document.getElementById('te-btn');btn.textContent='⏳ Sending…';btn.disabled=true;
  const to=document.getElementById('te-to').value.trim();
  const subj=document.getElementById('te-subj').value.trim()||'Test from ESET Mail';
  const html=document.getElementById('te-body').value.trim()||'<p>Test email from ESET Mail dashboard.</p>';
  const provId=document.getElementById('te-prov').value;
  try{
    const payload={to,subject:subj,html};
    if(provId) payload.provider_id=provId;
    const qual=provId?'provider:'+provId:'';
    const opts={method:'POST',body:payload,qual};
    if(provId) opts.provId=provId;
    const r=await api('/api/send',opts);
    if(r.error) toast('Error: '+r.error,false); else toast('✓ Email queued!');
  }catch(e){toast('Failed: '+e.message,false);}
  finally{btn.textContent='📤 Send Test Email';btn.disabled=false;}
}

// ── Providers ──────────────────────────────────────────────
async function fetchProviders(btn){
  if(btn){btn.textContent='⏳';btn.disabled=true;}
  try{
    const r=await api('/api/providers');
    provsCache=r.providers||[];
    renderProvs(provsCache);
    fillTestSelect(provsCache);
    document.getElementById('qr-provs').textContent=provsCache.filter(p=>p.is_active).length+' active';
  }catch(e){toast('Providers error: '+e.message,false);}
  finally{if(btn){btn.textContent='↻ Refresh';btn.disabled=false;}}
}

function renderProvs(provs){
  const tb=document.getElementById('prov-body');
  if(!provs.length){tb.innerHTML='<tr><td colspan="7"><div class="empty-state">🔌 No providers. Click "+ Add Provider" to get started.</div></td></tr>';return;}
  tb.innerHTML=provs.map((p,i)=>{
    const star=p.is_default?'<span class="def-star" title="Default">⭐</span>':'';
    const ab=p.is_active?'<span class="badge b-active">Active</span>':'<span class="badge b-disabled">Disabled</span>';
    const setDefBtn=!p.is_default?'<button class="bsm b-warn" title="Set default" onclick="setDefault(&#39;'+esc(p.id)+'&#39;)">⭐</button>':'';
    return '<tr>'
      +'<td style="text-align:center;font-weight:600;color:var(--muted)">'+(i+1)+'</td>'
      +'<td><b>'+esc(p.name)+'</b> '+star+'<br><span class="mono" style="font-size:10px;color:var(--muted)">'+esc(p.id)+'</span></td>'
      +'<td>'+tbadge(p.type)+'</td>'
      +'<td class="mono" style="font-size:12px">'+esc(p.from_email||'—')+'</td>'
      +'<td>'+qbar(p.daily_sent_count||0,p.daily_limit||0)+'</td>'
      +'<td>'+ab+'</td>'
      +'<td><div class="row-actions">'
        +setDefBtn
        +'<button class="bsm b-green" onclick="openTestProvById(&#39;'+esc(p.id)+'&#39;)">🧪</button>'
        +'<button class="bsm b-ghost" onclick="openEditProv(&#39;'+esc(p.id)+'&#39;)">✏️</button>'
        +'<button class="bsm b-danger" onclick="delProvById(&#39;'+esc(p.id)+'&#39;)">🗑️</button>'
      +'</div></td>'
    +'</tr>';
  }).join('');
}

function fillTestSelect(provs){
  const sel=document.getElementById('te-prov');
  const cur=sel.value;
  sel.innerHTML='<option value="">— Auto (priority order) —</option>';
  provs.filter(p=>p.is_active).forEach(p=>{
    const o=document.createElement('option');
    o.value=p.id;o.textContent=(p.is_default?'⭐ ':'')+p.name+' ('+p.type+')';
    sel.appendChild(o);
  });
  if(cur) sel.value=cur;
}

function openAddProv(){
  document.getElementById('prov-modal-title').textContent='➕ Add Provider';
  document.getElementById('prov-editing-id').value='';
  document.getElementById('prov-form').reset();
  document.getElementById('pf-active').checked=true;
  document.getElementById('pf-id').readOnly=false;
  onTypeChange();
  document.getElementById('prov-modal').classList.add('open');
}

function openEditProv(id){
  const p=provsCache.find(x=>x.id===id);if(!p){toast('Not found',false);return;}
  document.getElementById('prov-modal-title').textContent='✏️ Edit Provider';
  document.getElementById('prov-editing-id').value=id;
  document.getElementById('pf-id').value=p.id;
  document.getElementById('pf-id').readOnly=true;
  document.getElementById('pf-name').value=p.name;
  document.getElementById('pf-type').value=p.type;
  document.getElementById('pf-from-email').value=p.from_email||'';
  document.getElementById('pf-from-name').value=p.from_name||'';
  document.getElementById('pf-priority').value=p.priority||10;
  document.getElementById('pf-daily').value=p.daily_limit||0;
  document.getElementById('pf-default').checked=!!p.is_default;
  document.getElementById('pf-active').checked=!!p.is_active;
  onTypeChange();
  const c=p.credentials||{};
  if(p.type==='smtp'){document.getElementById('cs-host').value=c.host||'';document.getElementById('cs-port').value=c.port||587;document.getElementById('cs-user').value=c.username||'';document.getElementById('cs-pass').placeholder=c.password||'unchanged';}
  else if(p.type==='resend') document.getElementById('cr-key').placeholder=c.api_key||'unchanged';
  else if(p.type==='sendgrid') document.getElementById('csg-key').placeholder=c.api_key||'unchanged';
  else if(p.type==='mailgun'){document.getElementById('cmg-key').placeholder=c.api_key||'unchanged';document.getElementById('cmg-domain').value=c.domain||'';document.getElementById('cmg-region').value=c.region||'us';}
  else if(p.type==='postmark') document.getElementById('cpm-token').placeholder=c.server_token||'unchanged';
  document.getElementById('prov-modal').classList.add('open');
}

function closeProv(){document.getElementById('prov-modal').classList.remove('open');}

function onTypeChange(){
  const t=document.getElementById('pf-type').value;
  ['smtp','resend','sendgrid','mailgun','postmark'].forEach(x=>{
    document.getElementById('cred-'+x).style.display=x===t?'':'none';
  });
}

async function saveProv(ev){
  ev.preventDefault();
  const btn=document.getElementById('prov-save-btn');btn.textContent='⏳';btn.disabled=true;
  const isEdit=!!document.getElementById('prov-editing-id').value;
  const t=document.getElementById('pf-type').value;
  let creds={};
  if(t==='smtp'){
    creds={host:document.getElementById('cs-host').value.trim(),port:parseInt(document.getElementById('cs-port').value)||587,username:document.getElementById('cs-user').value.trim()};
    const pw=document.getElementById('cs-pass').value;if(pw)creds.password=pw;
  }else if(t==='resend'){const k=document.getElementById('cr-key').value;if(k)creds.api_key=k;}
  else if(t==='sendgrid'){const k=document.getElementById('csg-key').value;if(k)creds.api_key=k;}
  else if(t==='mailgun'){const k=document.getElementById('cmg-key').value;if(k)creds.api_key=k;creds.domain=document.getElementById('cmg-domain').value.trim();creds.region=document.getElementById('cmg-region').value;}
  else if(t==='postmark'){const k=document.getElementById('cpm-token').value;if(k)creds.server_token=k;}
  const payload={id:document.getElementById('pf-id').value.trim(),name:document.getElementById('pf-name').value.trim(),type:t,from_email:document.getElementById('pf-from-email').value.trim(),from_name:document.getElementById('pf-from-name').value.trim(),priority:parseInt(document.getElementById('pf-priority').value)||10,daily_limit:parseInt(document.getElementById('pf-daily').value)||0,is_default:document.getElementById('pf-default').checked,is_active:document.getElementById('pf-active').checked,credentials:creds};
  try{
    const r=await api('/api/providers',{method:isEdit?'PUT':'POST',body:payload});
    if(r.error){toast('Error: '+r.error,false);return;}
    toast(isEdit?'Provider updated ✓':'Provider added ✓');
    closeProv();fetchProviders();
  }catch(e){toast('Failed: '+e.message,false);}
  finally{btn.textContent='💾 Save Provider';btn.disabled=false;}
}

function openTestProvById(id){
  const p=provsCache.find(x=>x.id===id);
  if(p) openTestProv(p.id, p.name, p.from_email||'');
}
function delProvById(id){
  const p=provsCache.find(x=>x.id===id);
  delProv(id, p?p.name:id);
}

async function delProv(id,name){
  if(!confirm('Delete provider "'+name+'"? This cannot be undone.'))return;
  try{
    const r=await api('/api/providers?id='+encodeURIComponent(id),{method:'DELETE'});
    if(r.error){toast('Error: '+r.error,false);return;}
    toast('Provider deleted');fetchProviders();
  }catch(e){toast('Failed: '+e.message,false);}
}

async function setDefault(id){
  try{
    const r=await api('/api/providers/set-default',{method:'POST',body:{id}});
    if(r.error){toast('Error: '+r.error,false);return;}
    toast('Default provider updated ⭐');fetchProviders();
  }catch(e){toast('Failed: '+e.message,false);}
}

function openTestProv(id,name,fromEmail){
  document.getElementById('tp-id').value=id;
  document.getElementById('tp-desc').textContent='Send a test email immediately via "'+name+'" ('+fromEmail+').';
  document.getElementById('tp-result').style.display='none';
  document.getElementById('tp-to').value='';
  document.getElementById('test-prov-modal').classList.add('open');
}
function closeTestProv(){document.getElementById('test-prov-modal').classList.remove('open');}
async function execTest(ev){
  ev.preventDefault();
  const btn=document.getElementById('tp-btn');btn.textContent='⏳';btn.disabled=true;
  const re=document.getElementById('tp-result');re.style.display='none';
  try{
    const r=await api('/api/providers/test',{method:'POST',body:{provider_id:document.getElementById('tp-id').value,to:document.getElementById('tp-to').value.trim()}});
    if(r.error||!r.success){re.style.cssText='display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:var(--red)';re.textContent='✗ '+(r.error||r.message||'Test failed');}
    else{re.style.cssText='display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);color:var(--green)';re.textContent='✓ Test email sent!';}
  }catch(e){re.style.cssText='display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:var(--red)';re.textContent='✗ '+e.message;}
  finally{btn.textContent='📤 Send Test';btn.disabled=false;}
}

// ── Logs ───────────────────────────────────────────────────
function resetFilters(){['fl-status','fl-search','fl-from','fl-to'].forEach(id=>{document.getElementById(id).value='';});logsPage=0;fetchLogs();}
function changePage(d){logsPage=Math.max(0,logsPage+d);fetchLogs();}

async function fetchLogs(btn){
  if(btn){btn.textContent='⏳';btn.disabled=true;}
  const st=document.getElementById('fl-status').value;
  const se=document.getElementById('fl-search').value;
  const fr=document.getElementById('fl-from').value;
  const to=document.getElementById('fl-to').value;
  const p=new URLSearchParams({limit:logsPerPage,offset:logsPage*logsPerPage});
  if(st)p.set('status',st);if(se)p.set('search',se);if(fr)p.set('from',fr);if(to)p.set('to',to);
  try{
    const r=await api('/api/emails?'+p);
    const emails=r.emails||[];logsTotal=r.total||emails.length;
    renderLogs(emails);
    const start=logsPage*logsPerPage+1,end=Math.min(start+emails.length-1,logsTotal);
    document.getElementById('pag-info').textContent=emails.length?'Showing '+start+'–'+end+' of '+logsTotal:'No results';
    document.getElementById('btn-prev').disabled=logsPage===0;
    document.getElementById('btn-next').disabled=end>=logsTotal;
  }catch(e){toast('Logs error: '+e.message,false);}
  finally{if(btn){btn.textContent='🔍 Apply';btn.disabled=false;}}
}

function renderLogs(emails){
  const tb=document.getElementById('logs-body');
  if(!emails.length){tb.innerHTML='<tr><td colspan="8"><div class="empty-state">📭 No emails found</div></td></tr>';return;}
  tb.innerHTML=emails.map(e=>renderLogRow(e)).join('');
}

function renderLogRow(e){
  const to=Array.isArray(e.to)?e.to[0]:e.to;
  const errHtml=e.error_message?'<span class="err-text" title="'+esc(e.error_message)+'">'+esc(e.error_message)+'</span>':'';
  return '<tr class="log-row" onclick="toggleDetail(&#39;'+esc(e.id)+'&#39;)" id="row-'+esc(e.id)+'">'
    +'<td><span class="expand-caret" id="caret-'+esc(e.id)+'">▶</span></td>'
    +'<td class="mono" style="font-size:11px;color:var(--muted)">#'+esc(e.id)+'</td>'
    +'<td class="mono" style="font-size:12px">'+esc(to)+'</td>'
    +'<td>'+esc(e.subject||'(no subject)')+'</td>'
    +'<td>'+sbadge(e.status)+' '+errHtml+'</td>'
    +'<td class="mono" style="font-size:11px;color:var(--muted)">'+esc(e.provider_used||'—')+'</td>'
    +'<td class="mono" style="font-size:11px;color:var(--muted)">'+esc(e.from_email||'—')+'</td>'
    +'<td class="mono" style="font-size:11px;color:var(--muted)">'+fmt(e.created_at)+'</td>'
  +'</tr>'
  +'<tr class="detail-row" id="detail-'+esc(e.id)+'" style="display:none">'
    +'<td colspan="8">'+renderDetail(e)+'</td>'
  +'</tr>';
}

function renderDetail(e){
  let fhHtml='';
  try{
    const fh=typeof e.failover_history==='string'?JSON.parse(e.failover_history):e.failover_history;
    if(fh&&fh.length) fhHtml=fh.map((f,i)=>(i+1)+'. '+esc(f.provider||f.provider_id||f.name||'?')+' — '+esc(f.error||f.reason||'unknown')).join(String.fromCharCode(10));
  }catch(_){fhHtml=esc(String(e.failover_history||''));}
  const bid='body-'+e.id;
  return '<div class="detail-box">'
    +'<div class="detail-grid">'
      +'<div class="detail-blk"><div class="detail-lbl">Email ID</div><div class="detail-val mono">'+esc(e.id)+'</div></div>'
      +'<div class="detail-blk"><div class="detail-lbl">Status</div><div class="detail-val">'+sbadge(e.status)+(e.error_message?' — <span style="color:var(--red);font-size:12px">'+esc(e.error_message)+'</span>':'')+'</div></div>'
      +'<div class="detail-blk"><div class="detail-lbl">To</div><div class="detail-val mono">'+esc(Array.isArray(e.to)?e.to.join(', '):e.to)+'</div></div>'
      +'<div class="detail-blk"><div class="detail-lbl">From</div><div class="detail-val mono">'+esc(e.from_email||'—')+(e.from_name?' ('+esc(e.from_name)+')':'')+'</div></div>'
      +'<div class="detail-blk"><div class="detail-lbl">Provider Used</div><div class="detail-val mono">'+esc(e.provider_used||'—')+'</div></div>'
      +'<div class="detail-blk"><div class="detail-lbl">Created</div><div class="detail-val mono">'+fmt(e.created_at)+'</div></div>'
      +(e.cc?'<div class="detail-blk"><div class="detail-lbl">CC</div><div class="detail-val mono">'+esc(Array.isArray(e.cc)?e.cc.join(', '):e.cc)+'</div></div>':'')
      +(e.bcc?'<div class="detail-blk"><div class="detail-lbl">BCC</div><div class="detail-val mono">'+esc(Array.isArray(e.bcc)?e.bcc.join(', '):e.bcc)+'</div></div>':'')
    +'</div>'
    +(fhHtml?'<div class="detail-blk"><div class="detail-lbl">⚠️ Failover History</div><div class="detail-mono" style="color:var(--orange)">'+fhHtml+'</div></div>':'')
    +'<div class="detail-blk">'
      +'<div class="detail-lbl">Email Body</div>'
      +'<div class="dtabs">'
        +'<button class="dtab active" onclick="switchBodyTab(event,&#39;'+bid+'&#39;,&#39;html&#39;)">HTML Preview</button>'
        +'<button class="dtab" onclick="switchBodyTab(event,&#39;'+bid+'&#39;,&#39;raw&#39;)">Raw</button>'
      +'</div>'
      +'<div id="'+bid+'-html"><iframe class="preview-iframe" sandbox="" referrerpolicy="no-referrer" srcdoc="'+esc(e.html_body||e.text_body||'(empty)')+'"></iframe></div>'
      +'<div id="'+bid+'-raw" style="display:none"><div class="detail-mono">'+esc(e.html_body||e.text_body||'(empty)')+'</div></div>'
    +'</div>'
  +'</div>';
}

function switchBodyTab(ev,bid,tab){
  ev.target.closest('.detail-blk').querySelectorAll('.dtab').forEach(t=>t.classList.remove('active'));
  ev.target.classList.add('active');
  document.getElementById(bid+'-html').style.display=tab==='html'?'':'none';
  document.getElementById(bid+'-raw').style.display=tab==='raw'?'':'none';
}

function toggleDetail(id){
  const dr=document.getElementById('detail-'+id),cr=document.getElementById('caret-'+id);
  const hidden=dr.style.display==='none';
  dr.style.display=hidden?'':'none';
  cr.classList.toggle('rotated',hidden);
}

// ── Init ───────────────────────────────────────────────────
['ak-input','ak-input-hmac','sk-input'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('keydown',ev=>{if(ev.key==='Enter')doAuth();});
});
</script>
</body>
</html>`;
}
