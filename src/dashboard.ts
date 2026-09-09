export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UNSENT // Email Queue Telemetry</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='4' fill='%23ff9e2c'/%3E%3Cpath d='M6 9h20v14H6z' fill='none' stroke='%23090a0f' stroke-width='2.5'/%3E%3Cpath d='M6 10l10 7 10-7' fill='none' stroke='%23090a0f' stroke-width='2.5'/%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-canvas: #090a0f;
      --bg-surface: #0f1218;
      --bg-surface-subtle: #141720;
      --bg-surface-hover: #1a1e2a;
      --bg-input: #0b0d13;
      --border-rule: #1e2430;
      --border-focus: #ff9e2c;
      --border-subtle: #161b24;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --text-muted: #556070;
      --accent-amber: #ff9e2c;
      --accent-amber-hover: #e68a1f;
      --accent-amber-dim: rgba(255, 158, 44, 0.12);
      --accent-amber-border: rgba(255, 158, 44, 0.3);
      --state-success: #00e599;
      --state-success-dim: rgba(0, 229, 153, 0.1);
      --state-success-border: rgba(0, 229, 153, 0.25);
      --state-danger: #ff4d4f;
      --state-danger-dim: rgba(255, 77, 79, 0.1);
      --state-danger-border: rgba(255, 77, 79, 0.25);
      --state-cyan: #00b4d8;
      --state-cyan-dim: rgba(0, 180, 216, 0.1);
      --state-cyan-border: rgba(0, 180, 216, 0.25);
      --font-mono: 'JetBrains Mono', monospace;
      --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background: var(--bg-canvas);
      color: var(--text-primary);
      font-family: var(--font-ui);
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
      background: rgba(9, 10, 15, 0.96);
      backdrop-filter: blur(8px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      padding: 20px;
    }

    .auth-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-rule);
      border-radius: 4px;
      padding: 36px 32px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 0 0 1px var(--border-rule), 0 24px 48px rgba(0, 0, 0, 0.6);
    }

    .auth-card h2 {
      font-family: var(--font-mono);
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.06em;
      margin-bottom: 4px;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .auth-card h2 span {
      color: var(--accent-amber);
    }

    .auth-card > p {
      color: var(--text-secondary);
      font-size: 13px;
      margin-bottom: 22px;
    }

    .auth-mode-group {
      display: flex;
      background: var(--bg-input);
      border: 1px solid var(--border-rule);
      border-radius: 4px;
      padding: 3px;
      margin-bottom: 20px;
    }

    .auth-mode-btn {
      flex: 1;
      background: none;
      border: none;
      color: var(--text-secondary);
      padding: 8px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--font-mono);
      transition: all 0.15s ease;
    }

    .auth-mode-btn.active {
      background: var(--bg-surface-subtle);
      color: var(--accent-amber);
      box-shadow: inset 0 -2px 0 var(--accent-amber);
    }

    .auth-hint {
      font-size: 12px;
      color: var(--text-secondary);
      margin-bottom: 18px;
      line-height: 1.5;
      padding: 10px 12px;
      background: var(--bg-surface-subtle);
      border: 1px solid var(--border-rule);
      border-radius: 4px;
    }

    .auth-hint code {
      color: var(--accent-amber);
      font-family: var(--font-mono);
    }

    /* INPUT FIELDS */
    .ig {
      margin-bottom: 16px;
      text-align: left;
    }

    .ig label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: 6px;
      color: var(--text-secondary);
    }

    .ifield {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-rule);
      border-radius: 3px;
      padding: 10px 12px;
      color: var(--text-primary);
      font-family: inherit;
      font-size: 13px;
      transition: border-color 0.15s ease;
      outline: none;
    }

    .ifield:focus {
      border-color: var(--border-focus);
    }

    select.ifield option {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    textarea.ifield {
      resize: vertical;
      min-height: 80px;
      font-family: var(--font-mono);
      font-size: 12px;
    }

    /* BUTTONS */
    .btn {
      width: 100%;
      background: var(--accent-amber);
      color: #090a0f;
      border: none;
      border-radius: 3px;
      padding: 11px 16px;
      font-weight: 700;
      font-size: 13px;
      font-family: var(--font-mono);
      letter-spacing: 0.03em;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn:hover {
      background: var(--accent-amber-hover);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .bsm {
      padding: 6px 12px;
      font-size: 12px;
      border-radius: 3px;
      font-weight: 600;
      font-family: var(--font-mono);
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .b-primary {
      background: var(--accent-amber);
      color: #090a0f;
    }
    .b-primary:hover {
      background: var(--accent-amber-hover);
    }

    .b-danger {
      background: var(--state-danger-dim);
      color: var(--state-danger);
      border-color: var(--state-danger-border);
    }
    .b-danger:hover {
      background: rgba(255, 77, 79, 0.2);
    }

    .b-ghost {
      background: transparent;
      color: var(--text-secondary);
      border-color: var(--border-rule);
    }
    .b-ghost:hover {
      color: var(--text-primary);
      border-color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.03);
    }

    /* HEADER */
    header {
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-rule);
      padding: 0 24px;
      height: 54px;
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
      gap: 12px;
    }

    .logo-badge {
      width: 26px;
      height: 26px;
      background: var(--accent-amber);
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 14px;
      color: #090a0f;
      font-family: var(--font-mono);
    }

    .logo-text {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.06em;
      color: var(--text-primary);
    }

    .logo-text span {
      color: var(--text-muted);
      font-weight: 400;
      font-size: 12px;
      margin-left: 6px;
    }

    .nav-tabs {
      display: flex;
      gap: 4px;
      background: var(--bg-canvas);
      border: 1px solid var(--border-rule);
      border-radius: 4px;
      padding: 3px;
    }

    .nav-tab {
      background: none;
      border: none;
      color: var(--text-secondary);
      padding: 6px 14px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--font-mono);
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .nav-tab.active {
      background: var(--bg-surface-subtle);
      color: var(--accent-amber);
      box-shadow: inset 0 -2px 0 var(--accent-amber);
    }

    .nav-tab:hover:not(.active) {
      color: var(--text-primary);
      background: rgba(255, 255, 255, 0.03);
    }

    .hdr-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .status-pill {
      background: var(--state-success-dim);
      border: 1px solid var(--state-success-border);
      color: var(--state-success);
      padding: 4px 10px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      background: var(--state-success);
      border-radius: 50%;
      box-shadow: 0 0 6px var(--state-success);
    }

    .ghost-btn {
      background: transparent;
      border: 1px solid var(--border-rule);
      color: var(--text-secondary);
      padding: 6px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--font-mono);
      transition: all 0.15s ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .ghost-btn:hover {
      color: var(--text-primary);
      border-color: var(--text-secondary);
      background: rgba(255, 255, 255, 0.03);
    }

    /* MAIN CONTAINER */
    main {
      padding: 24px;
      max-width: 1440px;
      margin: 0 auto;
      width: 100%;
      flex: 1;
    }

    .view {
      display: none;
    }
    .view.active {
      display: block;
    }

    /* TELEMETRY STATS GRID */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    @media (max-width: 900px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .stat-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-rule);
      border-radius: 4px;
      padding: 16px 20px;
      position: relative;
      overflow: hidden;
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--border-rule);
    }

    .stat-queued::before { background: var(--accent-amber); }
    .stat-sending::before { background: var(--state-cyan); }
    .stat-sent::before { background: var(--state-success); }
    .stat-failed::before { background: var(--state-danger); }

    .stat-label {
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      margin-bottom: 6px;
    }

    .stat-value {
      font-family: var(--font-mono);
      font-size: 28px;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1.1;
    }

    .stat-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* TWO-COLUMN GRID */
    .content-grid {
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: 20px;
      align-items: start;
    }

    @media (max-width: 1024px) {
      .content-grid {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-rule);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 20px;
    }

    .panel-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border-rule);
      background: var(--bg-surface-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .panel-title {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .panel-body {
      padding: 20px;
    }

    /* TABLES */
    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 10px 16px;
      border-bottom: 1px solid var(--border-rule);
      background: var(--bg-surface);
      white-space: nowrap;
    }

    td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 13px;
      vertical-align: middle;
    }

    tr:hover td {
      background: var(--bg-surface-subtle);
    }

    .empty-state {
      padding: 48px 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
      font-family: var(--font-mono);
    }

    /* BADGES */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 2px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .b-queued {
      background: var(--accent-amber-dim);
      color: var(--accent-amber);
      border: 1px solid var(--accent-amber-border);
    }

    .b-sending {
      background: var(--state-cyan-dim);
      color: var(--state-cyan);
      border: 1px solid var(--state-cyan-border);
    }

    .b-sent {
      background: var(--state-success-dim);
      color: var(--state-success);
      border: 1px solid var(--state-success-border);
    }

    .b-failed {
      background: var(--state-danger-dim);
      color: var(--state-danger);
      border: 1px solid var(--state-danger-border);
    }

    .b-active {
      background: var(--state-success-dim);
      color: var(--state-success);
      border: 1px solid var(--state-success-border);
    }

    .b-disabled {
      background: var(--bg-canvas);
      color: var(--text-muted);
      border: 1px solid var(--border-rule);
    }

    .tbadge {
      display: inline-flex;
      padding: 2px 6px;
      border-radius: 2px;
      font-size: 11px;
      font-family: var(--font-mono);
      font-weight: 600;
      text-transform: uppercase;
      background: var(--bg-surface-subtle);
      border: 1px solid var(--border-rule);
      color: var(--text-secondary);
    }

    .def-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      font-family: var(--font-mono);
      background: var(--accent-amber-dim);
      color: var(--accent-amber);
      border: 1px solid var(--accent-amber-border);
      padding: 1px 5px;
      border-radius: 2px;
      margin-left: 6px;
    }

    /* QUOTA METER */
    .qbar-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .qbar-track {
      flex: 1;
      height: 5px;
      background: var(--bg-canvas);
      border: 1px solid var(--border-rule);
      border-radius: 1px;
      overflow: hidden;
      min-width: 60px;
    }

    .qbar-fill {
      height: 100%;
      background: var(--state-success);
      transition: width 0.3s ease;
    }

    .qbar-fill.warn {
      background: var(--accent-amber);
    }

    .qbar-fill.danger {
      background: var(--state-danger);
    }

    .qbar-text {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      white-space: nowrap;
    }

    /* DETAILS DRAWER */
    .detail-row td {
      padding: 0 !important;
      border-bottom: 1px solid var(--border-rule);
      background: var(--bg-canvas);
    }

    .detail-body {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .detail-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }

    .meta-box {
      background: var(--bg-surface);
      border: 1px solid var(--border-rule);
      border-radius: 3px;
      padding: 8px 12px;
    }

    .meta-lbl {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }

    .meta-val {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-primary);
      word-break: break-all;
    }

    .detail-tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--border-rule);
      margin-bottom: 10px;
    }

    .dtab {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 6px 12px;
      cursor: pointer;
      border-bottom: 2px solid transparent;
    }

    .dtab.active {
      color: var(--accent-amber);
      border-bottom-color: var(--accent-amber);
    }

    .preview-iframe {
      width: 100%;
      height: 220px;
      background: #ffffff;
      border: 1px solid var(--border-rule);
      border-radius: 3px;
    }

    .detail-mono {
      background: var(--bg-surface);
      border: 1px solid var(--border-rule);
      border-radius: 3px;
      padding: 12px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 220px;
      overflow-y: auto;
    }

    /* TELEMETRY LIST */
    .qr-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .qr-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      background: var(--bg-surface-subtle);
      border: 1px solid var(--border-rule);
      border-radius: 3px;
    }

    .qr-lbl {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .qr-val {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-primary);
      font-weight: 600;
    }

    /* MODALS */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(9, 10, 15, 0.94);
      backdrop-filter: blur(6px);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      padding: 20px;
    }

    .modal-overlay.show {
      display: flex;
    }

    .modal-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-rule);
      border-radius: 4px;
      padding: 28px;
      width: 100%;
      max-width: 540px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 0 0 1px var(--border-rule), 0 24px 48px rgba(0, 0, 0, 0.6);
    }

    .modal-title {
      font-family: var(--font-mono);
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 20px;
      color: var(--text-primary);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--border-rule);
    }

    /* TOOLBARS & FILTERS */
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }

    .filter-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .action-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .pagination-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      border-top: 1px solid var(--border-rule);
      background: var(--bg-surface);
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
    }

    /* CODE BLOCKS */
    pre {
      background: var(--bg-input);
      border: 1px solid var(--border-rule);
      border-radius: 3px;
      padding: 14px 16px;
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-primary);
      overflow-x: auto;
      line-height: 1.6;
    }

    .code-comment { color: var(--text-muted); }
    .code-key { color: var(--accent-amber); }
    .code-str { color: var(--state-success); }
    .code-fn { color: var(--state-cyan); }

    /* TOAST */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--bg-surface);
      border: 1px solid var(--border-rule);
      border-radius: 3px;
      padding: 12px 18px;
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary);
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.2s ease;
      z-index: 2000;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    #toast.show {
      transform: translateY(0);
      opacity: 1;
    }

    #toast.tok {
      border-color: var(--state-success);
      color: var(--state-success);
    }

    #toast.terr {
      border-color: var(--state-danger);
      color: var(--state-danger);
    }

    /* UTILITIES */
    .mono { font-family: var(--font-mono); }
    .caret {
      cursor: pointer;
      display: inline-block;
      transition: transform 0.15s ease;
      user-select: none;
      color: var(--text-muted);
    }
    .caret.rotated {
      transform: rotate(90deg);
      color: var(--accent-amber);
    }
    .row-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
  </style>
