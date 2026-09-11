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
      min-height: 520px;
      height: 560px;
      background: #ffffff;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
      display: block;
      transition: height 0.2s ease;
      resize: vertical;
    }

    .drawer-frame.expanded {
      min-height: 850px;
    }

    .drawer-code {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 14px 16px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.55;
      color: var(--text-primary);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 540px;
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
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      background: var(--bg-surface);
    }

    .logs-toolbar-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .search-box-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
      width: 320px;
    }

    .search-box-icon {
      position: absolute;
      left: 12px;
      width: 14px;
      height: 14px;
      color: var(--text-muted);
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .toolbar-search-input {
      width: 100%;
      height: 36px;
      padding: 0 12px 0 34px;
      font-size: 13px;
      font-family: var(--font-sans);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: var(--bg-subtle);
      color: var(--text-primary);
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
    }

    .toolbar-search-input::placeholder {
      color: var(--text-muted);
      opacity: 0.8;
    }

    .toolbar-search-input:focus {
      border-color: var(--border-focus);
      background: var(--bg-surface);
      box-shadow: 0 0 0 1px var(--border-focus);
    }

    .custom-select-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    .toolbar-custom-select {
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      height: 36px;
      padding: 0 32px 0 12px;
      font-size: 13px;
      font-weight: 500;
      font-family: var(--font-sans);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      background: var(--bg-subtle);
      color: var(--text-primary);
      cursor: pointer;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
    }

    .toolbar-custom-select:hover {
      border-color: var(--border-hover);
    }

    .toolbar-custom-select:focus {
      border-color: var(--border-focus);
      background: var(--bg-surface);
      box-shadow: 0 0 0 1px var(--border-focus);
    }

    .select-chevron-icon {
      position: absolute;
      right: 10px;
      width: 14px;
      height: 14px;
      color: var(--text-muted);
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .code-panel-actions {
      display: flex;
      align-items: center;
      gap: 8px;
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
    .cnum { color: #f59e0b; }
    .cprop { color: #3b82f6; }

    /* ── DOCS ENHANCEMENTS & CREDENTIALS CARD ────────────────── */
    .docs-subnav {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 24px;
      padding-bottom: 12px;
      flex-wrap: wrap;
    }

    .docs-subtab {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .docs-subtab:hover {
      color: var(--text-primary);
      background: var(--bg-subtle);
    }

    .docs-subtab.active {
      color: var(--text-primary);
      background: var(--bg-subtle);
      border-color: var(--border-subtle);
      font-weight: 600;
    }

    .creds-card {
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: var(--bg-surface);
      padding: 22px 24px;
      margin-bottom: 28px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
    }

    .creds-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .creds-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .creds-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 18px;
    }

    .creds-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .creds-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .creds-input-row {
      display: flex;
      position: relative;
    }

    .creds-input {
      width: 100%;
      height: 38px;
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 0 88px 0 12px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-primary);
      outline: none;
    }

    .creds-input:focus {
      border-color: var(--border-focus);
    }

    .creds-actions {
      position: absolute;
      right: 4px;
      top: 4px;
      display: flex;
      gap: 4px;
    }

    .creds-btn {
      height: 30px;
      padding: 0 8px;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-primary);
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .creds-btn:hover {
      background: var(--bg-subtle);
      border-color: var(--border-focus);
    }

    .creds-env-wrap {
      background: var(--bg-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }

    .creds-env-code {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-primary);
      line-height: 1.5;
      white-space: pre;
      overflow-x: auto;
    }

    .creds-toggle-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: var(--text-primary);
      user-select: none;
      cursor: pointer;
    }

    .creds-unauth-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 20px;
      background: var(--bg-subtle);
      border: 1px dashed var(--border-subtle);
      border-radius: 8px;
      flex-wrap: wrap;
    }

    /* ── LANGUAGE PILLS ───────────────────────────────────────── */
    .lang-tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 14px;
      overflow-x: auto;
      padding-bottom: 4px;
    }

    .lang-tab {
      height: 32px;
      padding: 0 14px;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-surface);
      color: var(--text-muted);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }

    .lang-tab:hover {
      color: var(--text-primary);
      border-color: var(--text-muted);
    }

    .lang-tab.active {
      background: var(--btn-primary-bg);
      color: var(--btn-primary-fg);
      border-color: var(--btn-primary-bg);
      font-weight: 600;
    }

    /* ── EMAIL TEMPLATES UI ───────────────────────────────────── */
    .tpl-grid {
      display: flex;
      flex-direction: column;
      gap: 24px;
      margin-top: 16px;
    }

    .tpl-card {
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: var(--bg-surface);
      overflow: hidden;
    }

    .tpl-card-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .tpl-info {
      flex: 1;
      min-width: 240px;
    }

    .tpl-info h4 {
      margin: 0 0 4px;
      font-size: 14.5px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .tpl-info p {
      margin: 0;
      font-size: 12.5px;
      color: var(--text-muted);
    }

    .tpl-header-controls {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .tpl-view-switcher {
      display: inline-flex;
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
    }

    .tpl-view-btn {
      background: transparent;
      border: none;
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }

    .tpl-view-btn:hover {
      color: var(--text-primary);
    }

    .tpl-view-btn.active {
      background: var(--bg-subtle);
      color: var(--text-primary);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .tpl-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .tpl-body {
      min-height: 520px;
      position: relative;
    }

    .tpl-body.tpl-mode-preview {
      display: block;
    }
    .tpl-body.tpl-mode-preview .tpl-preview-pane {
      display: flex;
      width: 100%;
      border-right: none;
    }
    .tpl-body.tpl-mode-preview .tpl-code-pane {
      display: none;
    }

    .tpl-body.tpl-mode-code {
      display: block;
    }
    .tpl-body.tpl-mode-code .tpl-preview-pane {
      display: none;
    }
    .tpl-body.tpl-mode-code .tpl-code-pane {
      display: flex;
      width: 100%;
    }

    .tpl-body.tpl-mode-split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .tpl-body.tpl-mode-split .tpl-preview-pane {
      display: flex;
      border-right: 1px solid var(--border-subtle);
    }
    .tpl-body.tpl-mode-split .tpl-code-pane {
      display: flex;
    }

    @media (max-width: 960px) {
      .tpl-body.tpl-mode-split {
        grid-template-columns: 1fr;
      }
      .tpl-body.tpl-mode-split .tpl-preview-pane {
        border-right: none;
        border-bottom: 1px solid var(--border-subtle);
      }
    }

    .tpl-preview-pane {
      padding: 24px;
      background: var(--bg-subtle);
      min-width: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      min-height: 520px;
      overflow: hidden;
    }

    .tpl-preview-frame {
      width: 100%;
      max-width: 580px;
      height: 520px;
      min-height: 480px;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      background: #FFFFFF;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
      display: block;
      transition: height 0.2s ease;
      resize: vertical;
    }

    .tpl-code-pane {
      position: relative;
      background: var(--bg-surface);
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
      width: 100%;
    }

    .tpl-code-pane pre {
      flex: 1;
      margin: 0;
      padding: 18px 20px;
      max-height: 540px;
      overflow: auto;
      font-family: var(--font-mono);
      font-size: 12.5px;
      line-height: 1.55;
      color: var(--text-primary);
      background: transparent;
      border: none;
    }

    /* ── SCHEMA & REFERENCE TABLES ────────────────────────────── */
    .method-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
    }

    .method-post {
      background: rgba(5, 150, 105, 0.12);
      color: var(--status-delivered);
      border: 1px solid rgba(5, 150, 105, 0.25);
    }

    .method-get {
      background: rgba(59, 130, 246, 0.12);
      color: #3b82f6;
      border: 1px solid rgba(59, 130, 246, 0.25);
    }

    .param-pill-req {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 600;
      background: rgba(220, 38, 38, 0.1);
      color: var(--status-failed);
    }

    .param-pill-opt {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 500;
      background: var(--bg-subtle);
      color: var(--text-muted);
    }

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
      <span class="logo-tag">Admin Console</span>
    </div>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;">
      Sign in with your administrator credentials to access the queue console.
    </p>

    <div id="auth-login-form">
      <div class="form-control">
        <label>Username</label>
        <input type="text" id="login-username" placeholder="admin" autocomplete="username" />
      </div>
      <div class="form-control">
        <label>Password</label>
        <input type="password" id="login-password" placeholder="••••••••••••" autocomplete="current-password" />
      </div>
      <button class="btn-action-primary" id="btn-signin" style="margin-top:16px;" onclick="doAuth()">Sign In</button>
    </div>

    <p id="auth-err" style="color:var(--status-failed);margin-top:14px;font-size:12.5px;display:none"></p>

    <div id="local-dev-hint" style="display:none;margin-top:20px;padding:14px;background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:8px;font-size:12.5px;">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px;">Local Environment Detected</div>
      <div style="color:var(--text-muted);font-size:12px;margin-bottom:10px;">Running on localhost. Use admin credentials from <code>.dev.vars</code>:</div>
      <button type="button" class="btn-subtle" style="width:100%;justify-content:center;" onclick="useDevCredentials()">Sign In with Local Admin</button>
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
          <div class="logs-toolbar-group">
            <div class="search-box-wrapper">
              <span class="search-box-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </span>
              <input class="toolbar-search-input" type="text" id="lf-q" placeholder="Filter by recipient, subject, or ID…" onkeydown="if(event.key==='Enter') applyLogsFilter();" />
            </div>
            <div class="custom-select-wrapper">
              <select class="toolbar-custom-select" id="lf-status" onchange="applyLogsFilter()">
                <option value="">All Statuses</option>
                <option value="queued">Queued</option>
                <option value="sending">Sending</option>
                <option value="sent">Delivered</option>
                <option value="failed">Failed</option>
              </select>
              <span class="select-chevron-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </span>
            </div>
            <button class="btn-subtle" id="btn-lf-apply" onclick="applyLogsFilter(this)">Filter</button>
            <button class="btn-subtle" id="btn-lf-reset" onclick="resetLogsFilter()" style="display:none;">Clear</button>
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
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 class="card-title" style="font-size:18px;margin-bottom:6px;">Developer Hub &amp; Integration Docs</h2>
            <p style="font-size:13.5px;color:var(--text-muted);margin:0;">
              High-throughput edge-accelerated transactional email dispatch with multi-provider failover. Copy live credentials, production SDK snippets, and responsive HTML email templates.
            </p>
          </div>
        </div>

        <!-- ── ACTIVE CREDENTIALS & SECRETS COMMAND CENTER ──────── -->
        <div id="creds-container">
          <!-- Populated by renderCredentialsCard() -->
        </div>

        <!-- ── DOCS SUB-NAVIGATION ──────────────────────────────── -->
        <div class="docs-subnav">
          <button class="docs-subtab active" id="dtab-sdks" onclick="switchDocsSubTab('sdks')">
            <span>⚡</span> Quickstart &amp; Code Examples
          </button>
          <button class="docs-subtab" id="dtab-templates" onclick="switchDocsSubTab('templates')">
            <span>📧</span> HTML Email Templates
          </button>
          <button class="docs-subtab" id="dtab-reference" onclick="switchDocsSubTab('reference')">
            <span>📖</span> REST API Reference &amp; Schemas
          </button>
        </div>

        <!-- ── SECTION 1: QUICKSTART & SDKS ─────────────────────── -->
        <div id="docs-sec-sdks">
          <div class="lang-tabs">
            <button class="lang-tab active" id="ltab-curl" onclick="switchLangTab('curl')">cURL (Bash)</button>
            <button class="lang-tab" id="ltab-ts" onclick="switchLangTab('ts')">TypeScript / Node.js</button>
            <button class="lang-tab" id="ltab-python" onclick="switchLangTab('python')">Python</button>
            <button class="lang-tab" id="ltab-go" onclick="switchLangTab('go')">Go</button>
            <button class="lang-tab" id="ltab-nextjs" onclick="switchLangTab('nextjs')">Next.js</button>
          </div>

          <div id="lang-pane-content">
            <!-- Populated dynamically by renderDocCodeSnippets() -->
          </div>
        </div>

        <!-- ── SECTION 2: HTML EMAIL TEMPLATES ──────────────────── -->
        <div id="docs-sec-templates" style="display:none;">
          <div style="margin-bottom:18px;">
            <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;color:var(--text-primary);">Production-Ready Responsive Email Templates</h3>
            <p style="font-size:13px;color:var(--text-muted);margin:0;">Tested across Gmail, Apple Mail, Outlook, and mobile clients. Click <strong>Copy HTML</strong> to integrate into your application or <strong>Load in Dispatcher</strong> to test instantly.</p>
          </div>

          <div class="tpl-grid" id="tpl-grid-container">
            <!-- Populated dynamically by renderEmailTemplates() -->
          </div>
        </div>

        <!-- ── SECTION 3: REST API REFERENCE ────────────────────── -->
        <div id="docs-sec-reference" style="display:none;">
          <div id="docs-ref-container">
            <!-- Populated dynamically by renderApiReference() -->
          </div>
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
let serverApiKey = '', serverApiSecret = '', serverSecurityMode = 'full';
let serverBaseUrl = window.location.origin;
let injectKeysInDocs = true;
let activeDocsSubTab = 'sdks', activeLangTab = 'curl';
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
  const hdrs = { 'Content-Type': 'application/json' };
  const sessionToken = sessionStorage.getItem('unsent_session_token');
  if (sessionToken) {
    hdrs['Authorization'] = 'Bearer ' + sessionToken;
  }
  if (opts.provId) hdrs['X-Provider-Id'] = opts.provId;
  if (opts.senderEmail) hdrs['X-Sender-Email'] = opts.senderEmail;
  const res = await fetch(path, { method, headers: hdrs, body: bodyStr || undefined, credentials: 'omit' });
  if (res.status === 401) {
    sessionStorage.removeItem('unsent_session_token');
    sessionStorage.removeItem('unsent_admin_user');
    const overlay = document.getElementById('auth-overlay');
    if (overlay && overlay.style.display === 'none') {
      overlay.style.display = '';
      const errEl = document.getElementById('auth-err');
      if (errEl) {
        errEl.textContent = 'Session expired or password updated. Please log in with your current credentials.';
        errEl.style.display = '';
      }
    }
  }
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
  const panel = btn.closest('.code-panel');
  const code = panel ? panel.querySelector('pre code').innerText : '';
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied! ✓';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function copyFullSnippet(btn) {
  const panel = btn.closest('.code-panel');
  if (!panel) return;
  const snippetId = panel.getAttribute('data-snippet-id');
  let code = '';
  if (snippetId && typeof SNIPPET_GENERATORS !== 'undefined' && typeof SNIPPET_GENERATORS[snippetId] === 'function') {
    code = SNIPPET_GENERATORS[snippetId](true);
  } else {
    code = panel.querySelector('pre code').innerText;
  }
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied! ✓';
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
async function doAuth() {
  const errEl = document.getElementById('auth-err');
  errEl.style.display = 'none';
  const btn = document.getElementById('btn-signin');
  const origText = btn ? btn.textContent : '';

  const username = (document.getElementById('login-username').value || '').trim();
  const password = (document.getElementById('login-password').value || '').trim();

  if (!username) {
    errEl.textContent = 'Please enter your username';
    errEl.style.display = '';
    return;
  }
  if (!password) {
    errEl.textContent = 'Please enter your password';
    errEl.style.display = '';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying…';
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const r = await res.json();
    if (!res.ok || r.error) {
      errEl.textContent = r.error || 'Authentication rejected';
      errEl.style.display = '';
      return;
    }

    sessionStorage.setItem('unsent_session_token', r.token);
    sessionStorage.setItem('unsent_admin_user', r.username || username);
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('qr-base').textContent = window.location.origin;
    document.getElementById('qr-auth').textContent = 'Admin: ' + (r.username || username);

    fetchDash();
    fetchProviders();
    fetchKeys();
    fetchLogs();
  } catch (e) {
    errEl.textContent = 'Connection error: ' + e.message;
    errEl.style.display = '';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

function logout() {
  serverApiKey = '';
  serverApiSecret = '';
  sessionStorage.removeItem('unsent_session_token');
  sessionStorage.removeItem('unsent_admin_user');
  sessionStorage.removeItem('unsent_api_key');
  sessionStorage.removeItem('unsent_api_secret');
  renderCredentialsCard();
  renderDocCodeSnippets();
  document.getElementById('auth-overlay').style.display = '';
}

// ── Nav & View Routing ─────────────────────────────────────
const VIEW_SLUGS = {
  'v-dash': 'dashboard',
  'v-prov': 'providers',
  'v-logs': 'logs',
  'v-docs': 'docs'
};

const SLUG_TO_VIEW = {
  'dash': 'v-dash',
  'dashboard': 'v-dash',
  'prov': 'v-prov',
  'providers': 'v-prov',
  'logs': 'v-logs',
  'log': 'v-logs',
  'docs': 'v-docs',
  'doc': 'v-docs',
  'api': 'v-docs',
  'api-docs': 'v-docs',
  'sdks': 'v-docs',
  'templates': 'v-docs',
  'reference': 'v-docs'
};

function resolveCurrentRoute() {
  const urlParams = new URLSearchParams(window.location.search);
  const qv = urlParams.get('view');

  let rawHash = window.location.hash || '';
  if (rawHash.startsWith('#')) rawHash = rawHash.substring(1);
  if (rawHash.startsWith('/')) rawHash = rawHash.substring(1);
  rawHash = rawHash.toLowerCase();

  const parts = rawHash.split('/');
  const mainSlug = parts[0] || '';
  const subSlug = parts[1] || '';

  let targetView = null;
  let targetDocsSubTab = null;

  if (qv && SLUG_TO_VIEW[qv]) {
    targetView = SLUG_TO_VIEW[qv];
  } else if (mainSlug && SLUG_TO_VIEW[mainSlug]) {
    targetView = SLUG_TO_VIEW[mainSlug];
    if (['sdks', 'templates', 'reference'].indexOf(mainSlug) !== -1) {
      targetDocsSubTab = mainSlug;
    } else if (subSlug && ['sdks', 'templates', 'reference'].indexOf(subSlug) !== -1) {
      targetDocsSubTab = subSlug;
    }
  } else {
    try {
      const saved = localStorage.getItem('unsent_active_view');
      if (saved && document.getElementById(saved)) targetView = saved;
    } catch (e) {}
  }

  if (!targetView || !document.getElementById(targetView)) {
    targetView = 'v-dash';
  }

  if (!targetDocsSubTab) {
    try {
      const savedSub = localStorage.getItem('unsent_docs_subtab');
      if (savedSub && ['sdks', 'templates', 'reference'].indexOf(savedSub) !== -1) {
        targetDocsSubTab = savedSub;
      }
    } catch (e) {}
  }

  try {
    const savedLang = localStorage.getItem('unsent_active_lang');
    if (savedLang && ['curl', 'ts', 'nextjs', 'python', 'go', 'php', 'hmac'].indexOf(savedLang) !== -1) {
      activeLangTab = savedLang;
      document.querySelectorAll('.lang-tab').forEach(function(b) {
        b.classList.toggle('active', b.id === 'ltab-' + savedLang);
      });
    }
  } catch (e) {}

  return { viewId: targetView, docsSubTab: targetDocsSubTab || 'sdks' };
}

function switchView(id, updateHistory) {
  if (typeof updateHistory === 'undefined') updateHistory = true;
  if (!document.getElementById(id)) return;

  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  document.querySelectorAll('.nav-tab').forEach(function(t) { t.classList.remove('active'); });
  document.getElementById(id).classList.add('active');

  const m = { 'v-dash': 'tab-dash', 'v-prov': 'tab-prov', 'v-logs': 'tab-logs', 'v-docs': 'tab-docs' };
  if (m[id] && document.getElementById(m[id])) {
    document.getElementById(m[id]).classList.add('active');
  }

  try {
    localStorage.setItem('unsent_active_view', id);
  } catch (e) {}

  const slug = VIEW_SLUGS[id] || 'dashboard';
  let targetHash = '#' + slug;
  if (id === 'v-docs' && activeDocsSubTab && activeDocsSubTab !== 'sdks') {
    targetHash = '#' + slug + '/' + activeDocsSubTab;
  }

  if (updateHistory) {
    if (window.location.hash !== targetHash) {
      history.pushState({ viewId: id, docsSubTab: activeDocsSubTab }, '', targetHash);
    }
  } else {
    if (window.location.hash !== targetHash && window.location.search.indexOf('view=') === -1) {
      history.replaceState({ viewId: id, docsSubTab: activeDocsSubTab }, '', targetHash);
    }
  }

  const hasAuth = !!sessionStorage.getItem('unsent_session_token') || !!authToken;
  if (id === 'v-dash') {
    if (hasAuth) fetchDash();
  } else if (id === 'v-logs') {
    if (hasAuth) fetchLogs();
  } else if (id === 'v-prov') {
    if (hasAuth) fetchProviders();
  } else if (id === 'v-docs') {
    renderCredentialsCard();
    renderDocCodeSnippets();
    renderEmailTemplates();
    renderApiReference();
  }
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
  const rawQ = document.getElementById('lf-q').value.trim();
  const rawSt = document.getElementById('lf-status').value;
  const q = encodeURIComponent(rawQ);
  const st = encodeURIComponent(rawSt);

  const resetBtn = document.getElementById('btn-lf-reset');
  if (resetBtn) resetBtn.style.display = (rawQ || rawSt) ? '' : 'none';

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
    if (btn) { btn.textContent = 'Filter'; btn.disabled = false; }
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
  const resetBtn = document.getElementById('btn-lf-reset');
  if (resetBtn) resetBtn.style.display = 'none';
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
  const rawPayload = e.html_body || e.text_body || '(no payload available)';
  const sanitizedIframeHtml = rawPayload.replace(new RegExp('<' + 'script[\\s\\S]*?<\\/' + 'script>', 'gi'), '');

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
          + '<div style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
            + '<button class="btn-subtle" style="height:24px;font-size:11px;padding:0 8px;" onclick="toggleDrawerExpand(\\'' + bid + '\\', this)" title="Toggle expanded height">⤢ Expand</button>'
            + '<button class="btn-subtle" style="height:24px;font-size:11px;padding:0 8px;" onclick="openDrawerPreview(\\'' + bid + '\\')" title="Open HTML in new tab">↗ Pop-out</button>'
            + '<button class="btn-subtle" style="height:24px;font-size:11px;padding:0 8px;" onclick="copyDrawerHtml(\\'' + bid + '\\', this)">Copy HTML</button>'
            + '<button class="btn-subtle" style="height:24px;font-size:11px;padding:0 8px;" onclick="copyDrawerJson(\\'' + bid + '\\', this)">Copy JSON</button>'
          + '</div>'
        + '</div>'
        + '<div id="' + bid + '-preview" style="padding-top:4px;"><iframe id="iframe-' + bid + '" class="drawer-frame" sandbox="allow-popups allow-same-origin" referrerpolicy="no-referrer" onload="fitDrawerIframe(this)" srcdoc="' + esc(sanitizedIframeHtml) + '"></iframe></div>'
        + '<div id="' + bid + '-raw" style="display:none;padding-top:4px;"><div class="drawer-code">' + esc(e.html_body || e.text_body || '(empty payload)') + '</div></div>'
        + '<div id="' + bid + '-json" style="display:none;padding-top:4px;"><div class="drawer-code">' + jsonString + '</div></div>'
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

function fitDrawerIframe(ifr) {
  if (!ifr) return;
  if (ifr.classList.contains('expanded')) return;
  try {
    const doc = ifr.contentDocument || ifr.contentWindow?.document;
    if (doc && doc.body) {
      const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      if (h > 120 && h < 800) {
        ifr.style.height = Math.min(Math.max(h + 36, 520), 700) + 'px';
        return;
      }
    }
  } catch (err) {}
  ifr.style.height = '520px';
}

function toggleDrawerExpand(bid, btn) {
  const ifr = document.getElementById('iframe-' + bid);
  const rawEl = document.querySelector('#' + bid + '-raw .drawer-code');
  const jsonEl = document.querySelector('#' + bid + '-json .drawer-code');

  const isExpanded = btn ? btn.getAttribute('data-expanded') === 'true' : (ifr && ifr.classList.contains('expanded'));
  const nextExpanded = !isExpanded;

  if (btn) {
    btn.setAttribute('data-expanded', nextExpanded ? 'true' : 'false');
    btn.textContent = nextExpanded ? '⤡ Compact' : '⤢ Expand';
    btn.title = nextExpanded ? 'Collapse to standard height' : 'Toggle expanded height';
  }

  if (ifr) {
    if (nextExpanded) {
      ifr.classList.add('expanded');
      try {
        const doc = ifr.contentDocument || ifr.contentWindow?.document;
        const h = doc && doc.body ? Math.max(doc.body.scrollHeight, 900) : 900;
        ifr.style.height = Math.max(h + 48, 900) + 'px';
      } catch (e) {
        ifr.style.height = '900px';
      }
    } else {
      ifr.classList.remove('expanded');
      ifr.style.height = '520px';
    }
  }

  if (rawEl) rawEl.style.maxHeight = nextExpanded ? '900px' : '520px';
  if (jsonEl) jsonEl.style.maxHeight = nextExpanded ? '900px' : '520px';
}

function openDrawerPreview(bid) {
  const ifr = document.getElementById('iframe-' + bid);
  if (!ifr) return;
  const html = ifr.getAttribute('srcdoc') || '';
  const newWin = window.open('', '_blank');
  if (!newWin) return;
  try {
    newWin.opener = null;
    newWin.document.open();
    newWin.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Email Preview</title>'
      + '<meta http-equiv="Content-Security-Policy" content="default-src \\'none\\'; style-src \\'unsafe-inline\\'; img-src data: https: http:; font-src data: https:;">'
      + '<style>body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#fff;color:#111;}</style>'
      + '</head><body>'
      + html
      + '</body></html>'
    );
    newWin.document.close();
  } catch(e) {
    console.error('Failed to open preview window', e);
  }
}

function copyDrawerJson(bid, btn) {
  const container = document.getElementById(bid + '-json');
  if (!container) return;
  const codeEl = container.querySelector('.drawer-code');
  const text = codeEl ? codeEl.textContent : '';
  copyVal(text, btn);
}

function copyDrawerHtml(bid, btn) {
  const ifr = document.getElementById('iframe-' + bid);
  const html = ifr ? (ifr.getAttribute('srcdoc') || '') : '';
  copyCredValue(html, btn);
}

function toggleDetail(id, pfx = '') {
  const bid = pfx + id;
  const dr = document.getElementById('detail-' + bid);
  const cr = document.getElementById('caret-' + bid);
  if (!dr) return;
  const opening = dr.style.display === 'none';
  dr.style.display = opening ? '' : 'none';
  if (cr) cr.classList.toggle('rotated', opening);
  if (opening) {
    const ifr = document.getElementById('iframe-' + bid);
    if (ifr) setTimeout(() => fitDrawerIframe(ifr), 40);
  }
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

// ── Developer Hub & API Docs Logic ─────────────────────────
async function fetchKeys() {
  const sessionToken = sessionStorage.getItem('unsent_session_token');
  if (!sessionToken && !authToken) return;
  try {
    const res = await api('/api/keys');
    if (res && res.api_key) {
      serverApiKey = res.api_key;
      serverApiSecret = res.api_secret || '';
      serverSecurityMode = res.security_mode || 'full';
      serverBaseUrl = res.base_url || 'https://unsent.rishibhati.in';
    }
  } catch (e) {
    console.warn('Could not fetch server keys:', e);
  }
  renderCredentialsCard();
  renderDocCodeSnippets();
}

function renderCredentialsCard() {
  const el = document.getElementById('creds-container');
  if (!el) return;
  const sessionToken = sessionStorage.getItem('unsent_session_token');
  const key = serverApiKey || authToken || '';
  const sec = serverApiSecret || authSecret || '';
  const url = serverBaseUrl || 'https://unsent.rishibhati.in';

  if (!sessionToken && !key) {
    el.innerHTML = '<div class="creds-unauth-box">' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:24px;">🔒</span>' +
        '<div>' +
          '<div style="font-weight:600;font-size:14px;color:var(--text-primary);margin-bottom:2px;">Developer Credentials Protected</div>' +
          '<div style="font-size:12.5px;color:var(--text-muted);">Sign in with administrator credentials to inspect your environment secrets, reveal API keys, and auto-populate all code templates.</div>' +
        '</div>' +
      '</div>' +
      '<button class="btn-action-primary" style="height:36px;font-size:13px;padding:0 16px;white-space:nowrap;" id="btn-unauth-login">Sign In to Reveal Credentials</button>' +
    '</div><div style="margin-bottom:24px;"></div>';
    const bLog = document.getElementById('btn-unauth-login');
    if (bLog) bLog.onclick = function() { document.getElementById('auth-overlay').style.display = ''; };
    return;
  }

  el.innerHTML = '<div class="creds-card">' +
    '<div class="creds-header">' +
      '<div class="creds-title">' +
        '<span>Active Environment Credentials</span>' +
        '<span class="status-tag tag-dispatched" style="font-size:11px;padding:2px 8px;"><span class="tag-dot">●</span>Authenticated Session</span>' +
      '</div>' +
      '<span style="font-size:12px;color:var(--text-muted);">Security Mode: <strong style="color:var(--text-primary);font-family:var(--font-mono);">' + esc(serverSecurityMode) + '</strong></span>' +
    '</div>' +
    '<div class="creds-grid">' +
      '<div class="creds-item">' +
        '<span class="creds-label">Endpoint Base URL</span>' +
        '<div class="creds-input-row">' +
          '<input type="text" class="creds-input mono" readonly value="' + esc(url) + '" id="cred-url">' +
          '<div class="creds-actions">' +
            '<button class="creds-btn" id="btn-copy-url">Copy</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="creds-item">' +
        '<span class="creds-label">API Key (X-API-Key)</span>' +
        '<div class="creds-input-row">' +
          '<input type="password" class="creds-input mono" readonly value="' + esc(key) + '" id="cred-key">' +
          '<div class="creds-actions">' +
            '<button class="creds-btn" id="btn-toggle-key">Reveal</button>' +
            '<button class="creds-btn" id="btn-copy-key">Copy</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="creds-item">' +
        '<span class="creds-label">HMAC Secret (API_SECRET)</span>' +
        '<div class="creds-input-row">' +
          '<input type="password" class="creds-input mono" readonly value="' + esc(sec || 'Not configured in env') + '" id="cred-sec"' + (sec ? '' : ' disabled') + '>' +
          '<div class="creds-actions">' +
            (sec ? '<button class="creds-btn" id="btn-toggle-sec">Reveal</button><button class="creds-btn" id="btn-copy-sec">Copy</button>' : '<span style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;padding:0 6px;">Optional</span>') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--border-subtle);">' +
      '<label class="creds-toggle-row" style="margin:0;">' +
        '<input type="checkbox" id="chk-inject-keys" ' + (injectKeysInDocs ? 'checked' : '') + ' style="accent-color:var(--border-focus);cursor:pointer;width:15px;height:15px;">' +
        '<span>Auto-populate all code examples below with my active credentials</span>' +
      '</label>' +
    '</div>' +
  '</div>';

  const bUrl = document.getElementById('btn-copy-url');
  if (bUrl) bUrl.onclick = function() { copyCredValue(url, this); };
  const bKey = document.getElementById('btn-copy-key');
  if (bKey) bKey.onclick = function() { copyCredValue(key, this); };
  const bSec = document.getElementById('btn-copy-sec');
  if (bSec) bSec.onclick = function() { copyCredValue(sec, this); };
  const bTogKey = document.getElementById('btn-toggle-key');
  if (bTogKey) bTogKey.onclick = function() { toggleMask('cred-key', 'btn-toggle-key'); };
  const bTogSec = document.getElementById('btn-toggle-sec');
  if (bTogSec) bTogSec.onclick = function() { toggleMask('cred-sec', 'btn-toggle-sec'); };
  const chk = document.getElementById('chk-inject-keys');
  if (chk) chk.onchange = function() { toggleKeyInjection(this.checked); };
}

function toggleMask(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp || !btn) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = 'Hide';
  } else {
    inp.type = 'password';
    btn.textContent = 'Reveal';
  }
}

function copyCredValue(val, btn) {
  if (!val) return;
  navigator.clipboard.writeText(val).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied! ✓';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function toggleKeyInjection(checked) {
  injectKeysInDocs = checked;
  renderDocCodeSnippets();
}

function switchDocsSubTab(tab, updateHistory) {
  if (typeof updateHistory === 'undefined') updateHistory = true;
  activeDocsSubTab = tab;
  try {
    localStorage.setItem('unsent_docs_subtab', tab);
  } catch (e) {}

  ['sdks', 'templates', 'reference'].forEach(function(t) {
    const b = document.getElementById('dtab-' + t);
    const s = document.getElementById('docs-sec-' + t);
    if (b) b.classList.toggle('active', t === tab);
    if (s) s.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'sdks') renderDocCodeSnippets();
  if (tab === 'templates') renderEmailTemplates();
  if (tab === 'reference') renderApiReference();

  const docsEl = document.getElementById('v-docs');
  if (updateHistory && docsEl && docsEl.classList.contains('active')) {
    const targetHash = tab === 'sdks' ? '#docs' : '#docs/' + tab;
    if (window.location.hash !== targetHash) {
      history.pushState({ viewId: 'v-docs', docsSubTab: tab }, '', targetHash);
    }
  }
}

function switchLangTab(lang) {
  activeLangTab = lang;
  try {
    localStorage.setItem('unsent_active_lang', lang);
  } catch (e) {}
  document.querySelectorAll('.lang-tab').forEach(function(b) {
    b.classList.toggle('active', b.id === 'ltab-' + lang);
  });
  renderDocCodeSnippets();
}

// ── Code Snippets & Signing Generators ─────────────────────
let showKeysInSnippets = false;

function toggleSnippetKeys() {
  showKeysInSnippets = !showKeysInSnippets;
  renderDocCodeSnippets();
}

function getCreds(withRealKeys) {
  const hasCreds = injectKeysInDocs && (serverApiKey || authToken);
  const realKey = hasCreds ? (serverApiKey || authToken) : 'YOUR_API_KEY';
  const realSec = (hasCreds && (serverApiSecret || authSecret)) ? (serverApiSecret || authSecret) : 'YOUR_HMAC_SECRET';
  const maskedKey = '••••••••••••••••••••••••••••••••';
  const maskedSec = '••••••••••••••••••••••••••••••••';
  const defaultUrl = 'https://unsent.rishibhati.in';
  const url = (serverBaseUrl && !serverBaseUrl.includes('localhost') && !serverBaseUrl.includes('127.0.0.1'))
    ? serverBaseUrl
    : defaultUrl;

  return {
    url: url,
    key: withRealKeys ? realKey : maskedKey,
    sec: withRealKeys ? realSec : maskedSec,
    realKey: realKey,
    realSec: realSec
  };
}

const SNIPPET_GENERATORS = {
  'curl-signed': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const SQ = String.fromCharCode(39);
    const BS = String.fromCharCode(92);
    return [
      '#!/usr/bin/env bash',
      'set -e',
      '',
      '# ── 1. Configuration & Credentials ──────────────────────────',
      'UNSENT_URL="' + c.url + '/api/send"',
      'API_KEY="' + c.key + '"',
      'API_SECRET="' + c.sec + '"',
      '',
      '# ── 2. Request Body (Raw JSON) ──────────────────────────────',
      'BODY=' + SQ + '{',
      '  "to": "customer@example.com",',
      '  "subject": "Production Signed Dispatch",',
      '  "html": "<h2>Order Confirmed</h2><p>Your delivery has been queued at the edge.</p>",',
      '  "from_name": "Unsent System"',
      '}' + SQ,
      '',
      '# ── 3. Timestamp & Replay-Protection Nonce ──────────────────',
      'TIMESTAMP=$(date +%s)',
      'NONCE=$(openssl rand -hex 16)',
      '',
      '# ── 4. Cryptographic Body Hash (SHA-256 Hex) ────────────────',
      'BODY_HASH=$(printf "%s" "$BODY" | openssl dgst -sha256 | awk ' + SQ + '{print $NF}' + SQ + ')',
      '',
      '# ── 5. Canonical Message & HMAC-SHA256 Signature ────────────',
      '# Format: <timestamp>' + BS + 'n<nonce>' + BS + 'n<bodyHash>',
      'CANONICAL_MSG=$(printf "%s' + BS + 'n%s' + BS + 'n%s" "$TIMESTAMP" "$NONCE" "$BODY_HASH")',
      'SIGNATURE="sha256=$(printf "%s" "$CANONICAL_MSG" | openssl dgst -sha256 -hmac "$API_SECRET" | awk ' + SQ + '{print $NF}' + SQ + ')"',
      '',
      '# ── 6. Execute POST Request with All 5 Required Headers ─────',
      'curl -X POST "$UNSENT_URL" ' + BS,
      '  -H "Content-Type: application/json" ' + BS,
      '  -H "X-API-Key: $API_KEY" ' + BS,
      '  -H "X-Timestamp: $TIMESTAMP" ' + BS,
      '  -H "X-Nonce: $NONCE" ' + BS,
      '  -H "X-Signature: $SIGNATURE" ' + BS,
      '  -d "$BODY"'
    ].join(NL);
  },

  'curl-status': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const BS = String.fromCharCode(92);
    return [
      '# Check Queue Telemetry & Health Statistics',
      'curl -X GET "' + c.url + '/api/status" ' + BS,
      '  -H "X-API-Key: ' + c.key + '"'
    ].join(NL);
  },

  'ts-signed': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const BS = String.fromCharCode(92);
    return [
      'import crypto from "node:crypto";',
      '',
      '// ── 1. Configuration ─────────────────────────────────────────',
      'const UNSENT_URL = "' + c.url + '/api/send";',
      'const API_KEY = process.env.UNSENT_API_KEY || "' + c.key + '";',
      'const API_SECRET = process.env.UNSENT_API_SECRET || "' + c.sec + '";',
      '',
      '// ── 2. Payload Definition ────────────────────────────────────',
      'const payload = {',
      '  to: "customer@example.com",',
      '  subject: "Welcome to the Platform",',
      '  html: "<h1>Account Activated</h1><p>Your subscription is now live.</p>",',
      '  from_name: "Acme Operations"',
      '};',
      '',
      'const rawBody = JSON.stringify(payload);',
      'const timestamp = Math.floor(Date.now() / 1000).toString();',
      'const nonce = crypto.randomUUID();',
      '',
      '// ── 3. Cryptographic Body Hash & Canonical Signature ─────────',
      'const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");',
      'const canonical = [timestamp, nonce, bodyHash].join("' + BS + 'n");',
      'const signature = "sha256=" + crypto.createHmac("sha256", API_SECRET).update(canonical).digest("hex");',
      '',
      '// ── 4. Dispatch Request with All 5 Required Headers ──────────',
      'const res = await fetch(UNSENT_URL, {',
      '  method: "POST",',
      '  headers: {',
      '    "Content-Type": "application/json",',
      '    "X-API-Key": API_KEY,',
      '    "X-Timestamp": timestamp,',
      '    "X-Nonce": nonce,',
      '    "X-Signature": signature',
      '  },',
      '  body: rawBody',
      '});',
      '',
      'if (!res.ok) {',
      '  const error = await res.json().catch(() => ({}));',
      '  throw new Error("Unsent dispatch failed (" + res.status + "): " + (error.reason || error.error || res.statusText));',
      '}',
      '',
      'const data = await res.json();',
      'console.log("Email queued successfully with ID:", data.id);'
    ].join(NL);
  },

  'ts-helper': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const BS = String.fromCharCode(92);
    return [
      'import crypto from "node:crypto";',
      '',
      'export interface EmailOptions {',
      '  to: string | string[];',
      '  subject: string;',
      '  html: string;',
      '  text?: string;',
      '  from_name?: string;',
      '  from_email?: string;',
      '  reply_to?: string;',
      '  cc?: string | string[];',
      '  bcc?: string | string[];',
      '  provider_id?: string;',
      '  metadata?: Record<string, any>;',
      '}',
      '',
      'export async function sendEmail(opts: EmailOptions) {',
      '  const baseUrl = process.env.UNSENT_BASE_URL || "' + c.url + '";',
      '  const apiKey = process.env.UNSENT_API_KEY || "' + c.key + '";',
      '  const apiSecret = process.env.UNSENT_API_SECRET || "' + c.sec + '";',
      '',
      '  const rawBody = JSON.stringify(opts);',
      '  const timestamp = Math.floor(Date.now() / 1000).toString();',
      '  const nonce = crypto.randomUUID();',
      '  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");',
      '  const canonical = [timestamp, nonce, bodyHash].join("' + BS + 'n");',
      '  const signature = "sha256=" + crypto.createHmac("sha256", apiSecret).update(canonical).digest("hex");',
      '',
      '  const res = await fetch(baseUrl + "/api/send", {',
      '    method: "POST",',
      '    headers: {',
      '      "Content-Type": "application/json",',
      '      "X-API-Key": apiKey,',
      '      "X-Timestamp": timestamp,',
      '      "X-Nonce": nonce,',
      '      "X-Signature": signature',
      '    },',
      '    body: rawBody',
      '  });',
      '',
      '  if (!res.ok) {',
      '    const error = await res.json().catch(() => ({}));',
      '    throw new Error("Unsent dispatch failed: " + (error.reason || error.error || res.statusText));',
      '  }',
      '',
      '  return res.json();',
      '}'
    ].join(NL);
  },

  'python-signed': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const SQ = String.fromCharCode(39);
    const BS = String.fromCharCode(92);
    return [
      'import hashlib',
      'import hmac',
      'import json',
      'import time',
      'import uuid',
      'import requests',
      '',
      '# ── 1. Configuration ─────────────────────────────────────────',
      'UNSENT_URL = "' + c.url + '/api/send"',
      'API_KEY = "' + c.key + '"',
      'API_SECRET = "' + c.sec + '"',
      '',
      '# ── 2. Payload Definition ────────────────────────────────────',
      'payload = {',
      '    "to": "customer@example.com",',
      '    "subject": "Order #8492 Processed",',
      '    "html": "<p>Your transaction has cleared successfully.</p>",',
      '    "from_name": "Billing Service"',
      '}',
      '',
      '# Compact JSON (exact bytes used for body hash and transmission)',
      'raw_body = json.dumps(payload, separators=(",", ":"))',
      'timestamp = str(int(time.time()))',
      'nonce = str(uuid.uuid4())',
      '',
      '# ── 3. Cryptographic Body Hash & Canonical Signature ─────────',
      'body_hash = hashlib.sha256(raw_body.encode("utf-8")).hexdigest()',
      'canonical_message = "' + BS + 'n".join([timestamp, nonce, body_hash])',
      '',
      'signature = "sha256=" + hmac.new(',
      '    API_SECRET.encode("utf-8"),',
      '    canonical_message.encode("utf-8"),',
      '    hashlib.sha256',
      ').hexdigest()',
      '',
      '# ── 4. Dispatch Request with All 5 Required Headers ──────────',
      'headers = {',
      '    "Content-Type": "application/json",',
      '    "X-API-Key": API_KEY,',
      '    "X-Timestamp": timestamp,',
      '    "X-Nonce": nonce,',
      '    "X-Signature": signature',
      '}',
      '',
      'response = requests.post(UNSENT_URL, data=raw_body, headers=headers)',
      'response.raise_for_status()',
      'print("Dispatched successfully:", response.json())'
    ].join(NL);
  },

  'python-async': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const BS = String.fromCharCode(92);
    return [
      'import asyncio',
      'import hashlib',
      'import hmac',
      'import json',
      'import time',
      'import uuid',
      'import httpx',
      '',
      'async def send_email(to: str, subject: str, html: str):',
      '    unsent_url = "' + c.url + '/api/send"',
      '    api_key = "' + c.key + '"',
      '    api_secret = "' + c.sec + '"',
      '',
      '    raw_body = json.dumps({"to": to, "subject": subject, "html": html}, separators=(",", ":"))',
      '    timestamp = str(int(time.time()))',
      '    nonce = str(uuid.uuid4())',
      '',
      '    body_hash = hashlib.sha256(raw_body.encode("utf-8")).hexdigest()',
      '    canonical = "' + BS + 'n".join([timestamp, nonce, body_hash])',
      '    signature = "sha256=" + hmac.new(',
      '        api_secret.encode("utf-8"),',
      '        canonical.encode("utf-8"),',
      '        hashlib.sha256',
      '    ).hexdigest()',
      '',
      '    async with httpx.AsyncClient() as client:',
      '        resp = await client.post(',
      '            unsent_url,',
      '            content=raw_body,',
      '            headers={',
      '                "Content-Type": "application/json",',
      '                "X-API-Key": api_key,',
      '                "X-Timestamp": timestamp,',
      '                "X-Nonce": nonce,',
      '                "X-Signature": signature',
      '            }',
      '        )',
      '        resp.raise_for_status()',
      '        return resp.json()',
      '',
      'asyncio.run(send_email("user@example.com", "Async Alert", "<p>Delivered via HTTPX</p>"))'
    ].join(NL);
  },

  'go-signed': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const BT = String.fromCharCode(96);
    const BS = String.fromCharCode(92);
    return [
      'package main',
      '',
      'import (',
      '    "bytes"',
      '    "context"',
      '    "crypto/hmac"',
      '    "crypto/rand"',
      '    "crypto/sha256"',
      '    "encoding/hex"',
      '    "encoding/json"',
      '    "fmt"',
      '    "io"',
      '    "net/http"',
      '    "strconv"',
      '    "time"',
      ')',
      '',
      'const (',
      '    unsentURL = "' + c.url + '/api/send"',
      '    apiKey    = "' + c.key + '"',
      '    apiSecret = "' + c.sec + '"',
      ')',
      '',
      'type EmailPayload struct {',
      '    To       string ' + BT + 'json:"to"' + BT,
      '    Subject  string ' + BT + 'json:"subject"' + BT,
      '    HTML     string ' + BT + 'json:"html"' + BT,
      '    FromName string ' + BT + 'json:"from_name"' + BT,
      '}',
      '',
      'func main() {',
      '    payload := EmailPayload{',
      '        To:       "recipient@example.com",',
      '        Subject:  "Go Microservice Alert",',
      '        HTML:     "<h2>Incident Resolved</h2><p>Cluster metrics returned to nominal.</p>",',
      '        FromName: "Go Alert Manager",',
      '    }',
      '',
      '    rawBody, err := json.Marshal(payload)',
      '    if err != nil { panic(err) }',
      '',
      '    timestamp := strconv.FormatInt(time.Now().Unix(), 10)',
      '',
      '    // Generate 16-byte cryptographically secure nonce',
      '    nonceBytes := make([]byte, 16)',
      '    if _, err := rand.Read(nonceBytes); err != nil { panic(err) }',
      '    nonce := hex.EncodeToString(nonceBytes)',
      '    // 1. Compute SHA-256 body hash',
      '    h := sha256.Sum256(rawBody)',
      '    bodyHash := hex.EncodeToString(h[:])',
      '',
      '    // 2. Build canonical message: timestamp' + BS + 'nnonce' + BS + 'nbodyHash',
      '    canonical := fmt.Sprintf("%s' + BS + 'n%s' + BS + 'n%s", timestamp, nonce, bodyHash)',
      '',
      '    // 3. Compute HMAC-SHA256 signature',
      '    mac := hmac.New(sha256.New, []byte(apiSecret))',
      '    mac.Write([]byte(canonical))',
      '    signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))',
      '',
      '    // 4. Send request with all 5 required authentication headers',
      '    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)',
      '    defer cancel()',
      '',
      '    req, err := http.NewRequestWithContext(ctx, "POST", unsentURL, bytes.NewReader(rawBody))',
      '    if err != nil { panic(err) }',
      '',
      '    req.Header.Set("Content-Type", "application/json")',
      '    req.Header.Set("X-API-Key", apiKey)',
      '    req.Header.Set("X-Timestamp", timestamp)',
      '    req.Header.Set("X-Nonce", nonce)',
      '    req.Header.Set("X-Signature", signature)',
      '',
      '    resp, err := http.DefaultClient.Do(req)',
      '    if err != nil { panic(err) }',
      '    defer resp.Body.Close()',
      '',
      '    body, _ := io.ReadAll(resp.Body)',
      '    fmt.Printf("Status: %d, Response: %s' + BS + 'n", resp.StatusCode, body)',
      '}'
    ].join(NL);
  },

  'nextjs-route': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const BS = String.fromCharCode(92);
    return [
      '// app/api/contact/route.ts',
      'import { NextResponse } from "next/server";',
      'import crypto from "node:crypto";',
      '',
      'export async function POST(req: Request) {',
      '  try {',
      '    const { name, email, message } = await req.json();',
      '',
      '    const UNSENT_URL = process.env.UNSENT_BASE_URL || "' + c.url + '/api/send";',
      '    const API_KEY = process.env.UNSENT_API_KEY || "' + c.key + '";',
      '    const API_SECRET = process.env.UNSENT_API_SECRET || "' + c.sec + '";',
      '',
      '    const rawBody = JSON.stringify({',
      '      to: "support@yourdomain.com",',
      '      reply_to: email,',
      '      subject: "Inquiry from " + name,',
      '      html: "<p><strong>From:</strong> " + name + " (" + email + ")</p><p>" + message + "</p>",',
      '      from_name: name',
      '    });',
      '',
      '    const timestamp = Math.floor(Date.now() / 1000).toString();',
      '    const nonce = crypto.randomUUID();',
      '    const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");',
      '    const canonical = [timestamp, nonce, bodyHash].join("' + BS + 'n");',
      '    const signature = "sha256=" + crypto.createHmac("sha256", API_SECRET).update(canonical).digest("hex");',
      '',
      '    const res = await fetch(UNSENT_URL, {',
      '      method: "POST",',
      '      headers: {',
      '        "Content-Type": "application/json",',
      '        "X-API-Key": API_KEY,',
      '        "X-Timestamp": timestamp,',
      '        "X-Nonce": nonce,',
      '        "X-Signature": signature',
      '      },',
      '      body: rawBody',
      '    });',
      '',
      '    if (!res.ok) {',
      '      const err = await res.json().catch(() => ({}));',
      '      throw new Error(err.reason || err.error || "Delivery dispatch failed");',
      '    }',
      '',
      '    return NextResponse.json({ ok: true, data: await res.json() });',
      '  } catch (err: any) {',
      '    return NextResponse.json({ error: err.message }, { status: 500 });',
      '  }',
      '}'
    ].join(NL);
  },

  'nextjs-action': function(real) {
    const c = getCreds(real);
    const NL = String.fromCharCode(10);
    const SQ = String.fromCharCode(39);
    const BS = String.fromCharCode(92);
    return [
      '// actions/sendEmail.ts',
      SQ + 'use server' + SQ + ';',
      '',
      'import crypto from "node:crypto";',
      '',
      'export async function sendWelcomeEmail(to: string, userName: string) {',
      '  const UNSENT_URL = process.env.UNSENT_BASE_URL || "' + c.url + '/api/send";',
      '  const API_KEY = process.env.UNSENT_API_KEY || "' + c.key + '";',
      '  const API_SECRET = process.env.UNSENT_API_SECRET || "' + c.sec + '";',
      '',
      '  const rawBody = JSON.stringify({',
      '    to,',
      '    subject: "Welcome to the team, " + userName + "!",',
      '    html: "<p>Hi " + userName + ", we are thrilled to have you onboard.</p>"',
      '  });',
      '',
      '  const timestamp = Math.floor(Date.now() / 1000).toString();',
      '  const nonce = crypto.randomUUID();',
      '  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");',
      '  const canonical = [timestamp, nonce, bodyHash].join("' + BS + 'n");',
      '  const signature = "sha256=" + crypto.createHmac("sha256", API_SECRET).update(canonical).digest("hex");',
      '',
      '  const res = await fetch(UNSENT_URL, {',
      '    method: "POST",',
      '    headers: {',
      '      "Content-Type": "application/json",',
      '      "X-API-Key": API_KEY,',
      '      "X-Timestamp": timestamp,',
      '      "X-Nonce": nonce,',
      '      "X-Signature": signature',
      '    },',
      '    body: rawBody',
      '  });',
      '',
      '  if (!res.ok) {',
      '    const err = await res.json().catch(() => ({}));',
      '    throw new Error(err.reason || err.error || "Failed to dispatch email");',
      '  }',
      '',
      '  return res.json();',
      '}'
    ].join(NL);
  }
};

