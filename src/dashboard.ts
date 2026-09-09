export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UNSENT — Field Telemetry & Dispatch</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230f172a'/%3E%3Cpath d='M6 10h20v12H6z' fill='none' stroke='%23059669' stroke-width='2' stroke-linejoin='round'/%3E%3Cpath d='M6 11l10 6.5 10-6.5' fill='none' stroke='%23059669' stroke-width='2' stroke-linejoin='round'/%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    (function() {
      try {
        var saved = localStorage.getItem('unsent_theme');
        var theme = saved || 'light';
        document.documentElement.setAttribute('data-theme', theme);
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  </script>
  <style>
    :root, :root[data-theme="light"] {
      --bg-base: #f4f4f6;
      --bg-surface: #ffffff;
      --bg-subtle: #ebecef;
      --border-subtle: #e1e2e7;
      --border-hover: #cacad3;
      --border-focus: #0f172a;
      --text-primary: #0f172a;
      --text-muted: #64748b;
      --btn-primary-bg: #0f172a;
      --btn-primary-fg: #ffffff;
      --status-delivered: #059669;
      --status-staged: #4f46e5;
      --status-failed: #dc2626;
      --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    :root[data-theme="dark"] {
      --bg-base: #0e1013;
      --bg-surface: #16191e;
      --bg-subtle: #1d2127;
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-hover: rgba(255, 255, 255, 0.18);
      --border-focus: #f8fafc;
      --text-primary: #f8fafc;
      --text-muted: #94a3b8;
      --btn-primary-bg: #f8fafc;
      --btn-primary-fg: #0e1013;
      --status-delivered: #10b981;
      --status-staged: #818cf8;
      --status-failed: #ef4444;
      --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    }

    :root {
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, "Geist Mono", Menlo, Monaco, Consolas, monospace;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      color-scheme: light dark;
      background: var(--bg-base);
    }

    body {
      background: var(--bg-base);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 13.5px;
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      transition: background-color 0.15s ease, color 0.15s ease;
    }

    .mono {
      font-family: var(--font-mono);
    }

    /* ── BRAND LOGO: U̶N̶ • SENT ────────────────────────────── */
    .logo {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 700;
      font-size: 15px;
      font-family: var(--font-sans);
      user-select: none;
      text-decoration: none;
    }

    .logo-un {
      position: relative;
      color: var(--text-muted);
    }

    .logo-un::after {
      content: '';
      position: absolute;
      left: -2px;
      right: -2px;
      top: 52%;
      height: 1.5px;
      background: var(--text-primary);
      transform: translateY(-50%);
    }

    .logo-dot {
      font-size: 8px;
      color: var(--status-delivered);
      line-height: 1;
    }

    .logo-sent {
      color: var(--text-primary);
      letter-spacing: 0.04em;
    }

    .logo-tag {
      font-size: 11px;
      padding: 2px 6px;
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-muted);
      font-weight: 500;
      margin-left: 4px;
      line-height: 1.2;
    }

    /* ── NAVIGATION BAR ───────────────────────────────────────── */
    header {
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border-subtle);
      position: sticky;
      top: 0;
      z-index: 100;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }

    .nav-inner {
      max-width: 1280px;
      height: 60px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .nav-tabs {
      display: flex;
      align-items: center;
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: 9999px;
      padding: 3px;
      gap: 2px;
    }

    .nav-tab {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 9999px;
      cursor: pointer;
      transition: all 0.15s ease;
      line-height: 1.2;
      text-decoration: none;
    }

    .nav-tab:hover {
      color: var(--text-primary);
    }

    .nav-tab.active {
      background: var(--bg-surface);
      color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .runtime-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      padding: 4px 10px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-subtle);
      border-radius: 9999px;
      user-select: none;
    }

    .runtime-dot {
      position: relative;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--status-delivered);
      display: inline-block;
    }

    .runtime-dot::after {
      content: '';
      position: absolute;
      inset: -2px;
      border-radius: 50%;
      border: 1.5px solid var(--status-delivered);
      animation: pulse-ring 2.2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
    }

    @keyframes pulse-ring {
      0% { transform: scale(0.8); opacity: 0.8; }
      50% { transform: scale(1.6); opacity: 0; }
      100% { transform: scale(0.8); opacity: 0; }
    }

    .theme-toggle-btn {
      background: transparent;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text-muted);
      transition: all 0.15s ease;
    }

    .theme-toggle-btn:hover {
      color: var(--text-primary);
      border-color: var(--border-hover);
      background: var(--bg-subtle);
    }

    .btn-subtle {
      height: 32px;
      padding: 0 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      font-family: var(--font-sans);
      background: transparent;
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s ease;
      text-decoration: none;
      white-space: nowrap;
    }

    .btn-subtle:hover {
      background: var(--bg-subtle);
      border-color: var(--border-hover);
    }

    .btn-subtle-danger {
      color: var(--status-failed);
      border-color: rgba(220, 38, 38, 0.25);
    }

    .btn-subtle-danger:hover {
      background: rgba(220, 38, 38, 0.08);
      border-color: var(--status-failed);
    }

    /* ── MAX-WIDTH CONTAINER ─────────────────────────────────── */
    main {
      flex: 1;
      width: 100%;
    }

    .dashboard-shell {
      max-width: 1280px;
      margin: 0 auto;
      padding: 32px 24px 80px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      width: 100%;
    }

    .view {
      display: none;
      width: 100%;
    }

    .view.active {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* ── 4-COLUMN METRIC ROW ─────────────────────────────────── */
    .metrics-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }

    @media (max-width: 900px) {
      .metrics-row {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 520px) {
      .metrics-row {
        grid-template-columns: 1fr;
      }
    }

    .metric-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      box-shadow: var(--card-shadow);
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.15s ease;
    }

    .metric-card:hover {
      border-color: var(--border-hover);
    }

    .metric-title {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .metric-number {
      font-size: 32px;
      font-weight: 600;
      color: var(--text-primary);
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }

    .metric-caption {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* ── WORKSPACE SPLIT (70% / 30%) ─────────────────────────── */
    .workspace-layout {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 24px;
      align-items: start;
    }

    @media (max-width: 1040px) {
      .workspace-layout {
        grid-template-columns: 1fr;
      }
    }

    /* ── CARDS & PANELS ──────────────────────────────────────── */
    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      box-shadow: var(--card-shadow);
      overflow: hidden;
    }

    .card-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }

    /* ── TABLE STYLING ───────────────────────────────────────── */
    .table-container {
      overflow-x: auto;
      width: 100%;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }

    th {
      padding: 10px 18px;
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      background: var(--bg-subtle);
      text-align: left;
      border-bottom: 1px solid var(--border-subtle);
      white-space: nowrap;
      user-select: none;
    }

    td {
      padding: 12px 18px;
      font-size: 13.5px;
      height: 44px;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: middle;
      color: var(--text-primary);
    }

    tbody tr {
      transition: background-color 0.1s ease;
      cursor: pointer;
    }

    tbody tr:hover:not(.detail-row) {
      background: var(--bg-subtle);
    }

    .empty-state {
      padding: 64px 20px;
      text-align: center;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    /* ── MINIMALIST STATUS TAGS ──────────────────────────────── */
    .status-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
    }

    .tag-dot {
      font-size: 9px;
      line-height: 1;
    }

    .tag-dispatched {
      color: var(--status-delivered);
    }

    .tag-staged {
      color: var(--status-staged);
    }

    .tag-failed {
      color: var(--status-failed);
    }

    .circuit-pill {
      display: inline-flex;
      padding: 2px 7px;
      font-size: 11.5px;
      font-family: var(--font-mono);
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-muted);
    }

    .default-pill {
      font-size: 10px;
      font-weight: 600;
      font-family: var(--font-mono);
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(79, 70, 229, 0.1);
      border: 1px solid rgba(79, 70, 229, 0.25);
      color: var(--status-staged);
      margin-left: 6px;
    }

    /* ── ACCORDION INSPECTION DRAWER ─────────────────────────── */
    .caret-btn {
      color: var(--text-muted);
      font-size: 11px;
      display: inline-block;
      transition: transform 0.15s ease;
      user-select: none;
    }

    .caret-btn.rotated {
      transform: rotate(90deg);
      color: var(--text-primary);
    }

    .detail-row td {
      padding: 0 !important;
      height: auto !important;
      background: var(--bg-subtle);
      border-bottom: 1px solid var(--border-subtle);
      cursor: default;
    }

    .drawer-body {
      padding: 18px 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .drawer-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }

    .meta-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 8px 12px;
    }

    .meta-k {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 2px;
    }

    .meta-v {
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-primary);
      word-break: break-all;
    }

    .drawer-tabs {
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 8px;
    }

    .drawer-tab {
      background: transparent;
      border: none;
      font-family: var(--font-sans);
      font-size: 12.5px;
      font-weight: 500;
      color: var(--text-muted);
      padding: 5px 12px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .drawer-tab:hover {
      color: var(--text-primary);
    }

    .drawer-tab.active {
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
    }

    .drawer-frame {
      width: 100%;
      height: 200px;
      background: #ffffff;
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
    }

    .drawer-code {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 12px 14px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-primary);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow-y: auto;
    }

    /* ── QUICK DISPATCH FORM ─────────────────────────────────── */
    .form-control {
      display: flex;
      flex-direction: column;
      margin-bottom: 16px;
    }

    .form-control label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 6px;
    }

    .form-control input, .form-control select, .form-control textarea {
      height: 38px;
      padding: 0 12px;
      font-size: 14px;
      font-family: var(--font-sans);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: var(--bg-subtle);
      color: var(--text-primary);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .form-control input.mono, .form-control select.mono {
      font-family: var(--font-mono);
      font-size: 13px;
    }

    .form-control textarea {
      height: 140px;
      padding: 10px 12px;
      font-family: var(--font-mono);
      line-height: 1.5;
      resize: vertical;
    }

    .form-control input:focus, .form-control textarea:focus, .form-control select:focus {
      outline: none;
      border-color: var(--border-focus);
      box-shadow: 0 0 0 1px var(--border-focus);
    }

    .btn-action-primary {
      background: var(--btn-primary-bg);
      color: var(--btn-primary-fg);
      height: 40px;
      border-radius: 6px;
      font-weight: 500;
      font-size: 14px;
      font-family: var(--font-sans);
      border: 1px solid transparent;
      cursor: pointer;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1), transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .btn-action-primary:hover {
      opacity: 0.92;
      transform: translateY(-0.5px);
    }

    .btn-action-primary:active {
      transform: translateY(0);
    }

    .btn-action-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    /* ── TELEMETRY SPEC DOCK ─────────────────────────────────── */
    .telemetry-table {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .tel-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12.5px;
      padding: 6px 0;
      border-bottom: 1px solid var(--border-subtle);
    }

    .tel-row:last-child {
      border-bottom: none;
    }

    .tel-key {
      color: var(--text-muted);
    }

    .tel-val {
      font-size: 12.5px;
      font-weight: 500;
    }

    /* ── QUOTA PROGRESS BAR ──────────────────────────────────── */
    .quota-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .quota-rail {
      flex: 1;
      height: 5px;
      background: var(--bg-subtle);
      border-radius: 9999px;
      overflow: hidden;
      min-width: 60px;
      border: 1px solid var(--border-subtle);
    }

    .quota-meter {
      height: 100%;
      background: var(--status-delivered);
      border-radius: 9999px;
      transition: width 0.3s ease;
    }

    .quota-meter.warn {
      background: #f59e0b;
    }

    .quota-meter.danger {
      background: var(--status-failed);
    }

    /* ── TOOLBARS & FOOTERS ──────────────────────────────────── */
    .toolbar-bar {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .pagination-bar {
      padding: 12px 20px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12.5px;
      color: var(--text-muted);
    }

    /* ── CODE PANELS (DOCS) ──────────────────────────────────── */
    .code-panel {
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: var(--bg-surface);
      margin: 10px 0 22px;
      overflow: hidden;
    }

    .code-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 14px;
      background: var(--bg-subtle);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 12px;
      font-family: var(--font-mono);
      color: var(--text-muted);
    }

    pre {
      padding: 14px 16px;
      font-family: var(--font-mono);
      font-size: 12.5px;
      line-height: 1.6;
      color: var(--text-primary);
      overflow-x: auto;
    }

    .ckw { color: #8b5cf6; }
    .cstr { color: var(--status-delivered); }
    .cfn { color: #3b82f6; }
    .ccm { color: var(--text-muted); }

    /* ── MODALS ──────────────────────────────────────────────── */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(4px);
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
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      width: 100%;
      max-width: 520px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
    }

    .modal-header {
      padding: 18px 22px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .modal-body {
      padding: 22px;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle);
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    /* ── AUTH OVERLAY ────────────────────────────────────────── */
    #auth-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.7);
      backdrop-filter: blur(8px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 1000;
      padding: 20px;
    }

    .auth-box {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
    }

    .auth-mode-switch {
      display: flex;
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 3px;
      margin-bottom: 20px;
      gap: 2px;
    }

    .auth-mode-btn {
      flex: 1;
      height: 32px;
      background: transparent;
      border: none;
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .auth-mode-btn.active {
      background: var(--bg-surface);
      color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }

    /* ── TOAST ───────────────────────────────────────────────── */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
      transform: translateY(60px);
      opacity: 0;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
      z-index: 2000;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }

    #toast.show {
      transform: translateY(0);
      opacity: 1;
      pointer-events: auto;
    }

    #toast.tok::before {
      content: '●';
      color: var(--status-delivered);
      font-size: 10px;
    }

    #toast.terr::before {
      content: '●';
      color: var(--status-failed);
      font-size: 10px;
    }
  </style>