</head>
<body>

<!-- AUTH OVERLAY -->
<div id="auth-overlay">
  <div class="auth-card">
    <h2><span>UNSENT</span> // ACCESS CONTROL</h2>
    <p>Authenticate with your service credentials to access queue telemetry</p>
    
    <div class="auth-mode-group">
      <button class="auth-mode-btn active" onclick="setAuthMode('apikey')" id="mbtn-apikey">API Key</button>
      <button class="auth-mode-btn" onclick="setAuthMode('hmac')" id="mbtn-hmac">Signed (HMAC)</button>
    </div>

    <div id="auth-apikey-form">
      <div class="ig">
        <label>Service API Key</label>
        <input class="ifield mono" type="password" id="ak-input" placeholder="Enter API key" autocomplete="off">
      </div>
      <div class="auth-hint">Header-bound bearer authentication (<code>X-API-Key</code>).</div>
      <button class="btn" onclick="doAuth()">Sign In</button>
    </div>

    <div id="auth-hmac-form" style="display:none">
      <div class="ig">
        <label>Service API Key</label>
        <input class="ifield mono" type="password" id="ak-input-hmac" placeholder="Enter API key" autocomplete="off">
      </div>
      <div class="ig">
        <label>HMAC Secret Key</label>
        <input class="ifield mono" type="password" id="sk-input" placeholder="Enter secret key" autocomplete="off">
      </div>
      <div class="auth-hint">HMAC-SHA256 signature binding timestamp, nonce, and payload.</div>
      <button class="btn" onclick="doAuth()">Sign In</button>
    </div>

    <p id="auth-err" style="color:var(--state-danger);margin-top:14px;font-size:12px;font-family:var(--font-mono);display:none"></p>

    <div id="local-dev-hint" style="display:none;margin-top:18px;padding:12px;background:var(--accent-amber-dim);border:1px solid var(--accent-amber-border);border-radius:3px;font-size:12px;text-align:left;">
      <div style="font-weight:700;font-family:var(--font-mono);color:var(--accent-amber);margin-bottom:4px;">LOCAL DEV DETECTED</div>
      <div style="color:var(--text-secondary);font-size:11px;margin-bottom:10px;">Running on localhost. Use the local credentials defined in <code>.dev.vars</code>:</div>
      <button type="button" class="bsm b-primary" style="width:100%;justify-content:center;" onclick="useDevKey()">Sign In with Local Dev Key</button>
    </div>
  </div>