function makeCodePanel(snippetId, title, subtext) {
  const eyeIcon = showKeysInSnippets ? '🔒' : '👁';
  const eyeText = showKeysInSnippets ? 'Hide Keys' : 'Show Keys';
  const code = (typeof SNIPPET_GENERATORS[snippetId] === 'function')
    ? SNIPPET_GENERATORS[snippetId](showKeysInSnippets)
    : '';

  return (subtext ? ('<h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:24px 0 4px;">' + title + '</h3><p style="font-size:13px;color:var(--text-muted);margin-bottom:10px;">' + subtext + '</p>') : '') +
    '<div class="code-panel" data-snippet-id="' + snippetId + '">' +
      '<div class="code-panel-header">' +
        '<span>' + title + '</span>' +
        '<div class="code-panel-actions">' +
          '<button class="btn-subtle" style="height:26px;font-size:11px;padding:0 8px;display:flex;align-items:center;gap:4px;" onclick="toggleSnippetKeys()">' +
            '<span>' + eyeIcon + '</span>' +
            '<span>' + eyeText + '</span>' +
          '</button>' +
          '<button class="btn-subtle" style="height:26px;font-size:11px;padding:0 8px;font-weight:500;" onclick="copyFullSnippet(this)">' +
            'Copy Full Request' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<pre><code>' + esc(code) + '</code></pre>' +
    '</div>';
}