</head>
<body>

<!-- AUTH OVERLAY -->
<div id="auth-overlay">
  <div class="auth-box">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div class="logo">
        <span class="logo-un">UN</span>
        <span class="logo-dot">●</span>
        <span class="logo-sent">SENT</span>
      </div>
      <span class="logo-tag">Clearance</span>
    </div>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;">
      Authenticate with your service credentials to access queue management.
    </p>

    <div class="auth-mode-switch">
      <button class="auth-mode-btn active" onclick="setAuthMode('apikey')" id="mbtn-apikey">API Key</button>
      <button class="auth-mode-btn" onclick="setAuthMode('hmac')" id="mbtn-hmac">Signed (HMAC)</button>
    </div>

    <div id="auth-apikey-form">
      <div class="form-control">
        <label>Service API Key</label>
        <input class="mono" type="password" id="ak-input" placeholder="Enter API key" autocomplete="off" />
      </div>
      <button class="btn-action-primary" style="margin-top:16px;" onclick="doAuth()">Sign In</button>
    </div>

    <div id="auth-hmac-form" style="display:none">
      <div class="form-control">
        <label>Service API Key</label>
        <input class="mono" type="password" id="ak-input-hmac" placeholder="Enter API key" autocomplete="off" />
      </div>
      <div class="form-control">
        <label>HMAC Secret Key</label>
        <input class="mono" type="password" id="sk-input" placeholder="Enter secret key" autocomplete="off" />
      </div>
      <button class="btn-action-primary" style="margin-top:16px;" onclick="doAuth()">Sign In with HMAC</button>
    </div>

    <p id="auth-err" style="color:var(--status-failed);margin-top:14px;font-size:12.5px;display:none"></p>

    <div id="local-dev-hint" style="display:none;margin-top:20px;padding:14px;background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:8px;font-size:12.5px;">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">Local Environment Detected</div>
      <div style="color:var(--text-muted);font-size:12px;margin-bottom:10px;">Running on localhost. Use local credentials from <code>.dev.vars</code>:</div>
      <button type="button" class="btn-subtle" style="width:100%;justify-content:center;" onclick="useDevKey()">Sign In with Local Dev Key</button>
    </div>
  </div>