</div>

<!-- HEADER -->
<header>
  <div class="logo-wrap">
    <div class="logo-badge">U</div>
    <div class="logo-text">UNSENT <span>// QUEUE TERMINAL</span></div>
  </div>
  
  <nav class="nav-tabs">
    <button class="nav-tab active" onclick="switchView('v-dash')" id="tab-dash">Dashboard</button>
    <button class="nav-tab" onclick="switchView('v-prov')" id="tab-prov">Providers</button>
    <button class="nav-tab" onclick="switchView('v-logs')" id="tab-logs">Logs</button>
    <button class="nav-tab" onclick="switchView('v-docs')" id="tab-docs">API Docs</button>
  </nav>

  <div class="hdr-right">
    <div class="status-pill"><div class="status-dot"></div> ONLINE</div>
    <a href="https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/" target="_blank" rel="noopener noreferrer" class="ghost-btn">Report Issue</a>
    <button class="ghost-btn" onclick="logout()">Log Out</button>
  </div>
</header>

<main>

<!-- VIEW: DASHBOARD -->
<div id="v-dash" class="view active">
  <div class="stats-grid">
    <div class="stat-card stat-queued">
      <div class="stat-label">Queued</div>
      <div class="stat-value" id="st-queued">—</div>
      <div class="stat-sub">Pending queue delivery</div>
    </div>
    <div class="stat-card stat-sending">
      <div class="stat-label">Sending</div>
      <div class="stat-value" id="st-sending">—</div>
      <div class="stat-sub">In-flight via provider</div>
    </div>
    <div class="stat-card stat-sent">
      <div class="stat-label">Delivered</div>
      <div class="stat-value" id="st-sent">—</div>
      <div class="stat-sub">Successfully accepted</div>
    </div>
    <div class="stat-card stat-failed">
      <div class="stat-label">Failed</div>
      <div class="stat-value" id="st-failed">—</div>
      <div class="stat-sub">Exhausted retry cycles</div>
    </div>
  </div>

  <div class="content-grid">
    <!-- RECENT ACTIVITY TABLE -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Recent Activity</div>
        <button class="bsm b-ghost" onclick="fetchDash(this)">Refresh</button>
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
              <th>Time (UTC)</th>
            </tr>
          </thead>
          <tbody id="dash-emails">
            <tr><td colspan="6"><div class="empty-state">Loading recent activity…</div></td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- QUICK SEND & STATUS -->
    <div>
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Send Test Email</div>
        </div>
        <div class="panel-body">
          <form onsubmit="sendTest(event)">
            <div class="ig">
              <label>Recipient Address *</label>
              <input class="ifield mono" type="email" id="te-to" placeholder="recipient@example.com" required>
            </div>
            <div class="ig">
              <label>Subject *</label>
              <input class="ifield" type="text" id="te-subj" placeholder="Test email subject" value="Test Message from Unsent">
            </div>
            <div class="ig">
              <label>Body (HTML)</label>
              <textarea class="ifield" id="te-body" rows="3" placeholder="<p>Test email message content</p>"><p>This is a test delivery from Unsent queue service.</p></textarea>
            </div>
            <div class="ig">
              <label>Routing Provider (Optional)</label>
              <select class="ifield mono" id="te-prov">
                <option value="">Auto (Default priority)</option>
              </select>
            </div>
            <button class="btn" type="submit" id="te-btn">Send Test Email</button>
          </form>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">System Telemetry</div>
        </div>
        <div class="panel-body">
          <div class="qr-grid">
            <div class="qr-item">
              <span class="qr-lbl">Endpoint URL</span>
              <span class="qr-val mono" id="qr-base">—</span>
            </div>
            <div class="qr-item">
              <span class="qr-lbl">Active Auth</span>
              <span class="qr-val mono" id="qr-auth">API Key</span>
            </div>
            <div class="qr-item">
              <span class="qr-lbl">Active Providers</span>
              <span class="qr-val mono" id="qr-provs">—</span>
            </div>
            <div class="qr-item">
              <span class="qr-lbl">Storage</span>
              <span class="qr-val mono" style="color:var(--state-success)">D1 SQLite Bound</span>
            </div>
            <div class="qr-item">
              <span class="qr-lbl">Runtime</span>
              <span class="qr-val mono" style="color:var(--state-cyan)">Cloudflare Worker (V8)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- VIEW: PROVIDERS -->
