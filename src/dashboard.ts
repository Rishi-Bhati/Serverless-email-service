export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsent – Email Service Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f17;
      --bg-card: #131924;
      --bg-card-subtle: #192231;
      --bg-input: #0e131c;
      --border: #232c3d;
      --border-subtle: #1c2433;
      --text: #f1f5f9;
      --muted: #8b9bb4;
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --green: #10b981;
      --red: #ef4444;
      --orange: #f59e0b;
      --cyan: #06b6d4;
      --ff-body: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --ff-mono: 'JetBrains Mono', monospace;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--ff-body);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* AUTH OVERLAY */
    #auth-overlay {
      position: fixed;
      inset: 0;
      background: rgba(11, 15, 23, 0.94);
      backdrop-filter: blur(8px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      padding: 20px;
    }

    .auth-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 36px 32px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }

    .auth-card h2 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 6px;
      color: var(--text);
    }

    .auth-card > p {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 24px;
    }

    .auth-mode-group {
      display: flex;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 3px;
      margin-bottom: 20px;
    }

    .auth-mode-btn {
      flex: 1;
      background: none;
      border: none;
      color: var(--muted);
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      transition: all 0.15s ease;
    }

    .auth-mode-btn.active {
      background: var(--primary);
      color: #fff;
    }

    .auth-hint {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 20px;
      line-height: 1.5;
      padding: 10px 14px;
      background: rgba(79, 70, 229, 0.08);
      border: 1px solid rgba(79, 70, 229, 0.2);
      border-radius: 8px;
    }

    /* INPUTS */
    .ig {
      margin-bottom: 16px;
      text-align: left;
    }

    .ig label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--muted);
    }

    .ifield {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-family: inherit;
      font-size: 14px;
      transition: border-color 0.15s ease;
      outline: none;
    }

    .ifield:focus {
      border-color: var(--primary);
    }

    select.ifield option {
      background: var(--bg-card);
    }

    textarea.ifield {
      resize: vertical;
      min-height: 80px;
      font-family: inherit;
    }

    /* BUTTONS */
    .btn {
      width: 100%;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 11px 16px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.15s ease;
      font-family: inherit;
    }

    .btn:hover {
      background: var(--primary-hover);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .bsm {
      padding: 6px 14px;
      font-size: 13px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      font-family: inherit;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .b-primary {
      background: var(--primary);
      color: #fff;
    }

    .b-primary:hover {
      background: var(--primary-hover);
    }

    .b-danger {
      background: rgba(239, 68, 68, 0.1);
      color: var(--red);
      border-color: rgba(239, 68, 68, 0.25);
    }

    .b-danger:hover {
      background: rgba(239, 68, 68, 0.2);
    }

    .b-warn {
      background: rgba(245, 158, 11, 0.1);
      color: var(--orange);
      border-color: rgba(245, 158, 11, 0.25);
    }

    .b-warn:hover {
      background: rgba(245, 158, 11, 0.2);
    }

    .b-ghost {
      background: transparent;
      color: var(--muted);
      border-color: var(--border);
    }

    .b-ghost:hover {
      color: var(--text);
      border-color: var(--muted);
      background: rgba(255, 255, 255, 0.03);
    }

    .ghost-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      transition: all 0.15s ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .ghost-btn:hover {
      border-color: var(--muted);
      color: var(--text);
    }

    .report-btn {
      color: var(--orange);
      border-color: rgba(245, 158, 11, 0.3);
      background: rgba(245, 158, 11, 0.06);
    }

    .report-btn:hover {
      border-color: var(--orange);
      background: rgba(245, 158, 11, 0.15);
      color: #fff;
    }

    /* HEADER */
    header {
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
      padding: 14px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .logo-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logo-badge {
      background: var(--primary);
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 15px;
      color: #fff;
    }

    .logo-text {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .logo-text span {
      color: var(--primary);
    }

    .nav-tabs {
      display: flex;
      gap: 4px;
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 3px;
    }

    .nav-tab {
      background: none;
      border: none;
      color: var(--muted);
      padding: 7px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      transition: all 0.15s ease;
    }

    .nav-tab.active {
      background: var(--primary);
      color: #fff;
    }

    .nav-tab:hover:not(.active) {
      color: var(--text);
    }

    .hdr-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .status-pill {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      color: var(--green);
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      background: var(--green);
      border-radius: 50%;
    }

    /* MAIN */
    main {
      flex: 1;
      padding: 28px 32px;
      max-width: 1360px;
      width: 100%;
      margin: 0 auto;
      display: grid;
      gap: 24px;
    }

    .view {
      display: none;
      flex-direction: column;
      gap: 24px;
    }

    .view.active {
      display: flex;
    }

    /* STATS */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
    }

    .stat-label {
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 30px;
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

    .stat-queued .stat-indicator { background: var(--cyan); }
    .stat-sending .stat-indicator { background: var(--orange); }
    .stat-sent .stat-indicator { background: var(--green); }
    .stat-failed .stat-indicator { background: var(--red); }

    /* CONTENT GRID */
    .content-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }

    @media (min-width: 1024px) {
      .content-grid {
        grid-template-columns: 1.6fr 1fr;
      }
    }

    .panel {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      flex-direction: column;
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 18px;
    }

    .panel-title {
      font-size: 16px;
      font-weight: 600;
    }

    /* TABLE */
    .table-wrap {
      overflow-x: auto;
      min-height: 160px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    th {
      color: var(--muted);
      font-weight: 600;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }

    td {
      padding: 13px 14px;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: middle;
    }

    tr:last-child td {
      border-bottom: none;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }

    .b-queued { background: rgba(6, 182, 212, 0.12); color: var(--cyan); }
    .b-sending { background: rgba(245, 158, 11, 0.12); color: var(--orange); }
    .b-sent { background: rgba(16, 185, 129, 0.12); color: var(--green); }
    .b-failed { background: rgba(239, 68, 68, 0.12); color: var(--red); }
    .b-active { background: rgba(16, 185, 129, 0.12); color: var(--green); }
    .b-disabled { background: rgba(148, 163, 184, 0.12); color: var(--muted); }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      padding: 48px 0;
      font-size: 13px;
    }

    .err-text {
      color: var(--red);
      font-size: 11px;
      font-family: var(--ff-mono);
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: help;
    }

    /* LOG DETAIL */
    .log-row {
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .log-row:hover {
      background: rgba(255, 255, 255, 0.02);
    }

    .expand-caret {
      transition: transform 0.2s ease;
      cursor: pointer;
      display: inline-block;
      font-size: 10px;
      color: var(--muted);
    }

    .expand-caret.rotated {
      transform: rotate(90deg);
    }

    .detail-row {
      background: rgba(11, 15, 23, 0.5);
    }

    .detail-box {
      padding: 20px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-left: 3px solid var(--primary);
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin: 8px 4px;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 14px;
    }

    @media (min-width: 768px) {
      .detail-grid {
        grid-template-columns: 1fr 1fr;
      }
    }

    .detail-blk {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .detail-lbl {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .detail-val {
      font-size: 13px;
      color: var(--text);
    }

    .detail-mono {
      font-family: var(--ff-mono);
      font-size: 12px;
      background: rgba(0, 0, 0, 0.25);
      padding: 10px 14px;
      border-radius: 6px;
      border: 1px solid var(--border);
      max-height: 180px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .dtabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      gap: 4px;
      margin-bottom: 8px;
    }

    .dtab {
      background: none;
      border: none;
      color: var(--muted);
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      border-bottom: 2px solid transparent;
      transition: all 0.15s ease;
      font-family: inherit;
    }

    .dtab.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }

    .preview-iframe {
      width: 100%;
      height: 250px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: #fff;
    }

    /* FILTER BAR */
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: center;
      margin-bottom: 18px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      padding: 16px 20px;
      border-radius: 12px;
    }

    .flbl {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 5px;
      display: block;
    }

    .finput {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      color: #fff;
      font-family: inherit;
      font-size: 13px;
      min-width: 140px;
      transition: border-color 0.15s ease;
    }

    .finput:focus {
      outline: none;
      border-color: var(--primary);
    }

    select.finput option {
      background: var(--bg-card);
    }

    .pag {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
    }

    .pag-info {
      font-size: 13px;
      color: var(--muted);
    }

    .pag-btns {
      display: flex;
      gap: 8px;
    }

    .pag-btn {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      transition: all 0.15s ease;
    }

    .pag-btn:hover:not(:disabled) {
      border-color: var(--primary);
      color: #fff;
    }

    .pag-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* QUOTA BAR */
    .qbar-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 120px;
    }

    .qbar-track {
      flex: 1;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
    }

    .qbar-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--green);
      transition: width 0.4s ease;
    }

    .qbar-fill.warn { background: var(--orange); }
    .qbar-fill.danger { background: var(--red); }
    .qbar-text { font-size: 12px; color: var(--muted); white-space: nowrap; }

    /* PROVIDER TYPE BADGE */
    .tbadge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .t-smtp { background: rgba(79, 70, 229, 0.15); color: #818cf8; }
    .t-resend { background: rgba(6, 182, 212, 0.15); color: var(--cyan); }
    .t-sendgrid { background: rgba(16, 185, 129, 0.15); color: var(--green); }
    .t-mailgun { background: rgba(245, 158, 11, 0.15); color: var(--orange); }
    .t-postmark { background: rgba(168, 85, 247, 0.15); color: #c084fc; }

    .def-badge {
      background: rgba(245, 158, 11, 0.12);
      color: var(--orange);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 6px;
    }

    .row-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* MODAL */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(11, 15, 23, 0.85);
      backdrop-filter: blur(6px);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 500;
      padding: 20px;
    }

    .modal-overlay.open {
      display: flex;
    }

    .modal-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 30px;
      width: 100%;
      max-width: 540px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    }

    .modal-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 20px;
    }

    .modal-footer {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 24px;
    }

    .cred-section {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin: 8px 0 16px;
      background: rgba(11, 15, 23, 0.3);
    }

    .cred-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .cbrow {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }

    .cbrow input[type=checkbox] {
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: var(--primary);
    }

    .cbrow label {
      font-size: 13px;
      cursor: pointer;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    @media (max-width: 640px) {
      .form-row {
        grid-template-columns: 1fr;
      }
    }

    /* QUICK REF */
    .qr-grid {
      display: grid;
      gap: 10px;
    }

    .qr-item {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .qr-lbl {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
    }

    .qr-val {
      font-family: var(--ff-mono);
      font-size: 12px;
      word-break: break-all;
    }

    /* API DOCS */
    .docs-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }

    .docs-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 14px;
    }

    pre {
      background: #080c13;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 18px;
      overflow-x: auto;
      font-family: var(--ff-mono);
      font-size: 12px;
      line-height: 1.6;
    }

    .hl-k { color: var(--cyan); }
    .hl-v { color: var(--green); }
    .hl-s { color: var(--orange); }
    .hl-c { color: #64748b; font-style: italic; }

    .ep-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 5px;
      font-size: 11px;
      font-weight: 700;
    }

    .ep-post { background: rgba(16, 185, 129, 0.15); color: var(--green); }
    .ep-get { background: rgba(6, 182, 212, 0.15); color: var(--cyan); }
    .ep-delete { background: rgba(239, 68, 68, 0.15); color: var(--red); }

    .ep-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border-subtle);
    }

    .ep-row:last-child {
      border-bottom: none;
    }

    .ep-path {
      font-family: var(--ff-mono);
      font-size: 13px;
    }

    .ep-desc {
      font-size: 13px;
      color: var(--muted);
      margin-left: auto;
    }

    .info-box {
      background: rgba(79, 70, 229, 0.08);
      border: 1px solid rgba(79, 70, 229, 0.2);
      border-radius: 8px;
      padding: 14px 18px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.6;
    }

    .info-box b {
      color: var(--text);
    }

    .sec-hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .sec-title {
      font-size: 18px;
      font-weight: 700;
    }

    hr.div {
      border: none;
      border-top: 1px solid var(--border);
      margin: 16px 0;
    }

    /* TOAST */
    #toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 20px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
      opacity: 0;
      transition: opacity 0.25s, transform 0.25s;
      z-index: 9999;
      pointer-events: none;
    }

    #toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    #toast.tok {
      border-color: rgba(16, 185, 129, 0.4);
      color: var(--green);
    }

    #toast.terr {
      border-color: rgba(239, 68, 68, 0.4);
      color: var(--red);
    }

    .mono {
      font-family: var(--ff-mono);
      font-size: 12px;
    }

    .docs-section {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
  </style>
</head>
<body>

<!-- AUTH OVERLAY -->
<div id="auth-overlay">
  <div class="auth-card">
    <h2>Sign In</h2>
    <p>Enter your credentials to access the dashboard</p>
    <div class="auth-mode-group">
      <button class="auth-mode-btn active" onclick="setAuthMode('apikey')" id="mbtn-apikey">API Key</button>
      <button class="auth-mode-btn" onclick="setAuthMode('hmac')" id="mbtn-hmac">Signed (HMAC)</button>
    </div>
    <div id="auth-apikey-form">
      <div class="ig">
        <label>API Key</label>
        <input class="ifield" type="password" id="ak-input" placeholder="Enter your API key" autocomplete="off">
      </div>
      <div class="auth-hint">Authenticate directly with your service API key.</div>
      <button class="btn" onclick="doAuth()">Sign In</button>
    </div>
    <div id="auth-hmac-form" style="display:none">
      <div class="ig">
        <label>API Key</label>
        <input class="ifield" type="password" id="ak-input-hmac" placeholder="Enter your API key" autocomplete="off">
      </div>
      <div class="ig">
        <label>Secret Key</label>
        <input class="ifield" type="password" id="sk-input" placeholder="Enter your secret key" autocomplete="off">
      </div>
      <div class="auth-hint">Authenticate using your API key and secret key.</div>
      <button class="btn" onclick="doAuth()">Sign In</button>
    </div>
    <p id="auth-err" style="color:var(--red);margin-top:14px;font-size:13px;display:none"></p>
    <div id="local-dev-hint" style="display:none;margin-top:16px;padding:12px;background:rgba(79,70,229,0.08);border:1px solid rgba(79,70,229,0.2);border-radius:8px;font-size:12px;text-align:left;">
      <div style="font-weight:600;color:var(--text);margin-bottom:4px;">Local Development Detected</div>
      <div style="color:var(--muted);margin-bottom:8px;">Running on localhost. Sign in with the dev key from <code>.dev.vars</code>:</div>
      <button type="button" class="bsm b-primary" style="width:100%;justify-content:center;" onclick="useDevKey()">Sign In with Local Dev Key</button>
    </div>
  </div>
</div>

<!-- HEADER -->
<header>
  <div class="logo-wrap">
    <div class="logo-badge">✉</div>
    <div class="logo-text">Unsent <span>Email</span></div>
  </div>
  <nav class="nav-tabs">
    <button class="nav-tab active" onclick="switchView('v-dash')" id="tab-dash">Dashboard</button>
    <button class="nav-tab" onclick="switchView('v-prov')" id="tab-prov">Providers</button>
    <button class="nav-tab" onclick="switchView('v-logs')" id="tab-logs">Logs</button>
    <button class="nav-tab" onclick="switchView('v-docs')" id="tab-docs">API Docs</button>
  </nav>
  <div class="hdr-right">
    <div class="status-pill"><div class="status-dot"></div> Online</div>
    <a href="https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/" target="_blank" rel="noopener noreferrer" class="ghost-btn report-btn">Report Issue</a>
    <button class="ghost-btn" onclick="logout()">Log Out</button>
  </div>
</header>

<main>

<!-- VIEW: DASHBOARD -->
<div id="v-dash" class="view active">
  <div class="stats-grid">
    <div class="stat-card stat-queued">
      <div class="stat-indicator"></div>
      <div class="stat-label">Queued</div>
      <div class="stat-value" id="st-queued">—</div>
    </div>
    <div class="stat-card stat-sending">
      <div class="stat-indicator"></div>
      <div class="stat-label">Sending</div>
      <div class="stat-value" id="st-sending">—</div>
    </div>
    <div class="stat-card stat-sent">
      <div class="stat-indicator"></div>
      <div class="stat-label">Delivered</div>
      <div class="stat-value" id="st-sent">—</div>
    </div>
    <div class="stat-card stat-failed">
      <div class="stat-indicator"></div>
      <div class="stat-label">Failed</div>
      <div class="stat-value" id="st-failed">—</div>
    </div>
  </div>

  <div class="content-grid">
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Recent Emails</div>
        <button class="ghost-btn" onclick="fetchDash(this)">Refresh</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:30px"></th>
              <th>Recipient</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody id="dash-emails">
            <tr><td colspan="6"><div class="empty-state">Loading emails…</div></td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Send Test Email</div></div>
      <form onsubmit="sendTest(event)">
        <div class="ig">
          <label>Recipient Email</label>
          <input class="ifield" type="email" id="te-to" placeholder="recipient@example.com" required>
        </div>
        <div class="ig">
          <label>Subject</label>
          <input class="ifield" type="text" id="te-subj" placeholder="Test email subject">
        </div>
        <div class="ig">
          <label>Message Body (HTML)</label>
          <textarea class="ifield" id="te-body" rows="3" placeholder="<p>Test email message content</p>"></textarea>
        </div>
        <div class="ig">
          <label>Send via Provider (Optional)</label>
          <select class="ifield" id="te-prov">
            <option value="">Auto (Default priority)</option>
          </select>
        </div>
        <button class="btn" type="submit" id="te-btn">Send Test Email</button>
      </form>
      <hr class="div">
      <div class="panel-title" style="margin-bottom:12px">Service Information</div>
      <div class="qr-grid">
        <div class="qr-item"><div class="qr-lbl">API Base URL</div><div class="qr-val" id="qr-base">—</div></div>
        <div class="qr-item"><div class="qr-lbl">Authentication Mode</div><div class="qr-val" id="qr-auth">—</div></div>
        <div class="qr-item"><div class="qr-lbl">Active Providers</div><div class="qr-val" id="qr-provs">—</div></div>
      </div>
    </div>
  </div>
</div>

<!-- VIEW: PROVIDERS -->
<div id="v-prov" class="view">
  <div class="sec-hdr">
    <div class="sec-title">Email Providers</div>
    <button class="bsm b-primary" onclick="openAddProv()">Add Provider</button>
  </div>
  <div class="info-box">
    The <b>default provider</b> is tried first. If a provider reaches its daily limit or encounters an issue, the service automatically fails over to the next active provider in priority order.
  </div>
  <div class="panel" style="padding:0">
    <div class="panel-header" style="padding:20px 24px 16px">
      <div class="panel-title">Configured Providers</div>
      <button class="ghost-btn" onclick="fetchProviders(this)">Refresh</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:40px">#</th>
            <th>Name</th>
            <th>Type</th>
            <th>From Email</th>
            <th>Daily Limit</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="prov-body">
          <tr><td colspan="7"><div class="empty-state">Loading providers…</div></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- VIEW: LOGS -->
<div id="v-logs" class="view">
  <div class="sec-hdr">
    <div class="sec-title">Delivery Logs</div>
    <div style="display:flex;gap:8px;">
      <button class="bsm b-ghost" onclick="exportLogs('jsonl')">Export JSONL</button>
      <button class="bsm b-ghost" onclick="exportLogs('csv')">Export CSV</button>
    </div>
  </div>
  <div class="filter-bar">
    <div>
      <label class="flbl">Status</label>
      <select class="finput" id="fl-status">
        <option value="">All Statuses</option>
        <option value="queued">Queued</option>
        <option value="sending">Sending</option>
        <option value="sent">Sent</option>
        <option value="failed">Failed</option>
      </select>
    </div>
    <div>
      <label class="flbl">Search</label>
      <input class="finput" type="text" id="fl-search" placeholder="Recipient or subject…">
    </div>
    <div>
      <label class="flbl">From Date</label>
      <input class="finput" type="date" id="fl-from">
    </div>
    <div>
      <label class="flbl">To Date</label>
      <input class="finput" type="date" id="fl-to">
    </div>
    <div style="display:flex;gap:8px;align-items:flex-end;margin-left:auto">
      <button class="bsm b-primary" onclick="fetchLogs(this)">Apply</button>
      <button class="bsm b-ghost" onclick="resetFilters()">Clear</button>
    </div>
  </div>
  <div class="panel" style="padding:0">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:30px"></th>
            <th>ID</th>
            <th>Recipient</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Provider</th>
            <th>From</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody id="logs-body">
          <tr><td colspan="8"><div class="empty-state">Loading logs…</div></td></tr>
        </tbody>
      </table>
    </div>
    <div class="pag">
      <div class="pag-info" id="pag-info">—</div>
      <div class="pag-btns">
        <button class="pag-btn" id="btn-prev" onclick="changePage(-1)" disabled>Previous</button>
        <button class="pag-btn" id="btn-next" onclick="changePage(1)" disabled>Next</button>
      </div>
    </div>
  </div>
</div>

<!-- VIEW: API DOCS -->
<div id="v-docs" class="view">
  <div class="docs-section">
    <div class="docs-card">
      <div class="docs-title">API Quick Start</div>
      <p style="color:var(--muted);font-size:13px;margin-bottom:16px">Send an email by making a POST request to <code>/api/send</code>. The service queues and dispatches the email asynchronously.</p>
      <pre><span class="hl-c">// POST /api/send</span>
<span class="hl-k">POST</span> /api/send
<span class="hl-k">X-API-Key:</span> <span class="hl-s">your-api-key</span>
<span class="hl-k">Content-Type:</span> <span class="hl-v">application/json</span>

{
  <span class="hl-k">"to":</span>      <span class="hl-s">"recipient@example.com"</span>,
  <span class="hl-k">"subject":</span> <span class="hl-s">"Welcome!"</span>,
  <span class="hl-k">"html":</span>    <span class="hl-s">"&lt;p&gt;Hello from the email service&lt;/p&gt;"</span>
}</pre>
    </div>

    <div class="docs-card">
      <div class="docs-title">Available Endpoints</div>
      <div class="ep-row"><span class="ep-badge ep-post">POST</span><span class="ep-path">/api/send</span><span class="ep-desc">Queue an email for delivery</span></div>
      <div class="ep-row"><span class="ep-badge ep-get">GET</span><span class="ep-path">/api/status</span><span class="ep-desc">Get queue status and counts</span></div>
      <div class="ep-row"><span class="ep-badge ep-get">GET</span><span class="ep-path">/api/emails</span><span class="ep-desc">List delivery logs with filters</span></div>
      <div class="ep-row"><span class="ep-badge ep-get">GET</span><span class="ep-path">/api/emails/:id</span><span class="ep-desc">Get details for a specific email</span></div>
      <div class="ep-row"><span class="ep-badge ep-delete">DELETE</span><span class="ep-path">/api/emails/:id</span><span class="ep-desc">Delete an email record</span></div>
      <div class="ep-row"><span class="ep-badge ep-get">GET</span><span class="ep-path">/api/providers</span><span class="ep-desc">List configured providers</span></div>
    </div>
  </div>
</div>

</main>

<!-- PROVIDER MODAL -->
<div class="modal-overlay" id="prov-modal">
  <div class="modal-card">
    <div class="modal-title" id="prov-modal-title">Add Provider</div>
    <form id="prov-form" onsubmit="saveProv(event)">
      <input type="hidden" id="prov-editing-id">
      <div class="form-row">
        <div class="ig"><label>Provider ID *</label><input class="ifield" type="text" id="pf-id" placeholder="e.g. smtp_main" pattern="[a-zA-Z0-9_-]+" required></div>
        <div class="ig"><label>Display Name *</label><input class="ifield" type="text" id="pf-name" placeholder="e.g. Primary SMTP" required></div>
      </div>
      <div class="ig">
        <label>Provider Type *</label>
        <select class="ifield" id="pf-type" onchange="onTypeChange()" required>
          <option value="">Select a provider type</option>
          <option value="smtp">SMTP</option>
          <option value="resend">Resend</option>
          <option value="sendgrid">SendGrid</option>
          <option value="mailgun">Mailgun</option>
          <option value="postmark">Postmark</option>
        </select>
      </div>
      <div class="form-row">
        <div class="ig"><label>From Email Address *</label><input class="ifield" type="email" id="pf-from-email" placeholder="noreply@yourdomain.com" required></div>
        <div class="ig"><label>From Name</label><input class="ifield" type="text" id="pf-from-name" placeholder="Company Name"></div>
      </div>
      <div class="form-row">
        <div class="ig"><label>Priority (Lower number = tried first)</label><input class="ifield" type="number" id="pf-priority" value="10" min="1"></div>
        <div class="ig"><label>Daily Send Limit (0 = Unlimited)</label><input class="ifield" type="number" id="pf-daily" value="0" min="0"></div>
      </div>
      <div class="cbrow"><input type="checkbox" id="pf-default"><label for="pf-default">Set as default provider</label></div>
      <div class="cbrow"><input type="checkbox" id="pf-active" checked><label for="pf-active">Enable this provider</label></div>

      <!-- SMTP Credentials -->
      <div class="cred-section" id="cred-smtp" style="display:none">
        <div class="cred-title">SMTP Settings</div>
        <div class="form-row">
          <div class="ig" style="margin-bottom:0"><label>Host *</label><input class="ifield" type="text" id="cs-host" placeholder="smtp.gmail.com"></div>
          <div class="ig" style="margin-bottom:0"><label>Port</label><input class="ifield" type="number" id="cs-port" value="587"></div>
        </div>
        <div style="height:12px"></div>
        <div class="form-row">
          <div class="ig" style="margin-bottom:0"><label>Username *</label><input class="ifield" type="text" id="cs-user" placeholder="username or email"></div>
          <div class="ig" style="margin-bottom:0"><label>Password *</label><input class="ifield" type="password" id="cs-pass" placeholder="password or app key"></div>
        </div>
      </div>

      <!-- Resend -->
      <div class="cred-section" id="cred-resend" style="display:none">
        <div class="cred-title">Resend Settings</div>
        <div class="ig" style="margin-bottom:0"><label>API Key *</label><input class="ifield" type="password" id="cr-key" placeholder="re_…"></div>
      </div>

      <!-- SendGrid -->
      <div class="cred-section" id="cred-sendgrid" style="display:none">
        <div class="cred-title">SendGrid Settings</div>
        <div class="ig" style="margin-bottom:0"><label>API Key *</label><input class="ifield" type="password" id="csg-key" placeholder="SG.…"></div>
      </div>

      <!-- Mailgun -->
      <div class="cred-section" id="cred-mailgun" style="display:none">
        <div class="cred-title">Mailgun Settings</div>
        <div class="form-row">
          <div class="ig" style="margin-bottom:0"><label>API Key *</label><input class="ifield" type="password" id="cmg-key" placeholder="key-…"></div>
          <div class="ig" style="margin-bottom:0"><label>Domain *</label><input class="ifield" type="text" id="cmg-domain" placeholder="mg.yourdomain.com"></div>
        </div>
        <div style="height:12px"></div>
        <div class="ig" style="margin-bottom:0"><label>Region</label><select class="ifield" id="cmg-region"><option value="us">US (api.mailgun.net)</option><option value="eu">EU (api.eu.mailgun.net)</option></select></div>
      </div>

      <!-- Postmark -->
      <div class="cred-section" id="cred-postmark" style="display:none">
        <div class="cred-title">Postmark Settings</div>
        <div class="ig" style="margin-bottom:0"><label>Server Token *</label><input class="ifield" type="password" id="cpm-token" placeholder="token"></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="bsm b-ghost" onclick="closeProv()">Cancel</button>
        <button type="submit" class="bsm b-primary" id="prov-save-btn">Save Provider</button>
      </div>
    </form>
  </div>
</div>

<!-- TEST PROVIDER MODAL -->
<div class="modal-overlay" id="test-prov-modal">
  <div class="modal-card" style="max-width:440px">
    <div class="modal-title">Test Provider</div>
    <p style="color:var(--muted);font-size:13px;margin-bottom:18px" id="tp-desc">Send a test email to verify that this provider works properly.</p>
    <form onsubmit="execTest(event)">
      <input type="hidden" id="tp-id">
      <div class="ig"><label>Send Test To *</label><input class="ifield" type="email" id="tp-to" placeholder="recipient@example.com" required></div>
      <div id="tp-result" style="display:none;padding:12px;border-radius:8px;font-size:13px;margin-bottom:14px"></div>
      <div class="modal-footer">
        <button type="button" class="bsm b-ghost" onclick="closeTestProv()">Close</button>
        <button type="submit" class="bsm b-primary" id="tp-btn">Send Test Email</button>
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
  const res=await fetch(path,{method,headers:hdrs,body:bodyStr||undefined,credentials:'omit'});
  const ct=res.headers.get('content-type')||'';
  if(ct.includes('application/json')) return res.json();
  return {_status:res.status,_text:await res.text()};
}
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').split(String.fromCharCode(96)).join('&#96;').split(String.fromCharCode(47)).join('&#47;').split(String.fromCharCode(92)).join('&#92;');
const fmt=iso=>{if(!iso)return'—';const d=new Date(iso);return d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})};
function sbadge(s){const m={queued:'b-queued',sending:'b-sending',sent:'b-sent',failed:'b-failed'};return '<span class="badge '+(m[s]||'')+'">'+esc(s)+'</span>';}
function tbadge(t){return '<span class="tbadge t-'+esc(t)+'">'+esc(t)+'</span>';}
function qbar(sent,lim){
  if(!lim)return'<span class="qbar-text">Unlimited</span>';
  const p=Math.min(100,Math.round(sent/lim*100));
  const c=p>=90?'danger':p>=70?'warn':'';
  return '<div class="qbar-wrap"><div class="qbar-track"><div class="qbar-fill '+c+'" style="width:'+p+'%"></div></div><span class="qbar-text">'+sent+' / '+lim+'</span></div>';
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
    if(!authToken){errEl.textContent='Please enter your API Key';errEl.style.display='';return;}
  }else{
    authToken=document.getElementById('ak-input-hmac').value.trim()||document.getElementById('ak-input').value.trim();
    authSecret=document.getElementById('sk-input').value.trim();
    if(!authToken){errEl.textContent='Please enter your API Key';errEl.style.display='';return;}
    if(!authSecret){errEl.textContent='Please enter your Secret Key';errEl.style.display='';return;}
  }
  try{
    const r=await api('/api/status');
    if(r.error){errEl.textContent='Authentication failed: '+(r.reason||r.error);errEl.style.display='';return;}
    sessionStorage.setItem('unsent_api_key', authToken);
    if(authSecret) sessionStorage.setItem('unsent_api_secret', authSecret);
    sessionStorage.setItem('unsent_auth_mode', authMode);
    document.getElementById('auth-overlay').style.display='none';
    document.getElementById('qr-base').textContent=window.location.origin;
    document.getElementById('qr-auth').textContent=authMode==='apikey'?'API Key':'Signed (HMAC)';
    fetchDash(); fetchProviders();
  }catch(e){errEl.textContent='Unable to connect: '+e.message;errEl.style.display='';}
}
function logout(){
  authToken='';authSecret='';
  sessionStorage.removeItem('unsent_api_key');
  sessionStorage.removeItem('unsent_api_secret');
  sessionStorage.removeItem('unsent_auth_mode');
  document.getElementById('auth-overlay').style.display='';
}

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
  if(btn){btn.textContent='Loading…';btn.disabled=true;}
  try{
    const[st,em]=await Promise.all([api('/api/status'),api('/api/emails?limit=10')]);
    document.getElementById('st-queued').textContent=st.queued??'—';
    document.getElementById('st-sending').textContent=st.sending??'—';
    document.getElementById('st-sent').textContent=st.sent??'—';
    document.getElementById('st-failed').textContent=st.failed??'—';
    const tb=document.getElementById('dash-emails');
    const emails=em.emails||[];
    if(!emails.length){tb.innerHTML='<tr><td colspan="6"><div class="empty-state">No emails found in queue</div></td></tr>';return;}
    tb.innerHTML=emails.map(e=>renderLogRow(e,'dash-',6)).join('');
  }catch(e){toast('Error loading dashboard: '+e.message,false);}
  finally{if(btn){btn.textContent='Refresh';btn.disabled=false;}}
}