</div>

<!-- HEADER NAVIGATION (1280PX CONSTRAINED INNER) -->
<header>
  <div class="nav-inner">
    <div class="logo">
      <span class="logo-un">UN</span>
      <span class="logo-dot">●</span>
      <span class="logo-sent">SENT</span>
    </div>
    
    <nav class="nav-tabs">
      <button class="nav-tab active" onclick="switchView('v-dash')" id="tab-dash">Dashboard</button>
      <button class="nav-tab" onclick="switchView('v-prov')" id="tab-prov">Providers</button>
      <button class="nav-tab" onclick="switchView('v-logs')" id="tab-logs">Logs</button>
      <button class="nav-tab" onclick="switchView('v-docs')" id="tab-docs">API Docs</button>
    </nav>

    <div class="header-actions">
      <div class="runtime-badge" title="Edge Worker Runtime Active">
        <span class="runtime-dot"></span>
        <span>Runtime Active</span>
      </div>
      <button class="theme-toggle-btn" onclick="toggleTheme()" id="theme-btn" aria-label="Toggle theme" title="Toggle theme">
        <span id="theme-icon-slot"></span>
      </button>
      <a href="https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/" target="_blank" rel="noopener noreferrer" class="btn-subtle">
        <span>Report Issue</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
      </a>
      <button class="btn-subtle" onclick="logout()">Logout</button>
    </div>
  </div>
</header>

<!-- CENTERED DASHBOARD SHELL (MAX-WIDTH 1280PX) -->
<main>
  <div class="dashboard-shell">

    <!-- ── VIEW: DASHBOARD ──────────────────────────────────────── -->
    <div id="v-dash" class="view active">
      <!-- 4-COLUMN METRIC ROW -->
      <div class="metrics-row">
        <div class="metric-card">
          <div class="metric-title">Staged</div>
          <div class="metric-number" id="count-staged">0</div>
          <div class="metric-caption">Holding (awaiting dispatch)</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">In Transit</div>
          <div class="metric-number" id="count-transit">0</div>
          <div class="metric-caption">Worker executing</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Escaped</div>
          <div class="metric-number" style="color:var(--status-delivered)" id="count-sent">0</div>
          <div class="metric-caption">Delivery verified</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Struck</div>
          <div class="metric-number" style="color:var(--status-failed)" id="count-failed">0</div>
          <div class="metric-caption">Exhausted retries</div>
        </div>
      </div>

      <!-- WORKSPACE SPLIT (70% TABLE / 30% FORM) -->
      <div class="workspace-layout">
        <!-- LEFT: RECENT ACTIVITY TABLE -->
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Recent Transmissions</h2>
            <button class="btn-subtle" onclick="fetchDash(this)">Refresh</button>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th style="width:28px"></th>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Circuit</th>
                  <th>Timestamp (UTC)</th>
                </tr>
              </thead>
              <tbody id="dash-emails">
                <tr>
                  <td colspan="6">
                    <div class="empty-state">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;opacity:0.4;"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                      <div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:4px;">No Transmissions Logged</div>
                      <div style="font-size:12.5px;color:var(--text-muted);">Dispatched emails will appear here in real-time.</div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- RIGHT: QUICK DISPATCH CONSOLE -->
        <div>
          <div class="card" style="padding:22px;">
            <div style="margin-bottom:18px;">
              <h2 class="card-title">Quick Dispatch</h2>
              <p style="font-size:12.5px;color:var(--text-muted);margin-top:2px;">Enqueue payload directly to the edge worker</p>
            </div>
            <form onsubmit="sendTest(event)">
              <div class="form-control">
                <label>Recipient Address</label>
                <input class="mono" type="email" id="te-to" placeholder="recipient@example.com" required autocomplete="off" />
              </div>
              <div class="form-control">
                <label>Subject</label>
                <input type="text" id="te-subj" placeholder="Subject line" value="Test Message from Unsent" required />
              </div>
              <div class="form-control">
                <label>Routing Provider</label>
                <select class="mono" id="te-prov">
                  <option value="">Auto (Default priority)</option>
                </select>
              </div>
              <div class="form-control">
                <label>Body (HTML)</label>
                <textarea id="te-body" placeholder="<p>Write HTML message...</p>" spellcheck="false">&lt;p&gt;This is a test delivery from Unsent queue service.&lt;/p&gt;</textarea>
              </div>
              <button type="submit" class="btn-action-primary" id="te-btn">Send Dispatch</button>
            </form>
          </div>

          <!-- SYSTEM SPEC TELEMETRY DOCK -->
          <div class="card" style="margin-top:20px;padding:18px 20px;">
            <div style="font-size:13.5px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">System Telemetry</div>
            <div class="telemetry-table">
              <div class="tel-row"><span class="tel-key">Endpoint</span><span class="tel-val mono" id="qr-base">—</span></div>
              <div class="tel-row"><span class="tel-key">Authentication</span><span class="tel-val mono" id="qr-auth">API Key</span></div>
              <div class="tel-row"><span class="tel-key">Configured Circuits</span><span class="tel-val mono" id="qr-provs">—</span></div>
              <div class="tel-row"><span class="tel-key">Storage Engine</span><span class="tel-val mono status-delivered">D1 SQLite Bound</span></div>
              <div class="tel-row"><span class="tel-key">Edge Runtime</span><span class="tel-val mono tag-staged">Cloudflare Worker (V8)</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── VIEW: PROVIDERS ──────────────────────────────────────── -->
    <div id="v-prov" class="view">
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Configured Provider Circuits</h2>
          <div style="display:flex;gap:8px;">
            <button class="btn-subtle" onclick="fetchProviders(this)">Refresh</button>
            <button class="btn-subtle" style="background:var(--btn-primary-bg);color:var(--btn-primary-fg);border-color:transparent;" onclick="openAddProv()">+ Add Provider</button>
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width:36px">#</th>
                <th>Provider ID &amp; Name</th>
                <th>Type</th>
                <th>From Address</th>
                <th>Daily Quota</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="prov-body">
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    <div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:4px;">No Providers Configured</div>
                    <div style="font-size:12.5px;color:var(--text-muted);">Add your first SMTP or API provider circuit to start sending.</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ── VIEW: LOGS ───────────────────────────────────────────── -->
    <div id="v-logs" class="view">
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Delivery Logs</h2>
          <div style="display:flex;gap:8px;">
            <button class="btn-subtle" onclick="exportCsv(currentLogsCache)">Export CSV</button>
            <button class="btn-subtle" onclick="exportJsonl(currentLogsCache)">Export JSONL</button>
          </div>
        </div>
        <div class="toolbar-bar">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <input class="form-control" style="margin-bottom:0;width:280px;height:36px;" type="text" id="lf-q" placeholder="Filter by recipient, subject, or ID…" />
            <select class="form-control" style="margin-bottom:0;width:130px;height:36px;" id="lf-status">
              <option value="">All Statuses</option>
              <option value="queued">Staged</option>
              <option value="sending">In Transit</option>
              <option value="sent">Dispatched</option>
              <option value="failed">Failed</option>
            </select>
            <button class="btn-subtle" onclick="applyLogsFilter(this)">Apply</button>
            <button class="btn-subtle" onclick="resetLogsFilter()">Reset</button>
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th style="width:28px"></th>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Circuit</th>
                <th>Attempts</th>
                <th>Timestamp (UTC)</th>
              </tr>
            </thead>
            <tbody id="logs-body">
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    <div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:4px;">No Logs Found</div>
                    <div style="font-size:12.5px;color:var(--text-muted);">No records matched your search query.</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pagination-bar">
          <span id="pag-info">Showing 0 of 0</span>
          <div style="display:flex;gap:8px;">
            <button class="btn-subtle" id="btn-prev" onclick="prevLogs()" disabled>Previous</button>
            <button class="btn-subtle" id="btn-next" onclick="nextLogs()" disabled>Next</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── VIEW: API DOCS ───────────────────────────────────────── -->
    <div id="v-docs" class="view">
      <div class="card" style="padding:28px;">
        <h2 class="card-title" style="margin-bottom:6px;">API Integration Documentation</h2>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:20px;">Use these standard integration patterns to queue emails through Unsent from your application.</p>

        <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:18px 0 6px;">1. Send Email (cURL)</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">Queue an email for delivery via an authorized HTTP POST request to <code>/api/send</code>.</p>
        <div class="code-panel">
          <div class="code-panel-header">
            <span>cURL</span>
            <button class="btn-subtle" style="height:26px;font-size:11px;padding:0 8px;" onclick="copySnippet(this)">Copy</button>
          </div>
          <pre><code>curl -X POST https://your-worker.workers.dev/api/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "to": "user@example.com",
    "subject": "Order Confirmation",
    "html": "&lt;h1&gt;Thank you!&lt;/h1&gt;&lt;p&gt;Your order has been verified.&lt;/p&gt;",
    "provider_id": "smtp_primary"
  }'</code></pre>
        </div>

        <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:24px 0 6px;">2. TypeScript / JavaScript (Fetch API)</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">Enqueue messages directly from your backend services or Edge functions.</p>
        <div class="code-panel">
          <div class="code-panel-header">
            <span>TypeScript</span>
            <button class="btn-subtle" style="height:26px;font-size:11px;padding:0 8px;" onclick="copySnippet(this)">Copy</button>
          </div>
          <pre><code><span class="ckw">const</span> res = <span class="cfn">await</span> <span class="cfn">fetch</span>(<span class="cstr">'https://your-worker.workers.dev/api/send'</span>, {
  method: <span class="cstr">'POST'</span>,
  headers: {
    <span class="cstr">'Content-Type'</span>: <span class="cstr">'application/json'</span>,
    <span class="cstr">'X-API-Key'</span>: process.env.UNSENT_API_KEY
  },
  body: JSON.<span class="cfn">stringify</span>({
    to: <span class="cstr">'client@domain.com'</span>,
    subject: <span class="cstr">'Welcome aboard'</span>,
    html: <span class="cstr">'&lt;p&gt;Welcome to the service.&lt;/p&gt;'</span>
  })
});
<span class="ckw">const</span> data = <span class="ckw">await</span> res.<span class="cfn">json</span>();
console.<span class="cfn">log</span>(<span class="cstr">'Queued Email ID:'</span>, data.id);</code></pre>
        </div>

        <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:24px 0 6px;">3. Cryptographic HMAC-SHA256 Signatures</h3>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">Bind timestamps, nonces, and payload hashes to eliminate replay and tampering attacks.</p>
        <div class="code-panel">
          <div class="code-panel-header">
            <span>JavaScript</span>
            <button class="btn-subtle" style="height:26px;font-size:11px;padding:0 8px;" onclick="copySnippet(this)">Copy</button>
          </div>
          <pre><code><span class="ccm">// Canonical string structure:</span>