function renderDocCodeSnippets() {
  const container = document.getElementById('lang-pane-content');
  if (!container) return;

  const headerNotice = '<div style="background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:8px;padding:16px 18px;margin-bottom:20px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px;">' +
      '<div style="font-weight:600;font-size:13px;color:var(--text-primary);display:flex;align-items:center;gap:6px;">' +
        '<span>🔒</span> <span>Required Request Headers (Security Mode: Signed &amp; Full)</span>' +
      '</div>' +
      '<span class="circuit-pill" style="color:var(--status-delivered);background:rgba(16,185,129,0.08);border-color:rgba(16,185,129,0.2);font-size:11px;">Replay-Protected &amp; Signed</span>' +
    '</div>' +
    '<p style="font-size:12.5px;line-height:1.5;color:var(--text-muted);margin:0 0 10px;">' +
      'Every POST to <code class="mono" style="color:var(--text-primary);">/api/send</code> requires all 5 headers below. Canonical signature formula: <code class="mono">sha256=HMAC(API_SECRET, timestamp + "\\n" + nonce + "\\n" + sha256(raw_json_body))</code>.' +
    '</p>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:8px;font-size:12px;">' +
      '<div style="background:var(--bg-surface);padding:8px 10px;border-radius:6px;border:1px solid var(--border-subtle);">' +
        '<div style="font-family:var(--font-mono);font-weight:600;color:var(--text-primary);">X-API-Key</div>' +
        '<div style="color:var(--text-muted);font-size:11px;">Server API Key</div>' +
      '</div>' +
      '<div style="background:var(--bg-surface);padding:8px 10px;border-radius:6px;border:1px solid var(--border-subtle);">' +
        '<div style="font-family:var(--font-mono);font-weight:600;color:var(--text-primary);">X-Timestamp</div>' +
        '<div style="color:var(--text-muted);font-size:11px;">Unix seconds (±180s)</div>' +
      '</div>' +
      '<div style="background:var(--bg-surface);padding:8px 10px;border-radius:6px;border:1px solid var(--border-subtle);">' +
        '<div style="font-family:var(--font-mono);font-weight:600;color:var(--text-primary);">X-Nonce</div>' +
        '<div style="color:var(--text-muted);font-size:11px;">Unique request UUID</div>' +
      '</div>' +
      '<div style="background:var(--bg-surface);padding:8px 10px;border-radius:6px;border:1px solid var(--border-subtle);">' +
        '<div style="font-family:var(--font-mono);font-weight:600;color:var(--text-primary);">X-Signature</div>' +
        '<div style="color:var(--text-muted);font-size:11px;">HMAC-SHA256 digest</div>' +
      '</div>' +
    '</div>' +
  '</div>';

  let html = headerNotice;

  if (activeLangTab === 'curl') {
    html += makeCodePanel('curl-signed', 'cURL (Bash) — Complete Signed Request Script', 'Runnable Bash script computing timestamp, random nonce, SHA-256 body hash, HMAC signature, and executing curl with all 5 headers.');
    html += makeCodePanel('curl-status', 'cURL — Queue Status &amp; Telemetry Probe', 'Query live queue metrics and delivery counts.');
  } else if (activeLangTab === 'ts') {
    html += makeCodePanel('ts-signed', 'TypeScript / Node.js — Native Signed Fetch', 'Direct execution using Node 18+ native fetch and standard node:crypto library.');
    html += makeCodePanel('ts-helper', 'TypeScript — Reusable Signed Client Helper (sendEmail.ts)', 'Drop-in helper function that automatically signs and dispatches emails.');
  } else if (activeLangTab === 'python') {
    html += makeCodePanel('python-signed', 'Python 3 — Synchronous Requests with HMAC-SHA256', 'Production script using requests, hashlib, and hmac.');
    html += makeCodePanel('python-async', 'Python — Asynchronous Dispatch (HTTPX / FastAPI)', 'Non-blocking async dispatch for high-throughput ASGI workers.');
  } else if (activeLangTab === 'go') {
    html += makeCodePanel('go-signed', 'Go — Standard Library (net/http &amp; crypto/hmac)', 'Idiomatic, zero-dependency Go implementation with context timeout and all 5 authentication headers.');
  } else if (activeLangTab === 'nextjs') {
    html += makeCodePanel('nextjs-route', 'Next.js App Router — Route Handler (app/api/contact/route.ts)', 'Secure server-side route handler for contact and inquiry forms.');
    html += makeCodePanel('nextjs-action', 'Next.js — Server Action (actions/sendEmail.ts)', 'Server Action for React Server Components and client form bindings.');
  }

  container.innerHTML = html;
}