// ── Test Email ─────────────────────────────────────────────
async function sendTest(ev){
  ev.preventDefault();
  const btn=document.getElementById('te-btn');btn.textContent='Sending…';btn.disabled=true;
  const to=document.getElementById('te-to').value.trim();
  const subj=document.getElementById('te-subj').value.trim()||'Test Email';
  const html=document.getElementById('te-body').value.trim()||'<p>This is a test email.</p>';
  const provId=document.getElementById('te-prov').value;
  try{
    const payload={to,subject:subj,html};
    if(provId) payload.provider_id=provId;
    const qual=provId?'provider:'+provId:'';
    const opts={method:'POST',body:payload,qual};
    if(provId) opts.provId=provId;
    const r=await api('/api/send',opts);
    if(r.error) toast('Error: '+r.error,false); else toast('Email queued successfully');
  }catch(e){toast('Failed to send: '+e.message,false);}
  finally{btn.textContent='Send Test Email';btn.disabled=false;}
}

// ── Providers ──────────────────────────────────────────────
async function fetchProviders(btn){
  if(btn){btn.textContent='Loading…';btn.disabled=true;}
  try{
    const r=await api('/api/providers');
    provsCache=r.providers||[];
    renderProvs(provsCache);
    fillTestSelect(provsCache);
    document.getElementById('qr-provs').textContent=provsCache.filter(p=>p.is_active).length+' active';
  }catch(e){toast('Error loading providers: '+e.message,false);}
  finally{if(btn){btn.textContent='Refresh';btn.disabled=false;}}
}