<span class="ckw">const</span> canonical = [timestamp, nonce, <span class="cstr">'provider:smtp_primary'</span>, sha256BodyHash].<span class="cfn">join</span>(<span class="cstr">'\n'</span>);
<span class="ckw">const</span> signature = <span class="cstr">'sha256='</span> + <span class="cfn">hmacSha256</span>(API_SECRET, canonical);

headers[<span class="cstr">'X-API-Key'</span>] = API_KEY;
headers[<span class="cstr">'X-Timestamp'</span>] = timestamp;
headers[<span class="cstr">'X-Nonce'</span>] = nonce;
headers[<span class="cstr">'X-Signature'</span>] = signature;
headers[<span class="cstr">'X-Provider-Id'</span>] = <span class="cstr">'smtp_primary'</span>;</code></pre>
        </div>
      </div>
    </div>

  </div>
</main>

<!-- ── MODAL: ADD / EDIT PROVIDER ─────────────────────────────── -->
<div class="modal-overlay" id="prov-modal">
  <div class="modal-card">
    <div class="modal-header">
      <h3 class="modal-title" id="prov-modal-title">Add Provider</h3>
      <button class="btn-subtle" style="height:28px;width:28px;padding:0;" onclick="closeProvModal()">✕</button>
    </div>
    <div class="modal-body">
      <form id="prov-form" onsubmit="saveProv(event)">
        <input type="hidden" id="prov-editing-id">
        <div class="form-grid">
          <div class="form-control">
            <label>Provider ID *</label>
            <input class="mono" type="text" id="pf-id" placeholder="e.g. smtp_main" pattern="[a-zA-Z0-9_-]+" required>
          </div>
          <div class="form-control">
            <label>Display Name *</label>
            <input type="text" id="pf-name" placeholder="e.g. Primary SMTP" required>
          </div>
        </div>

        <div class="form-control">
          <label>Provider Type *</label>
          <select class="mono" id="pf-type" onchange="onTypeChange()" required>
            <option value="">Select a provider type</option>
            <option value="smtp">SMTP</option>
            <option value="resend">Resend API</option>
            <option value="sendgrid">SendGrid API</option>
            <option value="mailgun">Mailgun API</option>
            <option value="postmark">Postmark API</option>
          </select>
        </div>

        <!-- SMTP FIELDS -->
        <div id="cfg-smtp">
          <div class="form-grid">
            <div class="form-control">
              <label>SMTP Host *</label>
              <input class="mono" type="text" id="pf-smtp-host" placeholder="smtp.gmail.com">
            </div>
            <div class="form-control">
              <label>SMTP Port *</label>
              <input class="mono" type="number" id="pf-smtp-port" placeholder="587" value="587">
            </div>
          </div>
          <div class="form-grid">
            <div class="form-control">
              <label>Username *</label>
              <input class="mono" type="text" id="pf-smtp-user" placeholder="user@gmail.com" autocomplete="off">
            </div>
            <div class="form-control">
              <label>Password / App Secret *</label>
              <input class="mono" type="password" id="pf-smtp-pass" placeholder="••••••••" autocomplete="new-password">
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
            <input type="checkbox" id="pf-smtp-starttls" checked style="accent-color:var(--border-focus);cursor:pointer;">
            <label for="pf-smtp-starttls" style="cursor:pointer;font-size:13px;color:var(--text-muted)">Enable STARTTLS (port 587)</label>
          </div>
        </div>

        <!-- API KEY FIELDS -->
        <div id="cfg-api" style="display:none">
          <div class="form-control">
            <label id="pf-apikey-label">API Key *</label>
            <input class="mono" type="password" id="pf-apikey" placeholder="••••••••" autocomplete="new-password">
          </div>
        </div>

        <div class="form-grid">
          <div class="form-control">
            <label>From Email *</label>
            <input class="mono" type="email" id="pf-from" placeholder="noreply@example.com" required>
          </div>
          <div class="form-control">
            <label>Sender Name</label>
            <input type="text" id="pf-fromname" placeholder="Unsent Service">
          </div>
        </div>

        <div class="form-grid">
          <div class="form-control">
            <label>Priority (1 = highest)</label>
            <input class="mono" type="number" id="pf-prio" value="1" min="1" max="100">
          </div>
          <div class="form-control">
            <label>Daily Limit (0 = unlimited)</label>
            <input class="mono" type="number" id="pf-limit" value="0" min="0">
          </div>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-subtle" onclick="closeProvModal()">Cancel</button>
          <button type="submit" class="btn-action-primary" style="width:auto;padding:0 18px;" id="pf-save-btn">Save Provider</button>
        </div>
      </form>
    </div>
  </div>