// ── HTML Email Templates ───────────────────────────────────
const EMAIL_TEMPLATES = [
  {
    id: 'welcome',
    title: 'Minimalist Welcome & Onboarding',
    desc: 'Clean onboarding email with modern brand badge, value highlights, and primary CTA button.',
    subject: 'Welcome to the platform — Your account is ready',
    html: [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>Welcome</title>',
      '</head>',
      '<body style="margin:0;padding:0;background-color:#F4F4F6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0F172A;">',
      '  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F4F4F6;padding:40px 16px;">',
      '    <tr>',
      '      <td align="center">',
      '        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E1E2E7;overflow:hidden;">',
      '          <tr>',
      '            <td style="padding:32px 36px 20px;border-bottom:1px solid #F1F3F5;">',
      '              <span style="font-family:monospace;font-weight:700;font-size:16px;letter-spacing:-0.02em;color:#0F172A;">UN<span style="color:#64748B;">●</span>SENT</span>',
      '            </td>',
      '          </tr>',
      '          <tr>',
      '            <td style="padding:32px 36px;">',
      '              <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#0F172A;">Welcome aboard</h1>',
      '              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">Your account is ready. Unsent gives you high-throughput, edge-accelerated transactional email dispatch with automatic multi-provider failover.</p>',
      '              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:28px 0;">',
      '                <tr>',
      '                  <td align="center" style="border-radius:6px;background-color:#0F172A;">',
      '                    <a href="https://example.com" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">Open Developer Console</a>',
      '                  </td>',
      '                </tr>',
      '              </table>',
      '              <p style="margin:0;font-size:13px;line-height:1.5;color:#94A3B8;">If you did not request this account, you can safely disregard this message.</p>',
      '            </td>',
      '          </tr>',
      '          <tr>',
      '            <td style="padding:18px 36px;background-color:#F8F9FA;border-top:1px solid #E1E2E7;text-align:center;">',
      '              <p style="margin:0;font-size:12px;color:#94A3B8;">© 2026 Unsent Infrastructure. All rights reserved.</p>',
      '            </td>',
      '          </tr>',
      '        </table>',
      '      </td>',
      '    </tr>',
      '  </table>',
      '</body>',
      '</html>'
    ].join(String.fromCharCode(10))
  },
  {
    id: 'otp',
    title: 'One-Time Passcode (OTP) Verification',
    desc: 'High-security 6-digit authentication token with prominent spacing and 10-minute expiry notice.',
    subject: 'Your authentication passcode: 492018',
    html: [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>Security Code</title>',
      '</head>',
      '<body style="margin:0;padding:0;background-color:#F4F4F6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0F172A;">',
      '  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F4F4F6;padding:40px 16px;">',
      '    <tr>',
      '      <td align="center">',
      '        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:500px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E1E2E7;overflow:hidden;">',
      '          <tr>',
      '            <td style="padding:32px 36px;text-align:center;">',
      '              <div style="font-family:monospace;font-weight:700;font-size:15px;color:#0F172A;margin-bottom:18px;">UN<span style="color:#64748B;">●</span>SENT</div>',
      '              <h2 style="margin:0 0 10px;font-size:20px;font-weight:600;color:#0F172A;">Verification Code</h2>',
      '              <p style="margin:0 0 24px;font-size:14px;color:#64748B;line-height:1.5;">Enter the security code below to complete sign in. This code expires in 10 minutes.</p>',
      '              <div style="background-color:#F8FAFC;border:1px dashed #CBD5E1;border-radius:8px;padding:16px 24px;margin:0 auto 24px;display:inline-block;">',
      '                <span style="font-family:monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#0F172A;">492018</span>',
      '              </div>',
      '              <p style="margin:0;font-size:12.5px;color:#94A3B8;line-height:1.5;">Never share this passcode with anyone. Support representatives will never ask for your verification code.</p>',
      '            </td>',
      '          </tr>',
      '        </table>',
      '      </td>',
      '    </tr>',
      '  </table>',
      '</body>',
      '</html>'
    ].join(String.fromCharCode(10))
  },
  {
    id: 'reset',
    title: 'Password Reset & Security Alert',
    desc: 'Critical action notice with high-contrast alert styling, timestamp context, and safety advice.',
    subject: 'Password reset request for your account',
    html: [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>Password Reset</title>',
      '</head>',
      '<body style="margin:0;padding:0;background-color:#F4F4F6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0F172A;">',
      '  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F4F4F6;padding:40px 16px;">',
      '    <tr>',
      '      <td align="center">',
      '        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:540px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E1E2E7;overflow:hidden;">',
      '          <tr>',
      '            <td style="padding:28px 32px 0;">',
      '              <span style="font-family:monospace;font-weight:700;font-size:15px;color:#0F172A;">UN<span style="color:#64748B;">●</span>SENT</span>',
      '            </td>',
      '          </tr>',
      '          <tr>',
      '            <td style="padding:24px 32px 32px;">',
      '              <h2 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#0F172A;">Password Reset Request</h2>',
      '              <p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:#475569;">A request was received to reset your password. Click below to establish a new password.</p>',
      '              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:24px 0;">',
      '                <tr>',
      '                  <td align="center" style="border-radius:6px;background-color:#DC2626;">',
      '                    <a href="https://example.com/reset" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">Reset Password</a>',
      '                  </td>',
      '                </tr>',
      '              </table>',
      '              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F8F9FA;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:12.5px;color:#64748B;">',
      '                <tr><td style="padding:3px 0;"><strong>Timestamp:</strong> Sep 9, 2026 — 10:14 UTC</td></tr>',
      '                <tr><td style="padding:3px 0;"><strong>Location:</strong> Singapore (Edge Node)</td></tr>',
      '              </table>',
      '              <p style="margin:0;font-size:12.5px;line-height:1.5;color:#94A3B8;">If you did not initiate this change, your credentials may be compromised. Please sign in and update your security settings immediately.</p>',
      '            </td>',
      '          </tr>',
      '        </table>',
      '      </td>',
      '    </tr>',
      '  </table>',
      '</body>',
      '</html>'
    ].join(String.fromCharCode(10))
  },
  {
    id: 'receipt',
    title: 'Order Confirmation & Payment Receipt',
    desc: 'Itemized transaction receipt with line items, tax breakdown, and clear reference numbering.',
    subject: 'Receipt for Order #ORD-9041',
    html: [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>Payment Receipt</title>',
      '</head>',
      '<body style="margin:0;padding:0;background-color:#F4F4F6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#0F172A;">',
      '  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#F4F4F6;padding:40px 16px;">',
      '    <tr>',
      '      <td align="center">',
      '        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#FFFFFF;border-radius:12px;border:1px solid #E1E2E7;overflow:hidden;">',
      '          <tr>',
      '            <td style="padding:28px 32px;border-bottom:1px solid #E1E2E7;display:flex;justify-content:space-between;align-items:center;">',
      '              <span style="font-family:monospace;font-weight:700;font-size:15px;color:#0F172A;">UN<span style="color:#64748B;">●</span>SENT</span>',
      '              <span style="font-family:monospace;font-size:12px;color:#64748B;">#REC-2026-9041</span>',
      '            </td>',
      '          </tr>',
      '          <tr>',
      '            <td style="padding:28px 32px;">',
      '              <h2 style="margin:0 0 6px;font-size:20px;font-weight:600;color:#0F172A;">Payment Confirmed</h2>',
      '              <p style="margin:0 0 24px;font-size:14px;color:#64748B;">Thank you for your business. Here is your transaction summary.</p>',
      '              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="8" style="font-size:13.5px;border-collapse:collapse;margin-bottom:20px;">',
      '                <tr style="border-bottom:1px solid #E1E2E7;color:#64748B;font-size:12px;text-transform:uppercase;">',
      '                  <th align="left" style="padding:8px 0;">Description</th>',
      '                  <th align="center" style="padding:8px 0;">Qty</th>',
      '                  <th align="right" style="padding:8px 0;">Amount</th>',
      '                </tr>',
      '                <tr style="border-bottom:1px solid #F1F3F5;">',
      '                  <td style="padding:12px 0;">Developer Pro (Monthly)</td>',
      '                  <td align="center" style="padding:12px 0;">1</td>',
      '                  <td align="right" style="padding:12px 0;">$29.00</td>',
      '                </tr>',
      '                <tr style="border-bottom:1px solid #F1F3F5;">',
      '                  <td style="padding:12px 0;">Dedicated IP Relay</td>',
      '                  <td align="center" style="padding:12px 0;">1</td>',
      '                  <td align="right" style="padding:12px 0;">$15.00</td>',
      '                </tr>',
      '                <tr>',
      '                  <td colspan="2" style="padding:14px 0 4px;font-weight:600;color:#0F172A;">Total Paid</td>',
      '                  <td align="right" style="padding:14px 0 4px;font-weight:700;font-size:16px;color:#059669;">$44.00</td>',
      '                </tr>',
      '              </table>',
      '              <p style="margin:0;font-size:12.5px;color:#94A3B8;">Charged to card ending in •••• 4242 · Sep 9, 2026</p>',
      '            </td>',
      '          </tr>',
      '        </table>',
      '      </td>',
      '    </tr>',
      '  </table>',
      '</body>',
      '</html>'
    ].join(String.fromCharCode(10))
  }
];