function renderProvs(provs){
  const tb=document.getElementById('prov-body');
  if(!provs.length){tb.innerHTML='<tr><td colspan="7"><div class="empty-state">No providers configured yet. Click "Add Provider" to begin.</div></td></tr>';return;}
  tb.innerHTML=provs.map((p,i)=>{
    const defBadge=p.is_default?'<span class="def-badge">Default</span>':'';
    const ab=p.is_active?'<span class="badge b-active">Active</span>':'<span class="badge b-disabled">Disabled</span>';
    const setDefBtn=!p.is_default?'<button class="bsm b-ghost" onclick="setDefault(&#39;'+esc(p.id)+'&#39;)">Make Default</button>':'';
    return '<tr>'
      +'<td style="text-align:center;font-weight:600;color:var(--muted)">'+(i+1)+'</td>'
      +'<td><b>'+esc(p.name)+'</b> '+defBadge+'<br><span class="mono" style="font-size:11px;color:var(--muted)">'+esc(p.id)+'</span></td>'
      +'<td>'+tbadge(p.type)+'</td>'
      +'<td class="mono" style="font-size:12px">'+esc(p.from_email||'—')+'</td>'
      +'<td>'+qbar(p.daily_sent_count||0,p.daily_limit||0)+'</td>'
      +'<td>'+ab+'</td>'
      +'<td><div class="row-actions">'
        +setDefBtn
        +'<button class="bsm b-ghost" onclick="openTestProvById(&#39;'+esc(p.id)+'&#39;)">Test</button>'
        +'<button class="bsm b-ghost" onclick="openEditProv(&#39;'+esc(p.id)+'&#39;)">Edit</button>'
        +'<button class="bsm b-danger" onclick="delProvById(&#39;'+esc(p.id)+'&#39;)">Delete</button>'
      +'</div></td>'
    +'</tr>';
  }).join('');
}