<div id="v-prov" class="view">
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">Configured Providers</div>
      <div class="action-group">
        <button class="bsm b-ghost" onclick="fetchProviders(this)">Refresh</button>
        <button class="bsm b-primary" onclick="openAddProv()">+ Add Provider</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:36px">#</th>
            <th>Provider Name / ID</th>
            <th>Type</th>
            <th>From Address</th>
            <th>Daily Limit</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="prov-body">
          <tr><td colspan="7"><div class="empty-state">Loading provider registry…</div></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- VIEW: LOGS -->
<div id="v-logs" class="view">
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">Delivery Logs</div>
      <div class="action-group">
        <button class="bsm b-ghost" onclick="exportCsv(currentLogsCache)">Export CSV</button>
        <button class="bsm b-ghost" onclick="exportJsonl(currentLogsCache)">Export JSONL</button>
      </div>
    </div>
    <div class="panel-body" style="padding-bottom: 12px;">
      <div class="toolbar">
        <div class="filter-group">
          <input class="ifield mono" type="text" id="lf-q" placeholder="Filter by recipient, subject, or ID…" style="width: 280px;">
          <select class="ifield mono" id="lf-status" style="width: 140px;">
            <option value="">All Statuses</option>
            <option value="queued">Queued</option>
            <option value="sending">Sending</option>
            <option value="sent">Delivered</option>
            <option value="failed">Failed</option>
          </select>
          <button class="bsm b-primary" onclick="applyLogsFilter(this)">Apply</button>
          <button class="bsm b-ghost" onclick="resetLogsFilter()">Reset</button>
        </div>
      </div>
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
            <th>Attempts</th>
            <th>Time (UTC)</th>
          </tr>
        </thead>
        <tbody id="logs-body">
          <tr><td colspan="7"><div class="empty-state">Loading delivery logs…</div></td></tr>
        </tbody>
      </table>
    </div>

    <div class="pagination-bar">
      <span id="pag-info">Showing 0 of 0</span>
      <div class="action-group">
        <button class="bsm b-ghost" id="btn-prev" onclick="prevLogs()" disabled>Previous</button>
        <button class="bsm b-ghost" id="btn-next" onclick="nextLogs()" disabled>Next</button>
      </div>
    </div>
  </div>
</div>

<!-- VIEW: API DOCS -->
<div id="v-docs" class="view">
  <div class="panel">
    <div class="panel-header">
      <div class="panel-title">API Integration & Documentation</div>
    </div>
    <div class="panel-body">
      <h3 style="font-family:var(--font-mono);font-size:14px;color:var(--text-primary);margin-bottom:8px;">1. Queue an Email for Delivery (cURL)</h3>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">Send an authorized HTTP POST request to <code>/api/send</code> with JSON payload.</p>
      <pre><code><span class="code-comment"># Enqueue email via standard API Key</span>