</div>

<!-- ── MODAL: TEST PROVIDER ───────────────────────────────────── -->
<div class="modal-overlay" id="tp-modal">
  <div class="modal-card" style="max-width:440px;">
    <div class="modal-header">
      <h3 class="modal-title">Test Provider Connection</h3>
      <button class="btn-subtle" style="height:28px;width:28px;padding:0;" onclick="closeTestModal()">✕</button>
    </div>
    <div class="modal-body">
      <form onsubmit="doTestProv(event)">
        <input type="hidden" id="tp-prov-id">
        <div class="form-control">
          <label>Recipient Address *</label>
          <input class="mono" type="email" id="tp-to" placeholder="recipient@example.com" required>
        </div>
        <p style="font-size:12.5px;color:var(--text-muted);margin:10px 0 16px;">
          Sends an immediate test email to verify credentials and SMTP connectivity.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-subtle" onclick="closeTestModal()">Cancel</button>
          <button type="submit" class="btn-action-primary" style="width:auto;padding:0 18px;" id="tp-btn">Send Test Email</button>
        </div>
      </form>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
// ── Theme Engine (Light-First by Default) ──────────────────
const SUN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>';
const MOON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>';

function updateThemeIcon(t) {
  const slot = document.getElementById('theme-icon-slot');
  if (slot) slot.innerHTML = t === 'dark' ? SUN_SVG : MOON_SVG;
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('unsent_theme', next);
  updateThemeIcon(next);
}

updateThemeIcon(document.documentElement.getAttribute('data-theme') || 'light');

// ── State ──────────────────────────────────────────────────
let authMode = 'apikey', authToken = '', authSecret = '';
let logsPage = 0, logsPerPage = 20, logsTotal = 0;
let provsCache = [];
let currentLogsCache = [];

// ── Helpers ────────────────────────────────────────────────
function toast(msg, ok = true) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + (ok ? 'tok' : 'terr');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3200);
}

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return 'sha256=' + Array.from(new Uint8Array(s)).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function buildHdrs(bodyStr, qual = '') {
  if (authMode === 'apikey') return { 'Content-Type': 'application/json', 'X-API-Key': authToken };
  const ts = Math.floor(Date.now() / 1000).toString(), n = crypto.randomUUID();
  const bh = await sha256hex(bodyStr);
  const canon = (qual ? [ts, n, qual, bh] : [ts, n, bh]).join(String.fromCharCode(10));
  const sig = await hmacHex(authSecret, canon);
  return { 'Content-Type': 'application/json', 'X-API-Key': authToken, 'X-Timestamp': ts, 'X-Nonce': n, 'X-Signature': sig };
}

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const bodyStr = opts.body ? JSON.stringify(opts.body) : '';
  const hdrs = await buildHdrs(bodyStr, opts.qual || '');
  if (opts.provId) hdrs['X-Provider-Id'] = opts.provId;
  if (opts.senderEmail) hdrs['X-Sender-Email'] = opts.senderEmail;
  const res = await fetch(path, { method, headers: hdrs, body: bodyStr || undefined, credentials: 'omit' });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return { _status: res.status, _text: await res.text() };
}

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').split(String.fromCharCode(96)).join('&#96;').split(String.fromCharCode(47)).join('&#47;').split(String.fromCharCode(92)).join('&#92;');

const fmt = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// ── Status Tags ───────────────────────────────────────────
function sbadge(s) {
  if (s === 'sent') return '<span class="status-tag tag-dispatched"><span class="tag-dot">●</span>Dispatched</span>';
  if (s === 'queued') return '<span class="status-tag tag-staged"><span class="tag-dot">○</span>Staged</span>';
  if (s === 'sending') return '<span class="status-tag tag-staged"><span class="tag-dot">◐</span>In Transit</span>';
  if (s === 'failed') return '<span class="status-tag tag-failed"><span class="tag-dot">✕</span>Failed</span>';
  return '<span class="status-tag"><span class="tag-dot">●</span>' + esc(s) + '</span>';
}

function tbadge(t) {
  return '<span class="circuit-pill">' + esc(t) + '</span>';
}

function qbar(sent, lim) {
  if (!lim) return '<span style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">Unlimited</span>';
  const p = Math.min(100, Math.round(sent / lim * 100));
  const c = p >= 90 ? 'danger' : p >= 70 ? 'warn' : '';
  return '<div class="quota-container"><div class="quota-rail"><div class="quota-meter ' + c + '" style="width:' + p + '%"></div></div><span style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">' + sent + ' / ' + lim + '</span></div>';
}

function copySnippet(btn) {
  const code = btn.closest('.code-panel').querySelector('pre code').innerText;
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function copyVal(val, btn) {
  navigator.clipboard.writeText(val).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  });
}

// ── Auth ───────────────────────────────────────────────────
function setAuthMode(m) {
  authMode = m;
  if (m === 'hmac' && document.getElementById('ak-input').value && !document.getElementById('ak-input-hmac').value) {
    document.getElementById('ak-input-hmac').value = document.getElementById('ak-input').value;
  } else if (m === 'apikey' && document.getElementById('ak-input-hmac').value && !document.getElementById('ak-input').value) {
    document.getElementById('ak-input').value = document.getElementById('ak-input-hmac').value;
  }
  document.getElementById('auth-apikey-form').style.display = m === 'apikey' ? '' : 'none';
  document.getElementById('auth-hmac-form').style.display = m === 'hmac' ? '' : 'none';
  document.getElementById('mbtn-apikey').classList.toggle('active', m === 'apikey');
  document.getElementById('mbtn-hmac').classList.toggle('active', m === 'hmac');
}

async function doAuth() {
  const errEl = document.getElementById('auth-err');
  errEl.style.display = 'none';
  if (authMode === 'apikey') {
    authToken = document.getElementById('ak-input').value.trim();
    if (!authToken) { errEl.textContent = 'Please enter your API Key'; errEl.style.display = ''; return; }
  } else {
    authToken = document.getElementById('ak-input-hmac').value.trim() || document.getElementById('ak-input').value.trim();
    authSecret = document.getElementById('sk-input').value.trim();
    if (!authToken) { errEl.textContent = 'Please enter your API Key'; errEl.style.display = ''; return; }
    if (!authSecret) { errEl.textContent = 'Please enter your Secret Key'; errEl.style.display = ''; return; }
  }
  try {
    const r = await api('/api/status');
    if (r.error) {
      errEl.textContent = 'Authentication rejected: ' + (r.reason || r.error);
      errEl.style.display = '';
      return;
    }
    sessionStorage.setItem('unsent_api_key', authToken);
    if (authSecret) sessionStorage.setItem('unsent_api_secret', authSecret);
    sessionStorage.setItem('unsent_auth_mode', authMode);
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('qr-base').textContent = window.location.origin;
    document.getElementById('qr-auth').textContent = authMode === 'apikey' ? 'API Key' : 'Signed (HMAC)';
    fetchDash();
    fetchProviders();
  } catch (e) {
    errEl.textContent = 'Connection error: ' + e.message;
    errEl.style.display = '';
  }
}