function fillTestSelect(provs){
  const sel=document.getElementById('te-prov');
  const cur=sel.value;
  sel.innerHTML='<option value="">Auto (Default priority)</option>';
  provs.filter(p=>p.is_active).forEach(p=>{
    const o=document.createElement('option');
    o.value=p.id;o.textContent=(p.is_default?'[Default] ':'')+p.name+' ('+p.type+')';
    sel.appendChild(o);
  });
  if(cur) sel.value=cur;
}

function openAddProv(){
  document.getElementById('prov-modal-title').textContent='Add Provider';
  document.getElementById('prov-editing-id').value='';
  document.getElementById('prov-form').reset();
  document.getElementById('pf-active').checked=true;
  document.getElementById('pf-id').readOnly=false;
  onTypeChange();
  document.getElementById('prov-modal').classList.add('open');
}

function openEditProv(id){
  const p=provsCache.find(x=>x.id===id);if(!p){toast('Provider not found',false);return;}
  document.getElementById('prov-modal-title').textContent='Edit Provider';
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
  if(p.type==='smtp'){document.getElementById('cs-host').value=c.host||'';document.getElementById('cs-port').value=c.port||587;document.getElementById('cs-user').value=c.username||'';document.getElementById('cs-pass').placeholder=c.password||'Leave blank to keep unchanged';}
  else if(p.type==='resend') document.getElementById('cr-key').placeholder=c.api_key||'Leave blank to keep unchanged';
  else if(p.type==='sendgrid') document.getElementById('csg-key').placeholder=c.api_key||'Leave blank to keep unchanged';
  else if(p.type==='mailgun'){document.getElementById('cmg-key').placeholder=c.api_key||'Leave blank to keep unchanged';document.getElementById('cmg-domain').value=c.domain||'';document.getElementById('cmg-region').value=c.region||'us';}
  else if(p.type==='postmark') document.getElementById('cpm-token').placeholder=c.server_token||'Leave blank to keep unchanged';
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
  const btn=document.getElementById('prov-save-btn');btn.textContent='Saving…';btn.disabled=true;
  const isEdit=!!document.getElementById('prov-editing-id').value;
  const t=document.getElementById('pf-type').value;
  let creds={};
  if(t==='smtp'){
    creds={host:document.getElementById('cs-host').value.trim(),port:parseInt(document.getElementById('cs-port').value)||587,username:document.getElementById('cs-user').value.trim()};
    const pw=document.getElementById('cs-pass').value;
    if(pw) creds.password=pw;
    else if(isEdit) creds.password='••••••••';
  }else if(t==='resend'){
    const k=document.getElementById('cr-key').value;
    if(k) creds.api_key=k;
    else if(isEdit) creds.api_key='••••••••';
  }else if(t==='sendgrid'){
    const k=document.getElementById('csg-key').value;
    if(k) creds.api_key=k;
    else if(isEdit) creds.api_key='••••••••';
  }else if(t==='mailgun'){
    const k=document.getElementById('cmg-key').value;
    if(k) creds.api_key=k;
    else if(isEdit) creds.api_key='••••••••';
    creds.domain=document.getElementById('cmg-domain').value.trim();
    creds.region=document.getElementById('cmg-region').value;
  }else if(t==='postmark'){
    const k=document.getElementById('cpm-token').value;
    if(k) creds.server_token=k;
    else if(isEdit) creds.server_token='••••••••';
  }
  const payload={id:document.getElementById('pf-id').value.trim(),name:document.getElementById('pf-name').value.trim(),type:t,from_email:document.getElementById('pf-from-email').value.trim(),from_name:document.getElementById('pf-from-name').value.trim(),priority:parseInt(document.getElementById('pf-priority').value)||10,daily_limit:parseInt(document.getElementById('pf-daily').value)||0,is_default:document.getElementById('pf-default').checked,is_active:document.getElementById('pf-active').checked,credentials:creds};
  try{
    const r=await api('/api/providers',{method:isEdit?'PUT':'POST',body:payload});
    if(r.error){toast('Error: '+r.error,false);return;}
    toast(isEdit?'Provider updated':'Provider added');
    closeProv();fetchProviders();
  }catch(e){toast('Failed: '+e.message,false);}
  finally{btn.textContent='Save Provider';btn.disabled=false;}
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
    toast('Default provider updated');fetchProviders();
  }catch(e){toast('Failed: '+e.message,false);}
}