curl -X POST https://your-worker.workers.dev/api/send \
  -H <span class="code-str">"Content-Type: application/json"</span> \
  -H <span class="code-str">"X-API-Key: YOUR_API_KEY"</span> \
  -d <span class="code-str">'{
    "to": "user@example.com",
    "subject": "Order Confirmation",
    "html": "&lt;h1&gt;Thank you!&lt;/h1&gt;&lt;p&gt;Your order #1234 has shipped.&lt;/p&gt;",
    "provider_id": "smtp_primary"
  }'</span></code></pre>

      <h3 style="font-family:var(--font-mono);font-size:14px;color:var(--text-primary);margin:24px 0 8px;">2. JavaScript / TypeScript (Fetch API)</h3>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">Enqueue messages directly from your backend services or Edge functions.</p>
      <pre><code><span class="code-key">const</span> res = <span class="code-fn">await</span> <span class="code-fn">fetch</span>(<span class="code-str">'https://your-worker.workers.dev/api/send'</span>, {
  method: <span class="code-str">'POST'</span>,
  headers: {
    <span class="code-str">'Content-Type'</span>: <span class="code-str">'application/json'</span>,
    <span class="code-str">'X-API-Key'</span>: process.env.UNSENT_API_KEY
  },
  body: JSON.<span class="code-fn">stringify</span>({
    to: <span class="code-str">'client@domain.com'</span>,
    subject: <span class="code-str">'Welcome aboard'</span>,
    html: <span class="code-str">'&lt;p&gt;Welcome to the service.&lt;/p&gt;'</span>
  })
});
<span class="code-key">const</span> data = <span class="code-fn">await</span> res.<span class="code-fn">json</span>();
console.<span class="code-fn">log</span>(<span class="code-str">'Queued Email ID:'</span>, data.id);</code></pre>

      <h3 style="font-family:var(--font-mono);font-size:14px;color:var(--text-primary);margin:24px 0 8px;">3. Cryptographic HMAC-SHA256 Signatures</h3>
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">In full security mode, bind timestamps, nonces, and provider routing headers to eliminate replay and tampering attacks.</p>
      <pre><code><span class="code-comment">// Canonical string format for HMAC:</span>
<span class="code-key">const</span> canonical = [timestamp, nonce, <span class="code-str">'provider:smtp_primary'</span>, sha256BodyHash].<span class="code-fn">join</span>(<span class="code-str">'\n'</span>);
<span class="code-key">const</span> signature = <span class="code-str">'sha256='</span> + <span class="code-fn">hmacSha256</span>(API_SECRET, canonical);

<span class="code-comment">// Request headers:</span>
headers[<span class="code-str">'X-API-Key'</span>] = API_KEY;
headers[<span class="code-str">'X-Timestamp'</span>] = timestamp;
headers[<span class="code-str">'X-Nonce'</span>] = nonce;
headers[<span class="code-str">'X-Signature'</span>] = signature;
headers[<span class="code-str">'X-Provider-Id'</span>] = <span class="code-str">'smtp_primary'</span>;</code></pre>
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
        <div class="ig">
          <label>Provider ID *</label>
          <input class="ifield mono" type="text" id="pf-id" placeholder="e.g. smtp_main" pattern="[a-zA-Z0-9_-]+" required>
        </div>
        <div class="ig">
          <label>Display Name *</label>
          <input class="ifield" type="text" id="pf-name" placeholder="e.g. Primary SMTP" required>
        </div>
      </div>
      <div class="ig">
        <label>Provider Type *</label>
        <select class="ifield mono" id="pf-type" onchange="onTypeChange()" required>
          <option value="">Select a provider type</option>
          <option value="smtp">SMTP</option>
          <option value="resend">Resend API</option>
          <option value="sendgrid">SendGrid API</option>
          <option value="mailgun">Mailgun API</option>
          <option value="postmark">Postmark API</option>
          <option value="ses">AWS SES</option>
        </select>
      </div>

      <!-- SMTP FIELDS -->
      <div id="cfg-smtp">
        <div class="form-row">
          <div class="ig">
            <label>SMTP Host *</label>
            <input class="ifield mono" type="text" id="pf-smtp-host" placeholder="smtp.gmail.com">
          </div>
          <div class="ig">
            <label>SMTP Port *</label>
            <input class="ifield mono" type="number" id="pf-smtp-port" placeholder="587" value="587">
          </div>
        </div>
        <div class="form-row">
          <div class="ig">
            <label>Username *</label>
            <input class="ifield mono" type="text" id="pf-smtp-user" placeholder="user@gmail.com" autocomplete="off">
          </div>
          <div class="ig">
            <label>Password / App Secret *</label>
            <input class="ifield mono" type="password" id="pf-smtp-pass" placeholder="••••••••" autocomplete="new-password">
          </div>
        </div>
        <div class="ig" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="pf-smtp-starttls" checked>
          <label for="pf-smtp-starttls" style="margin-bottom:0;text-transform:none;cursor:pointer;">Enable STARTTLS (port 587)</label>
        </div>
      </div>

      <!-- API KEY FIELDS -->
      <div id="cfg-api" style="display:none">
        <div class="ig">
          <label>API Key *</label>
          <input class="ifield mono" type="password" id="pf-apikey" placeholder="re_••••••••" autocomplete="new-password">
        </div>
      </div>

      <div class="form-row" style="margin-top:10px;">
        <div class="ig">
          <label>From Email *</label>
          <input class="ifield mono" type="email" id="pf-from" placeholder="noreply@example.com" required>
        </div>
        <div class="ig">
          <label>Sender Name</label>
          <input class="ifield" type="text" id="pf-fromname" placeholder="Unsent Service">
        </div>
      </div>

      <div class="form-row">
        <div class="ig">
          <label>Priority (1 = highest)</label>
          <input class="ifield mono" type="number" id="pf-prio" value="1" min="1" max="100">
        </div>
        <div class="ig">
          <label>Daily Limit (0 = unlimited)</label>
          <input class="ifield mono" type="number" id="pf-limit" value="0" min="0">
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="bsm b-ghost" onclick="closeProvModal()">Cancel</button>
        <button type="submit" class="bsm b-primary" id="pf-save-btn">Save Provider</button>
      </div>
    </form>
  </div>