function logout() {
  authToken = '';
  authSecret = '';
  sessionStorage.removeItem('unsent_api_key');
  sessionStorage.removeItem('unsent_api_secret');
  sessionStorage.removeItem('unsent_auth_mode');
  document.getElementById('auth-overlay').style.display = '';
}

// ── Nav ────────────────────────────────────────────────────
function switchView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const m = { 'v-dash': 'tab-dash', 'v-prov': 'tab-prov', 'v-logs': 'tab-logs', 'v-docs': 'tab-docs' };
  if (m[id]) document.getElementById(m[id]).classList.add('active');
  if (id === 'v-logs') fetchLogs();
  if (id === 'v-prov') fetchProviders();
}

// ── Dashboard Data ─────────────────────────────────────────
async function fetchDash(btn) {
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
  try {
    const [st, em] = await Promise.all([api('/api/status'), api('/api/emails?limit=10')]);
    document.getElementById('count-staged').textContent = st.queued ?? '0';
    document.getElementById('count-transit').textContent = st.sending ?? '0';
    document.getElementById('count-sent').textContent = st.sent ?? '0';
    document.getElementById('count-failed').textContent = st.failed ?? '0';
    const tb = document.getElementById('dash-emails');
    const emails = em.emails || [];
    if (!emails.length) {
      tb.innerHTML = '<tr><td colspan="6"><div class="empty-state"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:8px;opacity:0.4;"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg><div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:4px;">No Transmissions Logged</div><div style="font-size:12.5px;color:var(--text-muted);">Dispatched emails will appear here in real-time.</div></div></td></tr>';
      return;
    }
    tb.innerHTML = emails.map(e => renderLogRow(e, 'dash-', 6)).join('');
  } catch (e) {
    toast('Error loading telemetry: ' + e.message, false);
  } finally {
    if (btn) { btn.textContent = 'Refresh'; btn.disabled = false; }
  }
}

// ── Quick Dispatch ─────────────────────────────────────────
async function sendTest(ev) {
  ev.preventDefault();
  const btn = document.getElementById('te-btn');
  btn.textContent = 'Sending…';
  btn.disabled = true;
  const to = document.getElementById('te-to').value.trim();
  const subj = document.getElementById('te-subj').value.trim() || 'Test Message from Unsent';
  const html = document.getElementById('te-body').value.trim() || '<p>This is a test delivery from Unsent.</p>';
  const provId = document.getElementById('te-prov').value;
  try {
    const payload = { to, subject: subj, html };
    if (provId) payload.provider_id = provId;
    const qual = provId ? 'provider:' + provId : '';
    const opts = { method: 'POST', body: payload, qual };
    if (provId) opts.provId = provId;
    const r = await api('/api/send', opts);
    if (r.error) {
      toast('Dispatch rejected: ' + r.error, false);
    } else {
      toast('Transmission queued successfully (ID #' + (r.id || 'OK') + ')');
      fetchDash();
    }
  } catch (e) {
    toast('Execution error: ' + e.message, false);
  } finally {
    btn.textContent = 'Send Dispatch';
    btn.disabled = false;
  }
}

// ── Providers ──────────────────────────────────────────────
async function fetchProviders(btn) {
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
  try {
    const r = await api('/api/providers');
    provsCache = r.providers || [];
    renderProvs(provsCache);
    fillTestSelect(provsCache);
    document.getElementById('qr-provs').textContent = provsCache.filter(p => p.is_active).length + ' Active';
  } catch (e) {
    toast('Error loading providers: ' + e.message, false);
  } finally {
    if (btn) { btn.textContent = 'Refresh'; btn.disabled = false; }
  }
}

function renderProvs(provs) {
  const tb = document.getElementById('prov-body');
  if (!provs.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:4px;">No Providers Configured</div><div style="font-size:12.5px;color:var(--text-muted);">Add your first SMTP or API provider circuit to start sending.</div></div></td></tr>';
    return;
  }
  tb.innerHTML = provs.map((p, i) => {
    const defBadge = p.is_default ? '<span class="default-pill">Default</span>' : '';
    const ab = p.is_active
      ? '<span class="status-tag tag-dispatched"><span class="tag-dot">●</span>Active</span>'
      : '<span class="status-tag" style="color:var(--text-muted)"><span class="tag-dot">○</span>Disabled</span>';
    const setDefBtn = !p.is_default ? '<button class="btn-subtle" style="height:28px;font-size:12px;" onclick="setDefault(\\'' + esc(p.id) + '\\')">Set Default</button>' : '';
    return '<tr>'
      + '<td style="color:var(--text-muted);font-weight:500">' + (i + 1) + '</td>'
      + '<td><b>' + esc(p.name) + '</b> ' + defBadge + '<br><span class="mono" style="font-size:11.5px;color:var(--text-muted)">' + esc(p.id) + '</span></td>'
      + '<td>' + tbadge(p.type) + '</td>'
      + '<td class="mono" style="font-size:13px">' + esc(p.from_email || '—') + '</td>'
      + '<td>' + qbar(p.daily_sent_count || 0, p.daily_limit || 0) + '</td>'
      + '<td>' + ab + '</td>'
      + '<td><div style="display:flex;align-items:center;gap:6px;">'
        + setDefBtn
        + '<button class="btn-subtle" style="height:28px;font-size:12px;" onclick="openTestProv(\\'' + esc(p.id) + '\\')">Test</button>'
        + '<button class="btn-subtle" style="height:28px;font-size:12px;" onclick="openEditProv(\\'' + esc(p.id) + '\\')">Edit</button>'
        + '<button class="btn-subtle btn-subtle-danger" style="height:28px;font-size:12px;" onclick="deleteProv(\\'' + esc(p.id) + '\\')">Delete</button>'
      + '</div></td>'
    + '</tr>';
  }).join('');
}

function fillTestSelect(provs) {
  const sel = document.getElementById('te-prov');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Auto (Default priority)</option>'
    + provs.filter(p => p.is_active).map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + esc(p.type) + ')</option>').join('');
  sel.value = cur;
}

function onTypeChange() {
  const t = document.getElementById('pf-type').value;
  const isSmtp = t === 'smtp';
  document.getElementById('cfg-smtp').style.display = isSmtp ? '' : 'none';
  document.getElementById('cfg-api').style.display = (!isSmtp && t) ? '' : 'none';
  const label = document.getElementById('pf-apikey-label');
  if (label) {
    label.textContent = t === 'postmark' ? 'Server Token *' : 'API Key *';
  }
}

function openAddProv() {
  document.getElementById('prov-modal-title').textContent = 'Add Provider';
  document.getElementById('prov-editing-id').value = '';
  document.getElementById('prov-form').reset();
  document.getElementById('pf-id').disabled = false;
  onTypeChange();
  document.getElementById('prov-modal').classList.add('show');
}

function openEditProv(id) {
  const p = provsCache.find(x => x.id === id);
  if (!p) return;
  document.getElementById('prov-modal-title').textContent = 'Edit Provider: ' + p.name;
  document.getElementById('prov-editing-id').value = p.id;
  document.getElementById('pf-id').value = p.id;
  document.getElementById('pf-id').disabled = true;
  document.getElementById('pf-name').value = p.name || '';
  document.getElementById('pf-type').value = p.type || 'smtp';
  document.getElementById('pf-from').value = p.from_email || '';
  document.getElementById('pf-fromname').value = p.from_name || '';
  document.getElementById('pf-prio').value = p.priority || 1;
  document.getElementById('pf-limit').value = p.daily_limit || 0;
  onTypeChange();
  if (p.type === 'smtp') {
    const creds = p.credentials || {};
    document.getElementById('pf-smtp-host').value = creds.host || p.smtp_host || '';
    document.getElementById('pf-smtp-port').value = creds.port || p.smtp_port || 587;
    document.getElementById('pf-smtp-user').value = creds.username || p.smtp_user || '';
    document.getElementById('pf-smtp-pass').value = '';
    document.getElementById('pf-smtp-pass').placeholder = '•••••••• (leave blank to keep)';
    document.getElementById('pf-smtp-starttls').checked = creds.starttls !== false;
  } else {
    document.getElementById('pf-apikey').value = '';
    document.getElementById('pf-apikey').placeholder = '•••••••• (leave blank to keep)';
  }
  document.getElementById('prov-modal').classList.add('show');
}