function openTestProv(id,name,fromEmail){
  document.getElementById('tp-id').value=id;
  document.getElementById('tp-desc').textContent='Send a test email to verify that "'+name+'" ('+fromEmail+') is working.';
  document.getElementById('tp-result').style.display='none';
  document.getElementById('tp-to').value='';
  document.getElementById('test-prov-modal').classList.add('open');
}
function closeTestProv(){document.getElementById('test-prov-modal').classList.remove('open');}
async function execTest(ev){
  ev.preventDefault();
  const btn=document.getElementById('tp-btn');btn.textContent='Sending…';btn.disabled=true;
  const re=document.getElementById('tp-result');re.style.display='none';
  try{
    const r=await api('/api/providers/test',{method:'POST',body:{provider_id:document.getElementById('tp-id').value,to:document.getElementById('tp-to').value.trim()}});
    if(r.error||!r.success){re.style.cssText='display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:var(--red)';re.textContent='✗ '+(r.error||r.message||'Test failed');}
    else{re.style.cssText='display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px;background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);color:var(--green)';re.textContent='✓ Test email sent successfully!';}
  }catch(e){re.style.cssText='display:block;padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:var(--red)';re.textContent='✗ '+e.message;}
  finally{btn.textContent='Send Test Email';btn.disabled=false;}
}