function renderEmailTemplates() {
  const container = document.getElementById('tpl-grid-container');
  if (!container) return;

  container.innerHTML = EMAIL_TEMPLATES.map(t => {
    return '<div class="tpl-card" id="tpl-card-' + t.id + '">' +
      '<div class="tpl-card-header">' +
        '<div class="tpl-info">' +
          '<h4>' + esc(t.title) + '</h4>' +
          '<p>' + esc(t.desc) + '</p>' +
        '</div>' +
        '<div class="tpl-header-controls">' +
          '<div class="tpl-view-switcher" role="tablist">' +
            '<button class="tpl-view-btn active" data-view="preview" onclick="switchTplView(\\'' + t.id + '\\', \\'preview\\')">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' +
              'Preview' +
            '</button>' +
            '<button class="tpl-view-btn" data-view="code" onclick="switchTplView(\\'' + t.id + '\\', \\'code\\')">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> ' +
              'HTML Code' +
            '</button>' +
            '<button class="tpl-view-btn" data-view="split" onclick="switchTplView(\\'' + t.id + '\\', \\'split\\')">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg> ' +
              'Split' +
            '</button>' +
          '</div>' +
          '<div class="tpl-actions">' +
            '<button class="btn-subtle" onclick="openTemplatePreview(\\'' + t.id + '\\')" style="height:30px;font-size:12px;padding:0 10px;" title="Open in new tab">↗ Full</button>' +
            '<button class="btn-subtle btn-copy-tpl" data-tpl-id="' + t.id + '" style="height:30px;font-size:12px;padding:0 12px;">Copy HTML</button>' +
            '<button class="btn-action-primary btn-load-tpl" data-tpl-id="' + t.id + '" style="height:30px;font-size:12px;padding:0 12px;">Load in Dispatcher ↗</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tpl-body tpl-mode-preview" id="tpl-body-' + t.id + '">' +
        '<div class="tpl-preview-pane">' +
          '<iframe class="tpl-preview-frame" id="iframe-' + t.id + '" sandbox="allow-same-origin" title="' + esc(t.title) + '" onload="fitTemplateIframe(this)"></iframe>' +
        '</div>' +
        '<div class="tpl-code-pane">' +
          '<pre><code>' + esc(t.html) + '</code></pre>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  container.querySelectorAll('.btn-copy-tpl').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-tpl-id');
      copyTemplateHtml(id, btn);
    });
  });

  container.querySelectorAll('.btn-load-tpl').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-tpl-id');
      loadTemplateInDispatcher(id);
    });
  });

  // Hydrate iframes safely
  setTimeout(() => {
    EMAIL_TEMPLATES.forEach(t => {
      const ifr = document.getElementById('iframe-' + t.id);
      if (ifr) {
        ifr.srcdoc = t.html;
        ifr.onload = function() { fitTemplateIframe(ifr); };
      }
    });
  }, 40);
}