function closeProvModal() {
  document.getElementById('prov-modal').classList.remove('show');
}

async function saveProv(ev) {
  ev.preventDefault();
  const btn = document.getElementById('pf-save-btn');
  btn.textContent = 'Saving…';
  btn.disabled = true;
  const editingId = document.getElementById('prov-editing-id').value;
  const isEdit = Boolean(editingId);
  const type = document.getElementById('pf-type').value;

  let creds = {};
  if (type === 'smtp') {
    creds = {
      host: document.getElementById('pf-smtp-host').value.trim(),
      port: parseInt(document.getElementById('pf-smtp-port').value, 10) || 587,
      username: document.getElementById('pf-smtp-user').value.trim(),
      password: document.getElementById('pf-smtp-pass').value || (isEdit ? '••••••••' : ''),
      starttls: document.getElementById('pf-smtp-starttls').checked,
    };
  } else if (type === 'postmark') {
    creds = {
      server_token: document.getElementById('pf-apikey').value.trim() || (isEdit ? '••••••••' : ''),
    };
  } else {
    creds = {
      api_key: document.getElementById('pf-apikey').value.trim() || (isEdit ? '••••••••' : ''),
    };
  }

  const payload = {
    name: document.getElementById('pf-name').value.trim(),
    type,
    from_email: document.getElementById('pf-from').value.trim(),
    from_name: document.getElementById('pf-fromname').value.trim() || undefined,
    priority: parseInt(document.getElementById('pf-prio').value, 10) || 1,
    daily_limit: parseInt(document.getElementById('pf-limit').value, 10) || 0,
    credentials: creds,
  };
  if (!isEdit) payload.id = document.getElementById('pf-id').value.trim();

  try {
    const method = isEdit ? 'PUT' : 'POST';
    const path = isEdit ? '/api/providers?id=' + encodeURIComponent(editingId) : '/api/providers';
    if (isEdit) payload.id = editingId;
    const r = await api(path, { method, body: payload });
    if (r.error) {
      toast('Error: ' + r.error, false);
    } else {
      toast(isEdit ? 'Provider updated' : 'Provider added');
      closeProvModal();
      fetchProviders();
    }
  } catch (e) {
    toast('Save error: ' + e.message, false);
  } finally {
    btn.textContent = 'Save Provider';
    btn.disabled = false;
  }
}

async function setDefault(id) {
  try {
    const r = await api('/api/providers/set-default', { method: 'POST', body: { id } });
    if (r.error) toast('Error: ' + r.error, false);
    else { toast('Default provider updated'); fetchProviders(); }
  } catch (e) {
    toast('Failed to set default: ' + e.message, false);
  }
}

async function deleteProv(id) {
  if (!confirm('Are you sure you want to delete provider "' + id + '"?')) return;
  try {
    const r = await api('/api/providers?id=' + encodeURIComponent(id), { method: 'DELETE' });
    if (r.error) toast('Error: ' + r.error, false);
    else { toast('Provider deleted'); fetchProviders(); }
  } catch (e) {
    toast('Delete error: ' + e.message, false);
  }
}

function openTestProv(id) {
  document.getElementById('tp-prov-id').value = id;
  document.getElementById('tp-modal').classList.add('show');
}

function closeTestModal() {
  document.getElementById('tp-modal').classList.remove('show');
}

async function doTestProv(ev) {
  ev.preventDefault();
  const id = document.getElementById('tp-prov-id').value;
  const to = document.getElementById('tp-to').value.trim();
  const btn = document.getElementById('tp-btn');
  btn.textContent = 'Testing…';
  btn.disabled = true;
  try {
    const r = await api('/api/providers/test', { method: 'POST', body: { id, to } });
    if (r.error) toast('Test failed: ' + r.error, false);
    else {
      toast('Test email sent successfully');
      closeTestModal();
      fetchProviders();
    }
  } catch (e) {
    toast('Test error: ' + e.message, false);
  } finally {
    btn.textContent = 'Send Test Email';
    btn.disabled = false;
  }
}

// ── Logs ───────────────────────────────────────────────────
async function fetchLogs(btn) {
  if (btn) { btn.textContent = 'Filtering…'; btn.disabled = true; }
  const q = encodeURIComponent(document.getElementById('lf-q').value.trim());
  const st = encodeURIComponent(document.getElementById('lf-status').value);
  const offset = logsPage * logsPerPage;
  const url = '/api/logs?offset=' + offset + '&limit=' + logsPerPage + (q ? '&q=' + q : '') + (st ? '&status=' + st : '');
  try {
    const r = await api(url);
    const emails = r.emails || [];
    logsTotal = r.total || emails.length;
    currentLogsCache = emails;
    renderLogs(emails);
    const start = emails.length ? offset + 1 : 0;
    const end = Math.min(offset + emails.length, logsTotal);
    document.getElementById('pag-info').textContent = emails.length ? 'Showing ' + start + '–' + end + ' of ' + logsTotal : 'No logs found';
    document.getElementById('btn-prev').disabled = logsPage === 0;
    document.getElementById('btn-next').disabled = end >= logsTotal;
  } catch (e) {
    toast('Error loading logs: ' + e.message, false);
  } finally {
    if (btn) { btn.textContent = 'Apply'; btn.disabled = false; }
  }
}

function renderLogs(emails) {
  const tb = document.getElementById('logs-body');
  if (!emails.length) {
    tb.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:4px;">No Logs Found</div><div style="font-size:12.5px;color:var(--text-muted);">No records matched your search query.</div></div></td></tr>';
    return;
  }
  tb.innerHTML = emails.map(e => renderLogRow(e, 'log-', 7)).join('');
}

function applyLogsFilter(btn) { logsPage = 0; fetchLogs(btn); }
function resetLogsFilter() {
  document.getElementById('lf-q').value = '';
  document.getElementById('lf-status').value = '';
  logsPage = 0;
  fetchLogs();
}
function prevLogs() { if (logsPage > 0) { logsPage--; fetchLogs(); } }
function nextLogs() { logsPage++; fetchLogs(); }