// ── Logs ───────────────────────────────────────────────────
let currentLogsCache = [];
function resetFilters(){['fl-status','fl-search','fl-from','fl-to'].forEach(id=>{document.getElementById(id).value='';});logsPage=0;fetchLogs();}
function changePage(d){logsPage=Math.max(0,logsPage+d);fetchLogs();}

async function fetchLogs(btn){
  if(btn){btn.textContent='Filtering…';btn.disabled=true;}
  const st=document.getElementById('fl-status').value;
  const se=document.getElementById('fl-search').value;
  const fr=document.getElementById('fl-from').value;
  const to=document.getElementById('fl-to').value;
  const p=new URLSearchParams({limit:logsPerPage,offset:logsPage*logsPerPage});
  if(st)p.set('status',st);if(se)p.set('search',se);if(fr)p.set('from',fr);if(to)p.set('to',to);
  try{
    const r=await api('/api/emails?'+p);
    const emails=r.emails||[];logsTotal=r.total||emails.length;
    currentLogsCache=emails;
    renderLogs(emails);
    const start=logsPage*logsPerPage+1,end=Math.min(start+emails.length-1,logsTotal);
    document.getElementById('pag-info').textContent=emails.length?'Showing '+start+'–'+end+' of '+logsTotal:'No logs found';
    document.getElementById('btn-prev').disabled=logsPage===0;
    document.getElementById('btn-next').disabled=end>=logsTotal;
  }catch(e){toast('Error loading logs: '+e.message,false);}
  finally{if(btn){btn.textContent='Apply';btn.disabled=false;}}
}