</div>

<!-- TEST PROVIDER MODAL -->
<div class="modal-overlay" id="tp-modal">
  <div class="modal-card" style="max-width:440px;">
    <div class="modal-title">Test Provider Connection</div>
    <form onsubmit="doTestProv(event)">
      <input type="hidden" id="tp-prov-id">
      <div class="ig">
        <label>Recipient Address *</label>
        <input class="ifield mono" type="email" id="tp-to" placeholder="recipient@example.com" required>
      </div>
      <div class="auth-hint">Sends an immediate test email to verify credentials and SMTP connectivity.</div>
      <div class="modal-actions">
        <button type="button" class="bsm b-ghost" onclick="closeTestModal()">Cancel</button>
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
let currentLogsCache = [];

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

function sbadge(s){
  const m={queued:'b-queued',sending:'b-sending',sent:'b-sent',failed:'b-failed'};
  return '<span class="badge '+(m[s]||'')+'">'+esc(s)+'</span>';
}

function tbadge(t){
  return '<span class="tbadge">'+esc(t)+'</span>';
}

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
  const subj=document.getElementById('te-subj').value.trim()||'Test Message from Unsent';
  const html=document.getElementById('te-body').value.trim()||'<p>This is a test delivery from Unsent.</p>';
  const provId=document.getElementById('te-prov').value;
  try{
    const payload={to,subject:subj,html};
    if(provId) payload.provider_id=provId;
    const qual=provId?'provider:'+provId:'';
    const opts={method:'POST',body:payload,qual};
    if(provId) opts.provId=provId;
    const r=await api('/api/send',opts);
    if(r.error) toast('Error: '+r.error,false); else {toast('Email queued successfully'); fetchDash();}
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
  if(!provs.length){tb.innerHTML='<tr><td colspan="7"><div class="empty-state">No providers configured yet. Click "Add Provider" to get started.</div></td></tr>';return;}
  tb.innerHTML=provs.map((p,i)=>{
    const defBadge=p.is_default?'<span class="def-badge">Default</span>':'';
    const ab=p.is_active?'<span class="badge b-active">Active</span>':'<span class="badge b-disabled">Disabled</span>';
    const setDefBtn=!p.is_default?'<button class="bsm b-ghost" onclick="setDefault(&#39;'+esc(p.id)+'&#39;)">Make Default</button>':'';
    return '<tr>'
      +'<td style="text-align:center;font-weight:600;color:var(--text-muted)">'+(i+1)+'</td>'
      +'<td><b>'+esc(p.name)+'</b> '+defBadge+'<br><span class="mono" style="font-size:11px;color:var(--text-secondary)">'+esc(p.id)+'</span></td>'
      +'<td>'+tbadge(p.type)+'</td>'
      +'<td class="mono" style="font-size:12px">'+esc(p.from_email||'—')+'</td>'
      +'<td>'+qbar(p.daily_sent_count||0,p.daily_limit||0)+'</td>'
      +'<td>'+ab+'</td>'
      +'<td><div class="row-actions">'
        +setDefBtn
        +'<button class="bsm b-ghost" onclick="openTestProv(&#39;'+esc(p.id)+'&#39;)">Test</button>'
        +'<button class="bsm b-ghost" onclick="openEditProv(&#39;'+esc(p.id)+'&#39;)">Edit</button>'
        +'<button class="bsm b-danger" onclick="deleteProv(&#39;'+esc(p.id)+'&#39;)">Delete</button>'
      +'</div></td>'
    +'</tr>';
  }).join('');
}

function fillTestSelect(provs){
  const sel=document.getElementById('te-prov');
  const cur=sel.value;
  sel.innerHTML='<option value="">Auto (Default priority)</option>'
    +provs.filter(p=>p.is_active).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' ('+esc(p.type)+')</option>').join('');
  sel.value=cur;
}

function onTypeChange(){
  const t=document.getElementById('pf-type').value;
  document.getElementById('cfg-smtp').style.display=t==='smtp'?'':'none';
  document.getElementById('cfg-api').style.display=(t&&t!=='smtp')?'':'none';
}

function openAddProv(){
  document.getElementById('prov-modal-title').textContent='Add Provider';
  document.getElementById('prov-editing-id').value='';
  document.getElementById('prov-form').reset();
  document.getElementById('pf-id').disabled=false;
  onTypeChange();
  document.getElementById('prov-modal').classList.add('show');
}

function openEditProv(id){
  const p=provsCache.find(x=>x.id===id);
  if(!p) return;
  document.getElementById('prov-modal-title').textContent='Edit Provider: '+p.name;
  document.getElementById('prov-editing-id').value=p.id;
  document.getElementById('pf-id').value=p.id;
  document.getElementById('pf-id').disabled=true;
  document.getElementById('pf-name').value=p.name||'';
  document.getElementById('pf-type').value=p.type||'smtp';
  document.getElementById('pf-from').value=p.from_email||'';
  document.getElementById('pf-fromname').value=p.from_name||'';
  document.getElementById('pf-prio').value=p.priority||1;
  document.getElementById('pf-limit').value=p.daily_limit||0;
  onTypeChange();
  if(p.type==='smtp'){
    document.getElementById('pf-smtp-host').value=p.smtp_host||'';
    document.getElementById('pf-smtp-port').value=p.smtp_port||587;
    document.getElementById('pf-smtp-user').value=p.smtp_user||'';
    document.getElementById('pf-smtp-pass').value='';
    document.getElementById('pf-smtp-pass').placeholder='•••••••• (leave blank to keep)';
    document.getElementById('pf-smtp-starttls').checked=p.smtp_starttls!==0;
  }else{
    document.getElementById('pf-apikey').value='';
    document.getElementById('pf-apikey').placeholder='•••••••• (leave blank to keep)';
  }
  document.getElementById('prov-modal').classList.add('show');
}