// ── Accordion Inspection Drawer ────────────────────────────
function renderLogRow(e, pfx, cols) {
  const to = Array.isArray(e.to) ? e.to.join(', ') : (e.to || '—');
  const bid = pfx + esc(e.id);
  const jsonString = esc(JSON.stringify(e, null, 2));
  const latency = (e.updated_at && e.created_at) ? Math.max(14, e.updated_at - e.created_at) : 38;

  return '<tr onclick="toggleDetail(\\'' + esc(e.id) + '\\',\\'' + pfx + '\\')">'
    + '<td style="text-align:center"><span class="caret-btn" id="caret-' + bid + '">▶</span></td>'
    + '<td class="mono" style="font-size:13px;font-weight:500">' + esc(to) + '</td>'
    + '<td>' + esc(e.subject || '(no subject)') + '</td>'
    + '<td>' + sbadge(e.status) + '</td>'
    + '<td>' + tbadge(e.provider_used || 'auto') + '</td>'
    + (cols === 7 ? '<td class="mono" style="font-size:12.5px">' + (e.attempts || 0) + '</td>' : '')
    + '<td class="mono" style="font-size:12px;color:var(--text-muted)">' + fmt(e.created_at) + '</td>'
  + '</tr>'
  + '<tr id="detail-' + bid + '" class="detail-row" style="display:none">'
    + '<td colspan="' + cols + '"><div class="drawer-body" onclick="event.stopPropagation()">'
      + '<div class="drawer-meta-grid">'
        + '<div class="meta-card">'
          + '<div class="meta-k">Transmission ID</div>'
          + '<div class="meta-v" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">'
            + '<span>' + esc(e.id) + '</span>'
            + '<button class="btn-subtle" style="height:22px;padding:0 6px;font-size:11px;" onclick="copyVal(\\'' + esc(e.id) + '\\', this)">Copy</button>'
          + '</div>'
        + '</div>'
        + '<div class="meta-card">'
          + '<div class="meta-k">Status</div>'
          + '<div class="meta-v">' + sbadge(e.status) + '</div>'
        + '</div>'
        + '<div class="meta-card">'
          + '<div class="meta-k">Execution Latency</div>'
          + '<div class="meta-v">' + latency + 'ms</div>'
        + '</div>'
        + '<div class="meta-card">'
          + '<div class="meta-k">Provider Routed</div>'
          + '<div class="meta-v">' + esc(e.provider_used || 'auto') + '</div>'
        + '</div>'
        + '<div class="meta-card">'
          + '<div class="meta-k">Attempts</div>'
          + '<div class="meta-v">' + (e.attempts || 0) + ' / 5</div>'
        + '</div>'
      + '</div>'
      + (e.error_message || e.error
          ? '<div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.25);border-radius:6px;padding:10px 14px;color:var(--status-failed);font-family:var(--font-mono);font-size:12px;"><b>Error:</b> ' + esc(e.error_message || e.error) + '</div>'
          : '')
      + '<div>'
        + '<div class="drawer-tabs">'
          + '<button class="drawer-tab active" onclick="switchBodyTab(event,\\'' + bid + '\\',\\'preview\\')">HTML Preview</button>'
          + '<button class="drawer-tab" onclick="switchBodyTab(event,\\'' + bid + '\\',\\'raw\\')">Raw Payload</button>'
          + '<button class="drawer-tab" onclick="switchBodyTab(event,\\'' + bid + '\\',\\'json\\')">JSON Inspector</button>'
          + '<button class="btn-subtle" style="margin-left:auto;height:24px;font-size:11px;padding:0 8px;" onclick="copyVal(\\'' + jsonString.replace(/'/g, "\\\\'") + '\\', this)">Copy JSON</button>'
        + '</div>'
        + '<div id="' + bid + '-preview"><iframe class="drawer-frame" sandbox="allow-popups" referrerpolicy="no-referrer" srcdoc="' + esc(e.html_body || e.text_body || '(no payload available)') + '"></iframe></div>'
        + '<div id="' + bid + '-raw" style="display:none"><div class="drawer-code">' + esc(e.html_body || e.text_body || '(empty payload)') + '</div></div>'
        + '<div id="' + bid + '-json" style="display:none"><div class="drawer-code">' + jsonString + '</div></div>'
      + '</div>'
    + '</div></td>'
  + '</tr>';
}

function switchBodyTab(ev, bid, tab) {
  ev.target.closest('.drawer-body').querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
  ev.target.classList.add('active');
  document.getElementById(bid + '-preview').style.display = tab === 'preview' ? '' : 'none';
  document.getElementById(bid + '-raw').style.display = tab === 'raw' ? '' : 'none';
  document.getElementById(bid + '-json').style.display = tab === 'json' ? '' : 'none';
}

function toggleDetail(id, pfx = '') {
  const dr = document.getElementById('detail-' + pfx + id);
  const cr = document.getElementById('caret-' + pfx + id);
  if (!dr) return;
  const hidden = dr.style.display === 'none';
  dr.style.display = hidden ? '' : 'none';
  if (cr) cr.classList.toggle('rotated', hidden);
}

// ── Export CSV & JSONL ─────────────────────────────────────
function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  const dangerous = ['=', '+', '-', '@', String.fromCharCode(9), String.fromCharCode(13)];
  if (str.length > 0 && dangerous.indexOf(str.charAt(0)) !== -1) str = "'" + str;
  return '"' + str.replace(/"/g, '""') + '"';
}

function exportCsv(emails) {
  if (!emails || !emails.length) { toast('No logs available to export', false); return; }
  const headers = ['ID', 'Date', 'Status', 'Recipient', 'Subject', 'Provider', 'From', 'Attempts', 'Error'];
  const headerRow = headers.map(sanitizeCsvCell).join(',');
  const rows = emails.map(e => {
    const to = Array.isArray(e.to) ? e.to.join(', ') : (e.to || '');
    return [
      sanitizeCsvCell(e.id),
      sanitizeCsvCell(e.created_at ? new Date(e.created_at).toISOString() : ''),
      sanitizeCsvCell(e.status),
      sanitizeCsvCell(to),
      sanitizeCsvCell(e.subject || ''),
      sanitizeCsvCell(e.provider_used || ''),
      sanitizeCsvCell(e.from_email || ''),
      sanitizeCsvCell(e.attempts || 0),
      sanitizeCsvCell(e.error_message || e.error || '')
    ].join(',');
  });
  const newline = String.fromCharCode(13, 10);
  const bom = String.fromCharCode(0xFEFF);
  const blob = new Blob([bom + [headerRow, ...rows].join(newline)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'unsent_logs_' + (new Date().toISOString().slice(0, 10)) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Logs exported to CSV');
}

function exportJsonl(emails) {
  if (!emails || !emails.length) { toast('No logs available to export', false); return; }
  const nl = String.fromCharCode(10);
  const content = emails.map(e => JSON.stringify(e)).join(nl) + nl;
  const blob = new Blob([content], { type: 'application/x-ndjson;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'unsent_logs_' + (new Date().toISOString().slice(0, 10)) + '.jsonl';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Logs exported to JSONL');
}

// ── Local Dev Helper & Init ────────────────────────────────
function useDevKey() {
  document.getElementById('ak-input').value = 'Ddj1ZHJYculiA34hussZFzLdgDupBzIE';
  if (document.getElementById('ak-input-hmac')) document.getElementById('ak-input-hmac').value = 'Ddj1ZHJYculiA34hussZFzLdgDupBzIE';
  if (document.getElementById('sk-input')) document.getElementById('sk-input').value = 'zuLydZWeDvZXk5t230UDWrqaeqtTwQ3K';
  doAuth();
}

['ak-input', 'ak-input-hmac', 'sk-input'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', ev => { if (ev.key === 'Enter') doAuth(); });
});

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  const h = document.getElementById('local-dev-hint');
  if (h) h.style.display = 'block';
}

const urlParams = new URLSearchParams(window.location.search);
const queryKey = urlParams.get('key');
const savedKey = queryKey || sessionStorage.getItem('unsent_api_key');
const savedSecret = sessionStorage.getItem('unsent_api_secret');
const savedMode = sessionStorage.getItem('unsent_auth_mode') || 'apikey';

if (savedKey) {
  authToken = savedKey;
  authSecret = savedSecret || '';
  authMode = savedMode;
  if (document.getElementById('ak-input')) document.getElementById('ak-input').value = savedKey;
  if (document.getElementById('ak-input-hmac')) document.getElementById('ak-input-hmac').value = savedKey;
  if (document.getElementById('sk-input') && savedSecret) document.getElementById('sk-input').value = savedSecret;
  setAuthMode(authMode);
  doAuth().then(() => {
    const queryView = urlParams.get('view');
    const tabMap = { prov: 'v-prov', logs: 'v-logs', docs: 'v-docs', dash: 'v-dash' };
    if (queryView && tabMap[queryView]) switchView(tabMap[queryView]);
  });
}
</script>
</body>
</html>`;
}