function sanitizeCsvCell(val){
  if(val===null||val===undefined)return '""';
  let str=typeof val==='object'?JSON.stringify(val):String(val);
  const dangerous=['=', '+', '-', '@', String.fromCharCode(9), String.fromCharCode(13)];
  if(str.length>0 && dangerous.indexOf(str.charAt(0))!==-1) str="'"+str;
  return '"'+str.replace(/"/g,'""')+'"';
}

function exportCsv(emails){
  if(!emails||!emails.length){toast('No logs available to export',false);return;}
  const headers=['ID','Date','Status','Recipient','Subject','Provider','From','Attempts','Error'];
  const headerRow=headers.map(sanitizeCsvCell).join(',');
  const rows=emails.map(e=>{
    const to=Array.isArray(e.to)?e.to.join(', '):(e.to||'');
    return [
      sanitizeCsvCell(e.id),
      sanitizeCsvCell(e.created_at?new Date(e.created_at).toISOString():''),
      sanitizeCsvCell(e.status),
      sanitizeCsvCell(to),
      sanitizeCsvCell(e.subject||''),
      sanitizeCsvCell(e.provider_used||''),
      sanitizeCsvCell(e.from_email||''),
      sanitizeCsvCell(e.attempts||0),
      sanitizeCsvCell(e.error_message||e.error||'')
    ].join(',');
  });
  const newline = String.fromCharCode(13, 10);
  const bom = String.fromCharCode(0xFEFF);
  const blob=new Blob([bom+[headerRow,...rows].join(newline)],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='delivery_logs_'+(new Date().toISOString().slice(0,10))+'.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Logs exported to CSV');
}

function exportJsonl(emails){
  if(!emails||!emails.length){toast('No logs available to export',false);return;}
  const nl = String.fromCharCode(10);
  const content=emails.map(e=>JSON.stringify(e)).join(nl)+nl;
  const blob=new Blob([content],{type:'application/x-ndjson;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='delivery_logs_'+(new Date().toISOString().slice(0,10))+'.jsonl';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Logs exported to JSONL');
}

function exportLogs(fmt){
  if(fmt==='csv')exportCsv(currentLogsCache);
  else exportJsonl(currentLogsCache);
}

function renderLogs(emails){
  const tb=document.getElementById('logs-body');
  if(!emails.length){tb.innerHTML='<tr><td colspan="8"><div class="empty-state">No delivery logs found</div></td></tr>';return;}
  tb.innerHTML=emails.map(e=>renderLogRow(e,'logs-',8)).join('');
}

function renderLogRow(e, pfx='', colspan=8){
  const to=Array.isArray(e.to)?e.to[0]:e.to;
  const errHtml=e.error_message?'<span class="err-text" title="'+esc(e.error_message)+'">'+esc(e.error_message)+'</span>':'';
  const rowId='row-'+pfx+esc(e.id);
  const detailId='detail-'+pfx+esc(e.id);
  const caretId='caret-'+pfx+esc(e.id);
  return '<tr class="log-row" onclick="toggleDetail(&#39;'+esc(e.id)+'&#39;,&#39;'+pfx+'&#39;)" id="'+rowId+'">'
    +'<td><span class="expand-caret" id="'+caretId+'">▶</span></td>'
    +(colspan===8?'<td class="mono" style="font-size:11px;color:var(--muted)">#'+esc(e.id)+'</td>':'')
    +'<td class="mono" style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+esc(to)+'">'+esc(to)+'</td>'
    +'<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+esc(e.subject||'')+'">'+esc(e.subject||'(no subject)')+'</td>'
    +'<td>'+sbadge(e.status)+' '+errHtml+'</td>'
    +'<td class="mono" style="font-size:11px;color:var(--muted)">'+esc(e.provider_used||'—')+'</td>'
    +(colspan===8?'<td class="mono" style="font-size:11px;color:var(--muted)">'+esc(e.from_email||'—')+'</td>':'')
    +'<td class="mono" style="font-size:11px;color:var(--muted)">'+fmt(e.created_at)+'</td>'
  +'</tr>'
  +'<tr class="detail-row" id="'+detailId+'" style="display:none">'
    +'<td colspan="'+colspan+'">'+renderDetail(e, pfx)+'</td>'
  +'</tr>';
}

function renderDetail(e, pfx=''){
  let fhHtml='';
  try{
    const fh=typeof e.failover_history==='string'?JSON.parse(e.failover_history):e.failover_history;
    if(fh&&fh.length) fhHtml=fh.map((f,i)=>(i+1)+'. '+esc(f.provider||f.provider_id||f.name||'?')+' — '+esc(f.error||f.reason||'unknown')).join(String.fromCharCode(10));
  }catch(_){fhHtml=esc(String(e.failover_history||''));}
  const bid='body-'+pfx+e.id;
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
    +(fhHtml?'<div class="detail-blk"><div class="detail-lbl">Delivery Errors & Retries</div><div class="detail-mono" style="color:var(--orange)">'+fhHtml+'</div></div>':'')
    +'<div class="detail-blk">'
      +'<div class="detail-lbl">Email Body</div>'
      +'<div class="dtabs">'
        +'<button class="dtab active" onclick="switchBodyTab(event,&#39;'+bid+'&#39;,&#39;html&#39;)">Preview</button>'
        +'<button class="dtab" onclick="switchBodyTab(event,&#39;'+bid+'&#39;,&#39;raw&#39;)">HTML Source</button>'
      +'</div>'
      +'<div id="'+bid+'-html"><iframe class="preview-iframe" sandbox="allow-popups" referrerpolicy="no-referrer" srcdoc="'+esc(e.html_body||e.text_body||'(empty)')+'"></iframe></div>'
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

function toggleDetail(id, pfx=''){
  const dr=document.getElementById('detail-'+pfx+id),cr=document.getElementById('caret-'+pfx+id);
  if(!dr) return;
  const hidden=dr.style.display==='none';
  dr.style.display=hidden?'':'none';
  if(cr) cr.classList.toggle('rotated',hidden);
}

function useDevKey(){
  document.getElementById('ak-input').value='Ddj1ZHJYculiA34hussZFzLdgDupBzIE';
  if(document.getElementById('ak-input-hmac')) document.getElementById('ak-input-hmac').value='Ddj1ZHJYculiA34hussZFzLdgDupBzIE';
  if(document.getElementById('sk-input')) document.getElementById('sk-input').value='zuLydZWeDvZXk5t230UDWrqaeqtTwQ3K';
  doAuth();
}

// ── Init ───────────────────────────────────────────────────
['ak-input','ak-input-hmac','sk-input'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('keydown',ev=>{if(ev.key==='Enter')doAuth();});
});

if(window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1'){
  const h=document.getElementById('local-dev-hint');
  if(h) h.style.display='block';
}

const savedKey=sessionStorage.getItem('unsent_api_key');
const savedSecret=sessionStorage.getItem('unsent_api_secret');
const savedMode=sessionStorage.getItem('unsent_auth_mode')||'apikey';
if(savedKey){
  authToken=savedKey;
  authSecret=savedSecret||'';
  authMode=savedMode;
  if(document.getElementById('ak-input')) document.getElementById('ak-input').value=savedKey;
  if(document.getElementById('ak-input-hmac')) document.getElementById('ak-input-hmac').value=savedKey;
  if(document.getElementById('sk-input')&&savedSecret) document.getElementById('sk-input').value=savedSecret;
  setAuthMode(authMode);
  doAuth();
}
</script>
</body>
</html>`;
}