function closeProvModal(){
  document.getElementById('prov-modal').classList.remove('show');
}

async function saveProv(ev){
  ev.preventDefault();
  const btn=document.getElementById('pf-save-btn');btn.textContent='Saving…';btn.disabled=true;
  const editingId=document.getElementById('prov-editing-id').value;
  const isEdit=Boolean(editingId);
  const type=document.getElementById('pf-type').value;
  const payload={
    name: document.getElementById('pf-name').value.trim(),
    type,
    from_email: document.getElementById('pf-from').value.trim(),
    from_name: document.getElementById('pf-fromname').value.trim()||undefined,
    priority: parseInt(document.getElementById('pf-prio').value,10)||1,
    daily_limit: parseInt(document.getElementById('pf-limit').value,10)||0,
  };
  if(!isEdit) payload.id=document.getElementById('pf-id').value.trim();
  if(type==='smtp'){
    payload.smtp_host=document.getElementById('pf-smtp-host').value.trim();
    payload.smtp_port=parseInt(document.getElementById('pf-smtp-port').value,10)||587;
    payload.smtp_user=document.getElementById('pf-smtp-user').value.trim();
    const pw=document.getElementById('pf-smtp-pass').value;
    if(pw) payload.smtp_pass=pw;
    payload.smtp_starttls=document.getElementById('pf-smtp-starttls').checked;
  }else{
    const ak=document.getElementById('pf-apikey').value.trim();
    if(ak) payload.api_key=ak;
  }
  try{
    const method=isEdit?'PUT':'POST';
    const path=isEdit?'/api/providers/'+encodeURIComponent(editingId):'/api/providers';
    const r=await api(path,{method,body:payload});
    if(r.error) toast('Error: '+r.error,false);
    else{
      toast(isEdit?'Provider updated':'Provider added');
      closeProvModal();
      fetchProviders();
    }
  }catch(e){toast('Save failed: '+e.message,false);}
  finally{btn.textContent='Save Provider';btn.disabled=false;}
}

async function setDefault(id){
  try{
    const r=await api('/api/providers/'+encodeURIComponent(id)+'/default',{method:'POST'});
    if(r.error) toast('Error: '+r.error,false); else {toast('Default provider updated'); fetchProviders();}
  }catch(e){toast('Failed to set default: '+e.message,false);}
}

async function deleteProv(id){
  if(!confirm('Are you sure you want to delete provider "'+id+'"?')) return;
  try{
    const r=await api('/api/providers/'+encodeURIComponent(id),{method:'DELETE'});
    if(r.error) toast('Error: '+r.error,false); else {toast('Provider deleted'); fetchProviders();}
  }catch(e){toast('Delete failed: '+e.message,false);}
}

function openTestProv(id){
  document.getElementById('tp-prov-id').value=id;
  document.getElementById('tp-modal').classList.add('show');
}
function closeTestModal(){
  document.getElementById('tp-modal').classList.remove('show');
}

async function doTestProv(ev){
  ev.preventDefault();
  const id=document.getElementById('tp-prov-id').value;
  const to=document.getElementById('tp-to').value.trim();
  const btn=document.getElementById('tp-btn');btn.textContent='Testing…';btn.disabled=true;
  try{
    const r=await api('/api/providers/'+encodeURIComponent(id)+'/test',{method:'POST',body:{to}});
    if(r.error) toast('Test failed: '+r.error,false); else {toast('Test email sent successfully'); closeTestModal(); fetchProviders();}
  }catch(e){toast('Test failed: '+e.message,false);}
  finally{btn.textContent='Send Test Email';btn.disabled=false;}
}

// ── Logs ───────────────────────────────────────────────────
async function fetchLogs(btn){
  if(btn){btn.textContent='Filtering…';btn.disabled=true;}
  const q=encodeURIComponent(document.getElementById('lf-q').value.trim());
  const st=encodeURIComponent(document.getElementById('lf-status').value);
  const url='/api/logs?page='+logsPage+'&limit='+logsPerPage+(q?'&q='+q:'')+(st?'&status='+st:'');
  try{
    const r=await api(url);
    const emails=r.emails||[];
    logsTotal=r.total||emails.length;
    currentLogsCache=emails;
    renderLogs(emails);
    const start=logsPage*logsPerPage+1,end=Math.min(start+emails.length-1,logsTotal);
    document.getElementById('pag-info').textContent=emails.length?'Showing '+start+'–'+end+' of '+logsTotal:'No logs found';
    document.getElementById('btn-prev').disabled=logsPage===0;
    document.getElementById('btn-next').disabled=end>=logsTotal;
  }catch(e){toast('Error loading logs: '+e.message,false);}
  finally{if(btn){btn.textContent='Apply';btn.disabled=false;}}
}

function renderLogs(emails){
  const tb=document.getElementById('logs-body');
  if(!emails.length){tb.innerHTML='<tr><td colspan="7"><div class="empty-state">No delivery logs found matching the filter</div></td></tr>';return;}
  tb.innerHTML=emails.map(e=>renderLogRow(e,'log-',7)).join('');
}