function switchTplView(tplId, mode) {
  const card = document.getElementById('tpl-card-' + tplId);
  const body = document.getElementById('tpl-body-' + tplId);
  if (!card || !body) return;
  card.querySelectorAll('.tpl-view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === mode);
  });
  body.classList.remove('tpl-mode-preview', 'tpl-mode-code', 'tpl-mode-split');
  body.classList.add('tpl-mode-' + mode);

  if (mode === 'preview' || mode === 'split') {
    const ifr = document.getElementById('iframe-' + tplId);
    if (ifr) fitTemplateIframe(ifr);
  }
}

function fitTemplateIframe(ifr) {
  if (!ifr) return;
  try {
    const doc = ifr.contentDocument || ifr.contentWindow?.document;
    if (doc && doc.body) {
      const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      if (h > 100) {
        ifr.style.height = Math.min(Math.max(h + 40, 520), 1000) + 'px';
        return;
      }
    }
  } catch (err) {}
  ifr.style.height = '520px';
}

function openTemplatePreview(tplId) {
  const t = EMAIL_TEMPLATES.find(x => x.id === tplId);
  if (!t) return;
  const blob = new Blob([t.html], { type: 'text/html;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
}

function copyTemplateHtml(tplId, btn) {
  const t = EMAIL_TEMPLATES.find(x => x.id === tplId);
  if (!t) return;
  copyCredValue(t.html, btn);
}

function loadTemplateInDispatcher(tplId) {
  const t = EMAIL_TEMPLATES.find(x => x.id === tplId);
  if (!t) return;
  const s = document.getElementById('te-subj');
  const b = document.getElementById('te-body');
  if (s) s.value = t.subject;
  if (b) b.value = t.html;
  switchView('v-dash');
  toast('Loaded "' + t.title + '" into Quick Dispatch!', true);
}

// ── REST API Reference & Schemas ───────────────────────────
function renderApiReference() {
  const container = document.getElementById('docs-ref-container');
  if (!container) return;

  container.innerHTML = '<div>' +
    '<div style="margin-bottom:32px;">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
        '<span class="method-badge method-post">POST</span>' +
        '<span style="font-family:var(--font-mono);font-size:16px;font-weight:600;color:var(--text-primary);">/api/send</span>' +
      '</div>' +
      '<p style="font-size:13.5px;color:var(--text-muted);margin-bottom:16px;">Queue a transactional email for delivery across configured providers with automatic failover.</p>' +

      '<h4 style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin:16px 0 8px;">Request Headers</h4>' +
      '<div class="table-container" style="margin-bottom:20px;border:1px solid var(--border-subtle);border-radius:6px;">' +
        '<table>' +
          '<thead><tr><th>Header</th><th>Requirement</th><th>Description</th></tr></thead>' +
          '<tbody>' +
            '<tr><td class="mono">X-API-Key</td><td><span class="param-pill-req">Required</span></td><td>Authentication key configured in server environment.</td></tr>' +
            '<tr><td class="mono">Content-Type</td><td><span class="param-pill-req">Required</span></td><td>Must be <code>application/json</code>.</td></tr>' +
            '<tr><td class="mono">X-Timestamp</td><td><span class="param-pill-opt">HMAC Only</span></td><td>Unix epoch seconds. Must be within ±3 minutes of server UTC.</td></tr>' +
            '<tr><td class="mono">X-Nonce</td><td><span class="param-pill-opt">Full Mode</span></td><td>Unique nonce (8-128 chars). Enforces atomic replay protection via D1.</td></tr>' +
            '<tr><td class="mono">X-Signature</td><td><span class="param-pill-opt">HMAC Only</span></td><td>HMAC-SHA256 signature formatted as <code>sha256=&lt;hex&gt;</code>.</td></tr>' +
            '<tr><td class="mono">X-Provider-Id</td><td><span class="param-pill-opt">Optional</span></td><td>Direct routing override to target a specific provider circuit.</td></tr>' +
            '<tr><td class="mono">X-Sender-Email</td><td><span class="param-pill-opt">Optional</span></td><td>Direct routing to match an active provider registered with this email.</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +

      '<h4 style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin:16px 0 8px;">JSON Payload Parameters</h4>' +
      '<div class="table-container" style="margin-bottom:20px;border:1px solid var(--border-subtle);border-radius:6px;">' +
        '<table>' +
          '<thead><tr><th>Field</th><th>Type</th><th>Requirement</th><th>Description</th></tr></thead>' +
          '<tbody>' +
            '<tr><td class="mono">to</td><td class="mono">string | string[]</td><td><span class="param-pill-req">Required</span></td><td>Recipient email address or array of recipient addresses.</td></tr>' +
            '<tr><td class="mono">subject</td><td class="mono">string</td><td><span class="param-pill-req">Required</span></td><td>Subject line (maximum 500 characters, CRLF-sanitized).</td></tr>' +
            '<tr><td class="mono">body | html</td><td class="mono">string</td><td><span class="param-pill-req">Required</span></td><td>Email body content. HTML strings are automatically rendered as HTML.</td></tr>' +
            '<tr><td class="mono">text</td><td class="mono">string</td><td><span class="param-pill-opt">Optional</span></td><td>Plain-text fallback representation for non-HTML email clients.</td></tr>' +
            '<tr><td class="mono">from_name</td><td class="mono">string</td><td><span class="param-pill-opt">Optional</span></td><td>Sender display name (e.g. "Acme Security"). Overrides provider default.</td></tr>' +
            '<tr><td class="mono">from_email</td><td class="mono">string</td><td><span class="param-pill-opt">Optional</span></td><td>Sender email override. Must be verified with provider domain.</td></tr>' +
            '<tr><td class="mono">reply_to</td><td class="mono">string</td><td><span class="param-pill-opt">Optional</span></td><td>Address to populate in the Reply-To header.</td></tr>' +
            '<tr><td class="mono">cc</td><td class="mono">string | string[]</td><td><span class="param-pill-opt">Optional</span></td><td>Carbon copy recipient email address(es).</td></tr>' +
            '<tr><td class="mono">bcc</td><td class="mono">string | string[]</td><td><span class="param-pill-opt">Optional</span></td><td>Blind carbon copy recipient email address(es).</td></tr>' +
            '<tr><td class="mono">provider_id</td><td class="mono">string</td><td><span class="param-pill-opt">Optional</span></td><td>Explicit provider circuit ID to bypass auto-priority.</td></tr>' +
            '<tr><td class="mono">priority</td><td class="mono">number</td><td><span class="param-pill-opt">Optional</span></td><td>Dispatch priority: <code>1</code> (Urgent), <code>2</code> (Normal, default), <code>3</code> (Bulk).</td></tr>' +
            '<tr><td class="mono">metadata</td><td class="mono">object</td><td><span class="param-pill-opt">Optional</span></td><td>Arbitrary JSON key-values stored in D1 audit trail for tracing.</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +

      '<h4 style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin:16px 0 8px;">Response Format (200 OK)</h4>' +
      '<div class="code-panel" style="margin-bottom:20px;">' +
        '<pre><code>' + [
          '{',
          '  "id": 142,',
          '  "status": "queued",',
          '  "message": "Email enqueued for sending"',
          '}'
        ].join(String.fromCharCode(10)) + '</code></pre>' +
      '</div>' +
    '</div>' +

    '<div style="margin-bottom:32px;border-top:1px solid var(--border-subtle);padding-top:24px;">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
        '<span class="method-badge method-get">GET</span>' +
        '<span style="font-family:var(--font-mono);font-size:16px;font-weight:600;color:var(--text-primary);">/api/status</span>' +
      '</div>' +
      '<p style="font-size:13.5px;color:var(--text-muted);margin-bottom:12px;">Query aggregate transmission counts categorized by queue state.</p>' +
      '<div class="code-panel">' +
        '<pre><code>' + [
          '{',
          '  "queued": 0,',
          '  "sending": 0,',
          '  "sent": 284,',
          '  "failed": 2',
          '}'
        ].join(String.fromCharCode(10)) + '</code></pre>' +
      '</div>' +
    '</div>' +

    '<div style="border-top:1px solid var(--border-subtle);padding-top:24px;">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">' +
        '<span class="method-badge method-get">GET</span>' +
        '<span style="font-family:var(--font-mono);font-size:16px;font-weight:600;color:var(--text-primary);">/api/logs</span>' +
      '</div>' +
      '<p style="font-size:13.5px;color:var(--text-muted);margin-bottom:12px;">Query paginated transmission audit trail with status and date filtering.</p>' +
      '<div class="table-container" style="border:1px solid var(--border-subtle);border-radius:6px;">' +
        '<table>' +
          '<thead><tr><th>Query Parameter</th><th>Default</th><th>Description</th></tr></thead>' +
          '<tbody>' +
            '<tr><td class="mono">limit</td><td class="mono">100</td><td>Max records returned (1-200).</td></tr>' +
            '<tr><td class="mono">offset</td><td class="mono">0</td><td>Pagination offset.</td></tr>' +
            '<tr><td class="mono">status</td><td class="mono">—</td><td>Filter by status: <code>queued</code>, <code>sending</code>, <code>sent</code>, <code>failed</code>.</td></tr>' +
            '<tr><td class="mono">search | q</td><td class="mono">—</td><td>Text search across subject, recipient, or sender.</td></tr>' +
            '<tr><td class="mono">from</td><td class="mono">—</td><td>Start date filter (YYYY-MM-DD).</td></tr>' +
            '<tr><td class="mono">to</td><td class="mono">—</td><td>End date filter (YYYY-MM-DD).</td></tr>' +
            '<tr><td class="mono">sort</td><td class="mono">updated_at_desc</td><td>Sorting order (<code>updated_at_desc</code>, <code>created_at_desc</code>, <code>created_at_asc</code>).</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ── Local Dev Helper & Init ────────────────────────────────
function useDevCredentials() {
  const u = document.getElementById('login-username');
  const p = document.getElementById('login-password');
  if (u) u.value = 'admin';
  if (p) p.value = 'unsent_admin_2026!';
  doAuth();
}

['login-username', 'login-password'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', ev => { if (ev.key === 'Enter') doAuth(); });
});

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  const h = document.getElementById('local-dev-hint');
  if (h) h.style.display = 'block';
}

window.addEventListener('popstate', function() {
  const route = resolveCurrentRoute();
  if (route.docsSubTab && route.docsSubTab !== activeDocsSubTab) {
    switchDocsSubTab(route.docsSubTab, false);
  }
  switchView(route.viewId, false);
});

window.addEventListener('hashchange', function() {
  const route = resolveCurrentRoute();
  if (route.docsSubTab && route.docsSubTab !== activeDocsSubTab) {
    switchDocsSubTab(route.docsSubTab, false);
  }
  switchView(route.viewId, false);
});

const initialRoute = resolveCurrentRoute();
if (initialRoute.docsSubTab) {
  switchDocsSubTab(initialRoute.docsSubTab, false);
}
switchView(initialRoute.viewId, false);

const savedSession = sessionStorage.getItem('unsent_session_token');
const savedUser = sessionStorage.getItem('unsent_admin_user');

if (savedSession) {
  document.getElementById('auth-overlay').style.display = 'none';
  document.getElementById('qr-base').textContent = window.location.origin;
  document.getElementById('qr-auth').textContent = 'Admin: ' + (savedUser || 'admin');
  fetchDash();
  fetchProviders();
  fetchKeys();
  fetchLogs();
} else {
  if (initialRoute.viewId === 'v-docs') {
    renderCredentialsCard();
    renderDocCodeSnippets();
    renderEmailTemplates();
    renderApiReference();
  }
}
</script>
</body>
</html>`;
}