function applyLogsFilter(btn){logsPage=0;fetchLogs(btn);}
function resetLogsFilter(){document.getElementById('lf-q').value='';document.getElementById('lf-status').value='';logsPage=0;fetchLogs();}
function prevLogs(){if(logsPage>0){logsPage--;fetchLogs();}}
function nextLogs(){logsPage++;fetchLogs();}

// ── Log Row Renderer ───────────────────────────────────────
function renderLogRow(e,pfx,cols){
  const to=Array.isArray(e.to)?e.to.join(', '):(e.to||'—');
  const bid=pfx+esc(e.id);
  return '<tr>'
    +'<td><span class="caret" id="caret-'+bid+'" onclick="toggleDetail(&#39;'+esc(e.id)+'&#39;,&#39;'+pfx+'&#39;)">▶</span></td>'
    +'<td class="mono" style="font-size:12px"><b>'+esc(to)+'</b></td>'
    +'<td>'+esc(e.subject||'(no subject)')+'</td>'
    +'<td>'+sbadge(e.status)+'</td>'
    +'<td>'+tbadge(e.provider_used||'auto')+'</td>'
    +(cols===7?'<td class="mono" style="font-size:12px">'+(e.attempts||0)+'</td>':'')
    +'<td class="mono" style="font-size:11px;color:var(--text-secondary)">'+fmt(e.created_at)+'</td>'
  +'</tr>'
  +'<tr id="detail-'+bid+'" class="detail-row" style="display:none">'
    +'<td colspan="'+cols+'"><div class="detail-body">'
      +'<div class="detail-meta-grid">'
        +'<div class="meta-box"><div class="meta-lbl">Email ID</div><div class="meta-val">'+esc(e.id)+'</div></div>'
        +'<div class="meta-box"><div class="meta-lbl">Status</div><div class="meta-val">'+sbadge(e.status)+'</div></div>'
        +'<div class="meta-box"><div class="meta-lbl">Provider Used</div><div class="meta-val">'+esc(e.provider_used||'auto')+'</div></div>'
        +'<div class="meta-box"><div class="meta-lbl">Sender (From)</div><div class="meta-val">'+esc(e.from_email||'—')+'</div></div>'
        +'<div class="meta-box"><div class="meta-lbl">Attempts</div><div class="meta-val">'+(e.attempts||0)+' / 5</div></div>'
      +'</div>'
      +(e.error_message||e.error?'<div style="background:var(--state-danger-dim);border:1px solid var(--state-danger-border);border-radius:3px;padding:10px 14px;color:var(--state-danger);font-family:var(--font-mono);font-size:12px;"><b>Error:</b> '+esc(e.error_message||e.error)+'</div>':'')
      +'<div>'
        +'<div class="detail-tabs">'
          +'<button class="dtab active" onclick="switchBodyTab(event,&#39;'+bid+'&#39;,&#39;html&#39;)">HTML Preview</button>'
          +'<button class="dtab" onclick="switchBodyTab(event,&#39;'+bid+'&#39;,&#39;raw&#39;)">Raw Payload</button>'
        +'</div>'
        +'<div id="'+bid+'-html"><iframe class="preview-iframe" sandbox="allow-popups" referrerpolicy="no-referrer" srcdoc="'+esc(e.html_body||e.text_body||'(no preview available)')+'"></iframe></div>'
        +'<div id="'+bid+'-raw" style="display:none"><div class="detail-mono">'+esc(e.html_body||e.text_body||'(empty payload)')+'</div></div>'
      +'</div>'
    +'</div></td>'
  +'</tr>';
}

function switchBodyTab(ev,bid,tab){
  ev.target.closest('.detail-body').querySelectorAll('.dtab').forEach(t=>t.classList.remove('active'));
  ev.target.classList.add('active');
  document.getElementById(bid+'-html').style.display=tab==='html'?'':'none';
  document.getElementById(bid+'-raw').style.display=tab==='raw'?'':'none';
}

function toggleDetail(id,pfx=''){
  const dr=document.getElementById('detail-'+pfx+id);
  const cr=document.getElementById('caret-'+pfx+id);
  if(!dr) return;
  const hidden=dr.style.display==='none';
  dr.style.display=hidden?'':'none';
  if(cr) cr.classList.toggle('rotated',hidden);
}

// ── Export CSV & JSONL ─────────────────────────────────────
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
  a.download='unsent_logs_'+(new Date().toISOString().slice(0,10))+'.csv';
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
  a.download='unsent_logs_'+(new Date().toISOString().slice(0,10))+'.jsonl';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Logs exported to JSONL');
}

// ── Local Dev Helper & Init ────────────────────────────────
function useDevKey(){
  document.getElementById('ak-input').value='Ddj1ZHJYculiA34hussZFzLdgDupBzIE';
  if(document.getElementById('ak-input-hmac')) document.getElementById('ak-input-hmac').value='Ddj1ZHJYculiA34hussZFzLdgDupBzIE';
  if(document.getElementById('sk-input')) document.getElementById('sk-input').value='zuLydZWeDvZXk5t230UDWrqaeqtTwQ3K';
  doAuth();
}

['ak-input','ak-input-hmac','sk-input'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('keydown',ev=>{if(ev.key==='Enter')doAuth();});
});

if(window.location.hostname==='localhost'||window.location.hostname==='127.0.0.1'){
  const h=document.getElementById('local-dev-hint');
  if(h) h.style.display='block';
}

const urlParams=new URLSearchParams(window.location.search);
const queryKey=urlParams.get('key');
const savedKey=queryKey||sessionStorage.getItem('unsent_api_key');
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
  doAuth().then(()=>{
    const queryView=urlParams.get('view');
    const tabMap={prov:'v-prov',logs:'v-logs',docs:'v-docs',dash:'v-dash'};
    if(queryView && tabMap[queryView]) switchView(tabMap[queryView]);
  });
}
</script>
</body>
</html>`;
}
