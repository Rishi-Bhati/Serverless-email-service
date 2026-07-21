export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reportary Mail Edge - Dashboard</title>
  <meta name="description" content="Reportary Mail Edge email queueing service — dashboard and API reference">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0b0f19;
      --bg-card: #151b2c;
      --border-color: #242f47;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --color-primary: #6366f1;
      --color-primary-glow: rgba(99,102,241,0.15);
      --color-cyan: #06b6d4;
      --color-green: #10b981;
      --color-red: #ef4444;
      --color-orange: #f59e0b;
      --color-purple: #a78bfa;
      --font-display: 'Outfit', sans-serif;
      --font-body: 'Plus Jakarta Sans', sans-serif;
      --font-mono: 'JetBrains Mono', 'Courier New', monospace;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: var(--font-body);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.5;
    }

    /* ── Auth Overlay ─────────────────────────────── */
    #auth-overlay {
      position: fixed; inset: 0;
      background: rgba(11,15,25,0.96);
      backdrop-filter: blur(12px);
      display: flex; justify-content: center; align-items: center;
      z-index: 1000;
      transition: opacity 0.3s;
    }
    .auth-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 20px;
      padding: 40px;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 24px 48px rgba(0,0,0,0.5), 0 0 60px var(--color-primary-glow);
      text-align: center;
    }
    .auth-card h2 {
      font-family: var(--font-display);
      font-size: 26px; font-weight: 700;
      margin-bottom: 6px;
      background: linear-gradient(135deg,#fff 0%,var(--text-muted) 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .auth-card > p { color: var(--text-muted); font-size: 13px; margin-bottom: 24px; }

    /* Mode segmented control in auth overlay */
    .auth-mode-group {
      display: flex; gap: 0;
      background: rgba(11,15,25,0.7);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 4px;
      margin-bottom: 20px;
    }
    .auth-mode-btn {
      flex: 1; background: none; border: none;
      color: var(--text-muted);
      padding: 8px 6px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 12px; font-weight: 600;
      font-family: var(--font-body);
      transition: all 0.2s;
      white-space: nowrap;
    }
    .auth-mode-btn.active {
      background: linear-gradient(135deg, var(--color-primary), #4f46e5);
      color: white;
      box-shadow: 0 2px 8px rgba(99,102,241,0.3);
    }

    .input-group { margin-bottom: 16px; text-align: left; }
    .input-group label {
      display: block; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.06em;
      margin-bottom: 7px; color: var(--text-muted);
    }
    .input-field {
      width: 100%;
      background: rgba(11,15,25,0.6);
      border: 1px solid var(--border-color);
      border-radius: 8px; padding: 11px 14px;
      color: white; font-family: inherit; font-size: 14px;
      transition: all 0.2s;
    }
    .input-field:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 10px rgba(99,102,241,0.25); }
    .auth-hint {
      font-size: 11px; color: var(--text-muted);
      text-align: left; margin-bottom: 20px; line-height: 1.6;
      padding: 10px 12px;
      background: rgba(99,102,241,0.06);
      border: 1px solid rgba(99,102,241,0.15);
      border-radius: 8px;
    }
    .auth-hint b { color: var(--color-purple); }
    .btn {
      width: 100%;
      background: linear-gradient(135deg, var(--color-primary), #4f46e5);
      color: white; border: none; border-radius: 8px;
      padding: 13px; font-family: var(--font-display);
      font-weight: 600; font-size: 15px;
      cursor: pointer; transition: all 0.2s;
      box-shadow: 0 4px 14px rgba(99,102,241,0.35);
    }
    .btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(99,102,241,0.45); }

    /* ── Header ───────────────────────────────────── */
    header {
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-color);
      padding: 14px 36px;
      display: flex; justify-content: space-between; align-items: center;
      position: sticky; top: 0; z-index: 100;
    }
    .logo-container { display: flex; align-items: center; gap: 12px; }
    .logo-badge {
      background: linear-gradient(135deg, var(--color-primary), var(--color-cyan));
      width: 34px; height: 34px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 17px; color: white;
      box-shadow: 0 0 15px rgba(99,102,241,0.4);
    }
    .logo-text { font-family: var(--font-display); font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }
    .logo-text span {
      background: linear-gradient(135deg, var(--color-primary), var(--color-cyan));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }

    /* Nav tabs */
    .nav-tabs {
      display: flex; gap: 4px;
      background: rgba(11,15,25,0.6);
      border: 1px solid var(--border-color);
      border-radius: 9px; padding: 4px;
    }
    .nav-tab {
      background: none; border: none;
      color: var(--text-muted);
      padding: 7px 18px; border-radius: 6px;
      cursor: pointer; font-size: 13px; font-weight: 600;
      font-family: var(--font-body);
      transition: all 0.2s;
      display: flex; align-items: center; gap: 6px;
    }
    .nav-tab.active { background: var(--color-primary); color: white; }
    .nav-tab:hover:not(.active) { color: var(--text-main); background: rgba(255,255,255,0.06); }

    .header-right { display: flex; align-items: center; gap: 14px; }
    .status-pill {
      background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);
      color: var(--color-green); padding: 5px 11px; border-radius: 20px;
      font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px;
    }
    .status-dot {
      width: 7px; height: 7px; background: var(--color-green);
      border-radius: 50%; box-shadow: 0 0 7px var(--color-green);
    }
    .ghost-btn {
      background: none; border: 1px solid var(--border-color);
      color: var(--text-muted); padding: 7px 13px;
      border-radius: 8px; cursor: pointer; font-size: 13px;
      font-family: var(--font-body); transition: all 0.2s;
    }
    .ghost-btn:hover { border-color: var(--color-red); color: var(--color-red); }

    /* Report issues button */
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

    /* ── Dashboard Main ───────────────────────────── */
    main {
      flex: 1; padding: 36px 40px;
      max-width: 1400px; width: 100%; margin: 0 auto;
      display: grid; grid-template-columns: 1fr; gap: 28px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 18px;
    }
    .stat-card {
      background: var(--bg-card); border: 1px solid var(--border-color);
      border-radius: 12px; padding: 22px;
      display: flex; flex-direction: column;
      position: relative; overflow: hidden;
      transition: transform 0.2s, border-color 0.2s;
    }
    .stat-card:hover { transform: translateY(-2px); border-color: rgba(99,102,241,0.4); }
    .stat-label { color: var(--text-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .stat-value { font-family: var(--font-display); font-size: 34px; font-weight: 700; line-height: 1; }
    .stat-indicator { width: 4px; position: absolute; top: 0; left: 0; bottom: 0; }
    .stat-queued  .stat-indicator { background: var(--color-cyan); }
    .stat-sending .stat-indicator { background: var(--color-orange); }
    .stat-sent    .stat-indicator { background: var(--color-green); }
    .stat-failed  .stat-indicator { background: var(--color-red); }

    .content-grid {
      display: grid; grid-template-columns: 1fr; gap: 28px;
    }
    @media (min-width: 1024px) { .content-grid { grid-template-columns: 3fr 2fr; } }

    .panel {
      background: var(--bg-card); border: 1px solid var(--border-color);
      border-radius: 14px; padding: 26px; display: flex; flex-direction: column;
    }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    .panel-title {
      font-family: var(--font-display); font-size: 16px; font-weight: 600;
      display: flex; align-items: center; gap: 8px;
    }

    /* Table */
    .table-container { overflow-x: auto; min-height: 220px; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th {
      color: var(--text-muted); font-weight: 600; padding: 11px 14px;
      border-bottom: 1px solid var(--border-color);
      text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em;
    }
    td { padding: 13px 14px; border-bottom: 1px solid rgba(36,47,71,0.5); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .status-badge {
      display: inline-flex; align-items: center;
      padding: 3px 9px; border-radius: 12px;
      font-size: 11px; font-weight: 600; gap: 4px;
    }
    .badge-queued  { background: rgba(6,182,212,0.1);  border: 1px solid rgba(6,182,212,0.2);  color: var(--color-cyan); }
    .badge-sending { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.2); color: var(--color-orange); }
    .badge-sent    { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2); color: var(--color-green); }
    .badge-failed  { background: rgba(239,68,68,0.1);  border: 1px solid rgba(239,68,68,0.2);  color: var(--color-red); }
    .err-text {
      color: var(--color-red); font-size: 11px;
      font-family: var(--font-mono); max-width: 160px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help;
    }
    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: var(--text-muted); padding: 50px 0; gap: 10px;
    }

    /* Expandable rows */
    .expand-caret {
      transition: transform 0.2s ease;
      cursor: pointer;
    }
    .expand-caret.rotated {
      transform: rotate(90deg);
    }
    .log-row {
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .log-row:hover {
      background-color: rgba(255, 255, 255, 0.02) !important;
    }
    .detail-row {
      background-color: rgba(11, 15, 25, 0.4);
    }
    .detail-container {
      padding: 20px;
      border-radius: 8px;
      background-color: var(--bg-dark);
      border: 1px solid var(--border-color);
      border-left: 4px solid var(--color-primary);
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin: 10px 4px;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 768px) {
      .detail-grid {
        grid-template-columns: 1fr 1fr;
      }
    }
    .detail-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .detail-label {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      color: var(--text-muted);
      letter-spacing: 0.05em;
    }
    .detail-val {
      font-size: 13px;
      color: var(--text-main);
      line-height: 1.6;
    }
    .detail-val-mono {
      font-family: var(--font-mono);
      font-size: 12px;
      background: rgba(0,0,0,0.3);
      padding: 10px 14px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      max-height: 180px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    /* Email Body Tab layout inside detail container */
    .detail-tabs-bar {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      gap: 4px;
      margin-bottom: 8px;
    }
    .detail-tab {
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
      font-family: var(--font-body);
    }
    .detail-tab.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
    }
    /* Iframe styled preview */
    .body-preview-iframe {
      width: 100%;
      height: 250px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: white;
    }

    /* Filter Controls in Logs page */
    .filter-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      margin-bottom: 20px;
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      padding: 16px 24px;
      border-radius: 12px;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .filter-group label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .filter-select {
      background-color: rgba(11, 15, 25, 0.6);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 14px;
      color: white;
      font-size: 13px;
      outline: none;
      font-family: inherit;
    }
    .filter-select:focus {
      border-color: var(--color-primary);
    }
    .filter-search-input {
      background-color: rgba(11, 15, 25, 0.6);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 14px;
      color: white;
      font-size: 13px;
      outline: none;
      font-family: inherit;
      width: 280px;
    }
    .filter-search-input:focus {
      border-color: var(--color-primary);
    }

    /* Pagination controls */
    .pagination-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 20px;
      margin-top: 10px;
      border-top: 1px solid var(--border-color);
    }
    .pagination-info {
      font-size: 12px;
      color: var(--text-muted);
    }
    .pagination-btns {
      display: flex;
      gap: 8px;
    }
    .pagination-btn {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 500;
    }
    .pagination-btn:hover:not(:disabled) {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
    .pagination-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Form */
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 11px; font-weight: 600; margin-bottom: 5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .form-control {
      width: 100%; background: rgba(11,15,25,0.4);
      border: 1px solid var(--border-color); border-radius: 8px;
      padding: 9px 12px; color: white; font-family: inherit; font-size: 13px;
      transition: all 0.2s;
    }
    .form-control:focus { outline: none; border-color: var(--color-primary); }
    textarea.form-control { min-height: 100px; resize: vertical; }

    /* Inline code + pre */
    code {
      font-family: var(--font-mono);
      background: rgba(11,15,25,0.8); border: 1px solid var(--border-color);
      border-radius: 5px; padding: 2px 6px; font-size: 12px; color: #fb7185;
    }
    pre {
      background: rgba(11,15,25,0.85); border: 1px solid var(--border-color);
      border-radius: 10px; padding: 16px 18px;
      font-family: var(--font-mono); font-size: 12px;
      overflow-x: auto; color: #e2e8f0;
      position: relative; line-height: 1.7;
      tab-size: 2;
    }
    .copy-btn {
      position: absolute; top: 10px; right: 10px;
      background: var(--bg-card); border: 1px solid var(--border-color);
      color: var(--text-muted); padding: 4px 9px;
      border-radius: 5px; font-size: 10px; cursor: pointer;
      transition: all 0.2s; font-family: var(--font-body); font-weight: 600;
    }
    .copy-btn:hover { color: white; border-color: var(--color-primary); }
    .copy-btn.copied { color: var(--color-green); border-color: var(--color-green); }

    /* Security mode badge in quick-ref panel */
    .mode-indicator {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700;
    }
    .mode-apikey { background: rgba(239,68,68,0.1);   border: 1px solid rgba(239,68,68,0.2);   color: var(--color-red); }
    .mode-signed { background: rgba(245,158,11,0.1);  border: 1px solid rgba(245,158,11,0.2);  color: var(--color-orange); }
    .mode-full   { background: rgba(16,185,129,0.1);  border: 1px solid rgba(16,185,129,0.2);  color: var(--color-green); }

    /* ── Docs View ────────────────────────────────── */
    #view-docs { flex: 1; display: flex; flex-direction: column; }
    .docs-main { flex: 1; padding: 36px 40px; max-width: 1400px; width: 100%; margin: 0 auto; }

    .docs-hero {
      text-align: center;
      padding: 48px 20px 36px;
    }
    .docs-hero-eyebrow {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);
      color: var(--color-purple); padding: 5px 14px; border-radius: 20px;
      font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
      margin-bottom: 20px;
    }
    .docs-hero h1 {
      font-family: var(--font-display); font-size: 44px; font-weight: 700;
      margin-bottom: 12px; line-height: 1.1;
      background: linear-gradient(135deg,#fff 30%,#a5b4fc 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .docs-hero-sub { color: var(--text-muted); font-size: 16px; margin-bottom: 32px; max-width: 560px; margin-left: auto; margin-right: auto; }

    /* Docs mode pills */
    .docs-mode-wrap { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .docs-mode-label { color: var(--text-muted); font-size: 13px; font-weight: 500; }
    .docs-mode-pills {
      display: inline-flex;
      background: rgba(11,15,25,0.7);
      border: 1px solid var(--border-color);
      border-radius: 12px; padding: 5px;
    }
    .mode-pill {
      background: none; border: none;
      color: var(--text-muted);
      padding: 9px 22px; border-radius: 8px;
      cursor: pointer; font-size: 13px; font-weight: 600;
      font-family: var(--font-body); transition: all 0.25s;
    }
    .mode-pill.active {
      background: linear-gradient(135deg, var(--color-primary), #4f46e5);
      color: white;
      box-shadow: 0 4px 14px rgba(99,102,241,0.35);
    }
    .mode-pill:hover:not(.active) { color: var(--text-main); }

    .mode-desc-box {
      display: inline-flex; align-items: flex-start; gap: 10px;
      background: rgba(11,15,25,0.5); border: 1px solid var(--border-color);
      border-radius: 10px; padding: 12px 18px; margin-top: 16px;
      max-width: 640px; text-align: left; font-size: 13px; color: var(--text-muted);
      line-height: 1.6;
    }

    /* Docs grid */
    .docs-grid {
      display: grid; gap: 24px; grid-template-columns: 1fr;
      margin-bottom: 24px;
    }
    @media (min-width: 1024px) { .docs-grid { grid-template-columns: 1fr 1fr; } }

    /* Security comparison table */
    .compare-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .compare-table th {
      color: var(--text-muted); text-align: left; padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .compare-table td { padding: 12px 14px; border-bottom: 1px solid rgba(36,47,71,0.4); }
    .compare-table tr:last-child td { border-bottom: none; }
    .compare-table td:first-child { color: var(--text-muted); }
    .check-yes { color: var(--color-green); font-size: 15px; }
    .check-no  { color: #374151; font-size: 15px; }

    /* Request block diagram */
    .req-block {
      background: rgba(11,15,25,0.8); border: 1px solid var(--border-color);
      border-radius: 10px; padding: 18px 20px;
      font-family: var(--font-mono); font-size: 12.5px; line-height: 1.9;
    }
    .req-method { color: #fb7185; font-weight: 700; }
    .req-path   { color: #e2e8f0; }
    .req-header-name  { color: #6ee7b7; }
    .req-header-value { color: #fbbf24; }
    .req-header-value.dim { color: #4b5563; font-style: italic; }
    .req-divider { border: none; border-top: 1px dashed var(--border-color); margin: 10px 0; }
    .req-body   { color: #a5b4fc; }

    /* Signing steps */
    .signing-steps { display: flex; flex-direction: column; gap: 14px; margin-top: 4px; }
    .step { display: flex; gap: 14px; align-items: flex-start; }
    .step-num {
      width: 26px; height: 26px; min-width: 26px;
      background: linear-gradient(135deg, var(--color-primary), #4f46e5);
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; color: white; margin-top: 2px;
    }
    .step-content { flex: 1; }
    .step-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
    .step-desc  { color: var(--text-muted); font-size: 12px; line-height: 1.6; }
    .step-code  { margin-top: 6px; }
    .step-code pre { padding: 10px 14px; font-size: 11.5px; margin: 0; }

    /* Language tabs */
    .lang-tabs-bar {
      display: flex; border-bottom: 1px solid var(--border-color);
      margin-bottom: 0;
    }
    .lang-tab {
      background: none; border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted); padding: 9px 16px;
      cursor: pointer; font-size: 12px; font-weight: 600;
      font-family: var(--font-body); transition: all 0.2s; margin-bottom: -1px;
    }
    .lang-tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }

    /* Error reference */
    .err-ref-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .err-ref-table th {
      color: var(--text-muted); text-align: left; padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .err-ref-table td { padding: 11px 14px; border-bottom: 1px solid rgba(36,47,71,0.4); vertical-align: top; }
    .err-ref-table tr:last-child td { border-bottom: none; }
    .err-code { font-family: var(--font-mono); color: var(--color-red); font-size: 12px; font-weight: 500; }
    .err-reason { color: var(--text-muted); font-size: 12px; }

    /* ── Footer ───────────────────────────────────── */
    footer {
      text-align: center; padding: 20px;
      color: var(--text-muted); font-size: 12px;
      border-top: 1px solid var(--border-color); margin-top: auto;
    }

    /* ── Utility ──────────────────────────────────── */
    .section-title {
      font-family: var(--font-display); font-size: 14px; font-weight: 600;
      color: var(--color-cyan); margin-bottom: 10px;
      display: flex; align-items: center; gap: 6px;
    }
    .section-title::before { content: ''; width: 3px; height: 14px; background: var(--color-cyan); border-radius: 2px; display: inline-block; }
    .divider { border: none; border-top: 1px solid var(--border-color); margin: 20px 0; }
    .tag {
      display: inline-block; padding: 2px 8px; border-radius: 6px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .tag-get    { background: rgba(16,185,129,0.15); color: var(--color-green); }
    .tag-post   { background: rgba(99,102,241,0.15); color: var(--color-purple); }
    .tag-req    { background: rgba(239,68,68,0.12);  color: var(--color-red); }
    .tag-opt    { background: rgba(156,163,175,0.12); color: var(--text-muted); }
  </style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════ Auth Overlay -->
<div id="auth-overlay">
  <div class="auth-card">
    <div class="logo-badge" style="margin: 0 auto 14px auto; width:40px;height:40px;font-size:20px;">R</div>
    <h2>Authenticate</h2>
    <p>Enter your Worker credentials to access the dashboard.</p>

    <!-- Security Mode selector -->
    <div style="text-align:left; margin-bottom:10px;">
      <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;color:var(--text-muted);">Security Mode</label>
      <div class="auth-mode-group">
        <button type="button" class="auth-mode-btn" id="mode-btn-apikey"  onclick="selectAuthMode('api-key-only')">🔑 API Key Only</button>
        <button type="button" class="auth-mode-btn" id="mode-btn-signed"  onclick="selectAuthMode('signed')">🔐 Signed</button>
        <button type="button" class="auth-mode-btn active" id="mode-btn-full" onclick="selectAuthMode('full')">🛡️ Full</button>
      </div>
    </div>

    <div class="input-group">
      <label for="dashboard-api-key">API Key (X-API-Key)</label>
      <input type="password" id="dashboard-api-key" class="input-field" placeholder="rpt_xxxxxxxxxxxxxxxxx">
    </div>

    <div id="auth-secret-row" class="input-group">
      <label for="dashboard-api-secret">API Secret (signing key — never transmitted)</label>
      <input type="password" id="dashboard-api-secret" class="input-field" placeholder="your_api_secret_configured_in_worker">
    </div>

    <div class="auth-hint" id="auth-mode-hint">
      <b>Full mode:</b> Protects against tampering, replay attacks, and stale captured requests.
      Requires <code>API_SECRET</code> to be configured on both the Worker and here.
    </div>

    <button class="btn" onclick="authenticate()">Authenticate</button>
    <div id="auth-error" style="color:var(--color-red);font-size:12px;margin-top:12px;display:none;"></div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════════════ Header -->
<header>
  <div class="logo-container">
    <div class="logo-badge">R</div>
    <div class="logo-text">Reportary <span>Mail Edge</span></div>
  </div>

  <div class="nav-tabs">
    <button class="nav-tab active" data-view="dashboard" onclick="switchView('dashboard')" id="nav-dashboard">
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16"/></svg>
      Dashboard
    </button>
    <button class="nav-tab" data-view="logs" onclick="switchView('logs')" id="nav-logs">
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2a4 4 0 00-4-4H5m14 0v-2a4 4 0 00-4-4h-5m2 18h.01M12 21a9 9 0 110-18 9 9 0 010 18z"/></svg>
      Detailed Logs
    </button>
    <button class="nav-tab" data-view="docs" onclick="switchView('docs')" id="nav-docs">
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
      API Docs
    </button>
  </div>

  <div class="header-right">
    <a href="https://reportary.onrender.com/p/ux9b2b8F4pikYYwWBtPU5aCaB-4yT1ywXLPdU9k2EnQepHVsdO5EoSaUcehcwCEt/" target="_blank" class="report-issue-btn">
      <svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
      </svg>
      Report Issues
    </a>
    <div class="status-pill"><div class="status-dot"></div><span>Edge Active</span></div>
    <button class="ghost-btn" onclick="logout()">Disconnect</button>
  </div>
</header>

<!-- ═══════════════════════════════════════════════════════════════ DASHBOARD VIEW -->
<div id="view-dashboard">
  <main>
    <!-- Stats -->
    <div class="stats-grid">
      <div class="stat-card stat-queued">
        <div class="stat-indicator"></div>
        <div class="stat-label">Queued</div>
        <div class="stat-value" id="stats-queued">—</div>
      </div>
      <div class="stat-card stat-sending">
        <div class="stat-indicator"></div>
        <div class="stat-label">Sending</div>
        <div class="stat-value" id="stats-sending">—</div>
      </div>
      <div class="stat-card stat-sent">
        <div class="stat-indicator"></div>
        <div class="stat-label">Sent</div>
        <div class="stat-value" id="stats-sent">—</div>
      </div>
      <div class="stat-card stat-failed">
        <div class="stat-indicator"></div>
        <div class="stat-label">Failed</div>
        <div class="stat-value" id="stats-failed">—</div>
      </div>
    </div>

    <!-- Content grid -->
    <div class="content-grid">

      <!-- Left: Logs -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
            Recent Dispatch Logs (Last 10)
          </div>
          <div style="display:flex; gap:10px;">
            <button class="ghost-btn" style="border-color:var(--color-primary); color:var(--color-primary);" onclick="switchView('logs')">View Detailed Logs →</button>
            <button class="ghost-btn" onclick="fetchDashboardData(this)">Refresh Queue</button>
          </div>
        </div>
        <div class="table-container">
          <table id="logs-table">
            <thead>
              <tr>
                <th style="width: 40px;"></th>
                <th>ID</th><th>Recipient</th><th>Subject</th>
                <th>Status</th><th>Tries</th><th>Last Update</th>
              </tr>
            </thead>
            <tbody id="logs-body">
              <tr><td colspan="7" class="empty-state">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right column -->
      <div style="display:flex;flex-direction:column;gap:24px;">

        <!-- Test email -->
        <div class="panel">
          <div class="panel-title" style="margin-bottom:18px;">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
            Send Test Email
          </div>
          <form id="test-email-form" onsubmit="sendTestEmail(event)">
            <div class="form-group">
              <label for="test-to">To (comma-separated or JSON array)</label>
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
              <input type="text" id="test-subject" class="form-control" placeholder="Test from Reportary Mail Edge" required>
            </div>
            <div class="form-group">
              <label for="test-body">Body (HTML supported)</label>
              <textarea id="test-body" class="form-control" placeholder="&lt;h1&gt;Hello&lt;/h1&gt;&lt;p&gt;This is a test.&lt;/p&gt;" required></textarea>
            </div>
            <button type="submit" class="btn" id="send-test-btn" style="margin-top:4px;">Enqueue Test Email</button>
            <div id="test-result" style="margin-top:10px;font-size:13px;font-weight:500;display:none;"></div>
          </form>
        </div>

        <!-- Quick reference -->
        <div class="panel">
          <div class="panel-title" style="margin-bottom:16px;">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            Quick Reference
          </div>

          <div class="section-title">Endpoint</div>
          <code id="qr-endpoint" style="display:block;font-size:12px;padding:10px;margin-bottom:16px;word-break:break-all;">/api/send</code>

          <div class="section-title">Active Security Mode</div>
          <div id="qr-mode-badge" style="margin-bottom:16px;">
            <span class="mode-indicator mode-full">🛡️ Full</span>
          </div>

          <div class="section-title">Required Headers</div>
          <div id="qr-headers" style="font-size:12px;color:var(--text-muted);line-height:2;font-family:var(--font-mono);">
            X-API-Key, X-Timestamp, X-Nonce, X-Signature
          </div>

          <hr class="divider">
          <button class="btn" style="background:rgba(99,102,241,0.12);color:var(--color-primary);box-shadow:none;border:1px solid rgba(99,102,241,0.3);" onclick="switchView('docs')">
            View Full API Docs →
          </button>
        </div>

      </div>
    </div>
  </main>
</div>

<!-- ═══════════════════════════════════════════════════════════════ DETAILED LOGS VIEW -->
<div id="view-logs" style="display:none;">
  <main>
    <!-- Filter bar -->
    <div class="filter-bar">
      <div class="filter-group">
        <label for="log-filter-status">Status</label>
        <select id="log-filter-status" class="filter-select" onchange="onLogFilterChange()">
          <option value="">All Statuses</option>
          <option value="queued">Queued</option>
          <option value="sending">Sending</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="log-filter-sort">Sort By</label>
        <select id="log-filter-sort" class="filter-select" onchange="onLogFilterChange()">
          <option value="updated_at_desc">Last Update (Newest)</option>
          <option value="updated_at_asc">Last Update (Oldest)</option>
          <option value="created_at_desc">Created Time (Newest)</option>
          <option value="created_at_asc">Created Time (Oldest)</option>
          <option value="attempts_desc">Most Attempts</option>
        </select>
      </div>

      <div class="filter-group" style="flex: 1; min-width: 200px;">
        <label for="log-filter-search">Search</label>
        <input type="text" id="log-filter-search" class="filter-search-input" style="width:100%;" placeholder="Search subject, recipient, body, error..." oninput="onLogSearchInput()">
      </div>
      
      <div class="filter-group" style="align-self: flex-end;">
        <button class="ghost-btn" style="padding:9px 16px;" onclick="resetLogFilters()">Reset Filters</button>
      </div>
    </div>

    <!-- Logs Panel -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          Detailed Queue History Logs
        </div>
        <button class="ghost-btn" onclick="fetchDetailedLogsData(this)">Sync Table</button>
      </div>
      
      <div class="table-container">
        <table id="detailed-logs-table">
          <thead>
            <tr>
              <th style="width: 40px;"></th>
              <th>ID</th>
              <th>Recipient</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Tries</th>
              <th>Last Update</th>
            </tr>
          </thead>
          <tbody id="detailed-logs-body">
            <tr><td colspan="7" class="empty-state">Loading logs data...</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination Footer -->
      <div class="pagination-bar">
        <div class="pagination-info" id="logs-pagination-info">
          Showing 0 - 0 of 0 entries
        </div>
        <div class="pagination-btns">
          <button class="pagination-btn" id="btn-prev-page" onclick="changeLogsPage(-1)" disabled>
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            Previous
          </button>
          <button class="pagination-btn" id="btn-next-page" onclick="changeLogsPage(1)" disabled>
            Next
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
      </div>
    </div>
  </main>
</div>

<!-- ═══════════════════════════════════════════════════════════════ DOCS VIEW -->
<div id="view-docs" style="display:none;">
  <div class="docs-main">

    <!-- Hero -->
    <div class="docs-hero">
      <div class="docs-hero-eyebrow">📬 Reportary Mail Edge</div>
      <h1>API Reference</h1>
      <p class="docs-hero-sub">Everything you need to integrate Reportary Mail Edge into your application — from simple API key auth to full HMAC-signed requests.</p>

      <div class="docs-mode-wrap">
        <span class="docs-mode-label">Security Mode:</span>
        <div class="docs-mode-pills">
          <button class="mode-pill" data-mode="api-key-only" onclick="setDocsMode('api-key-only')">🔑 API Key Only</button>
          <button class="mode-pill" data-mode="signed"       onclick="setDocsMode('signed')">🔐 Signed</button>
          <button class="mode-pill active" data-mode="full"  onclick="setDocsMode('full')">🛡️ Full</button>
        </div>
      </div>
      <div id="mode-desc-box" class="mode-desc-box">
        🛡️ <span id="mode-desc-text">Maximum security. Verifies API key, HMAC signature, timestamp (±3 min), and a unique per-request nonce. Fully prevents tampering, replay attacks, and stale captures.</span>
      </div>
    </div>

    <!-- Security comparison -->
    <div class="panel" style="margin-bottom:24px;">
      <div class="panel-title" style="margin-bottom:16px;">
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
        Security Level Comparison
      </div>
      <table class="compare-table">
        <thead>
          <tr>
            <th>Protection</th>
            <th>🔑 API Key Only</th>
            <th>🔐 Signed</th>
            <th>🛡️ Full ★</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Identity verification</td>
            <td><span class="check-yes">✓</span></td>
            <td><span class="check-yes">✓</span></td>
            <td><span class="check-yes">✓</span></td>
          </tr>
          <tr>
            <td>Body tamper detection (HMAC)</td>
            <td><span class="check-no">✗</span></td>
            <td><span class="check-yes">✓</span></td>
            <td><span class="check-yes">✓</span></td>
          </tr>
          <tr>
            <td>Stale request rejection (±3 min)</td>
            <td><span class="check-no">✗</span></td>
            <td><span class="check-yes">✓</span></td>
            <td><span class="check-yes">✓</span></td>
          </tr>
          <tr>
            <td>Replay attack prevention (nonce)</td>
            <td><span class="check-no">✗</span></td>
            <td><span class="check-no">✗</span></td>
            <td><span class="check-yes">✓</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Main docs grid -->
    <div class="docs-grid">

      <!-- ── Left: Reference ─────────────────────── -->
      <div style="display:flex;flex-direction:column;gap:20px;">

        <!-- Endpoint -->
        <div class="panel">
          <div class="section-title">Endpoint</div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <span class="tag tag-post">POST</span>
            <code id="docs-endpoint" style="background:none;border:none;padding:0;font-size:13px;color:var(--text-main);">/api/send</code>
          </div>
          <p style="font-size:13px;color:var(--text-muted);line-height:1.7;">
            Queues an email for delivery. The worker enqueues the job in D1 and returns immediately — actual SMTP dispatch runs asynchronously.
          </p>
        </div>

        <!-- Request anatomy -->
        <div class="panel">
          <div class="section-title" style="margin-bottom:12px;">Request Structure</div>
          <div class="req-block">
            <div><span class="req-method">POST</span> <span class="req-path" id="req-path">/api/send</span></div>
            <hr class="req-divider">
            <div><span class="req-header-name">X-API-Key:&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="req-header-value">rpt_xxxxxxxxxxxx</span></div>
            <div id="req-timestamp-line"><span class="req-header-name">X-Timestamp:&nbsp;</span><span class="req-header-value">1752948932</span></div>
            <div id="req-nonce-line"><span class="req-header-name">X-Nonce:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="req-header-value">550e8400-e29b-41d4-a716-446655440000</span></div>
            <div id="req-sig-line"><span class="req-header-name">X-Signature:&nbsp;</span><span class="req-header-value">6d4c8a3b…</span></div>
            <div><span class="req-header-name">Content-Type:</span><span class="req-header-value"> application/json</span></div>
            <hr class="req-divider">
            <div class="req-body">{ "to": "…", "subject": "…", "body": "…" }</div>
          </div>
        </div>

        <!-- Request headers table -->
        <div class="panel">
          <div class="section-title" style="margin-bottom:12px;">Request Headers</div>
          <table class="compare-table">
            <thead>
              <tr><th>Header</th><th>Required</th><th>Description</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>X-API-Key</code></td>
                <td><span class="tag tag-req">Required</span></td>
                <td style="color:var(--text-muted);font-size:12px;">Your API key. Identifies the caller.</td>
              </tr>
              <tr id="hdr-timestamp" style="display:none;">
                <td><code>X-Timestamp</code></td>
                <td><span class="tag tag-req">Required</span></td>
                <td style="color:var(--text-muted);font-size:12px;">Unix epoch seconds (UTC). Must be within ±3 minutes of server time (UTC).</td>
              </tr>
              <tr id="hdr-nonce" style="display:none;">
                <td><code>X-Nonce</code></td>
                <td><span class="tag tag-req">Required</span></td>
                <td style="color:var(--text-muted);font-size:12px;">Unique request ID (e.g. UUID v4). Rejected if seen before.</td>
              </tr>
              <tr id="hdr-sig" style="display:none;">
                <td><code>X-Signature</code></td>
                <td><span class="tag tag-req">Required</span></td>
                <td style="color:var(--text-muted);font-size:12px;">HMAC-SHA256 hex over the canonical message (see Signing Guide).</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Request body -->
        <div class="panel">
          <div class="section-title" style="margin-bottom:12px;">Request Body (JSON)</div>
          <table class="compare-table">
            <thead>
              <tr><th>Field</th><th></th><th>Description</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>to</code></td>
                <td><span class="tag tag-req">Required</span></td>
                <td style="color:var(--text-muted);font-size:12px;">Recipient(s). String, comma-separated string, or array.</td>
              </tr>
              <tr>
                <td><code>subject</code></td>
                <td><span class="tag tag-req">Required</span></td>
                <td style="color:var(--text-muted);font-size:12px;">Email subject line.</td>
              </tr>
              <tr>
                <td><code>body</code></td>
                <td><span class="tag tag-req">Required</span></td>
                <td style="color:var(--text-muted);font-size:12px;">Email body. Raw HTML is detected automatically.</td>
              </tr>
              <tr>
                <td><code>cc</code></td>
                <td><span class="tag tag-opt">Optional</span></td>
                <td style="color:var(--text-muted);font-size:12px;">CC recipients. Same formats as <code>to</code>.</td>
              </tr>
              <tr>
                <td><code>bcc</code></td>
                <td><span class="tag tag-opt">Optional</span></td>
                <td style="color:var(--text-muted);font-size:12px;">BCC recipients. Same formats as <code>to</code>.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Signing guide (hidden in api-key-only mode) -->
        <div class="panel" id="signing-guide-panel">
          <div class="section-title" style="margin-bottom:14px;">Signing Guide</div>

          <div class="signing-steps">

            <div class="step">
              <div class="step-num">1</div>
              <div class="step-content">
                <div class="step-title">Get Unix timestamp (UTC)</div>
                <div class="step-desc">Current UTC time in seconds since Unix epoch. Must be within ±3 minutes of server time (UTC).</div>
              </div>
            </div>

            <div class="step" id="sign-step-nonce">
              <div class="step-num">2</div>
              <div class="step-content">
                <div class="step-title">Generate a UUID nonce <span style="font-size:10px;color:var(--color-green);font-weight:700;margin-left:4px;">FULL MODE ONLY</span></div>
                <div class="step-desc">A UUID v4 (or any unique random string). The server rejects any nonce it has seen before within the TTL window.</div>
              </div>
            </div>

            <div class="step">
              <div class="step-num" id="sign-step3-num">3</div>
              <div class="step-content">
                <div class="step-title">Compute SHA-256 of the raw request body</div>
                <div class="step-desc">Hash the exact bytes of the JSON body you will send — before any encoding changes.</div>
                <div class="step-code">
                  <pre>body_hash = SHA256(raw_request_body)  → hex string</pre>
                </div>
              </div>
            </div>

            <div class="step">
              <div class="step-num" id="sign-step4-num">4</div>
              <div class="step-content">
                <div class="step-title">Build the canonical message</div>
                <div class="step-desc">Join the parts with literal newline characters. In <em>signed</em> mode the nonce is an empty string, giving two consecutive newlines.</div>
                <div class="step-code">
                  <pre id="sign-canonical-msg">canonical_message =
  timestamp    + "\\n" +
  nonce        + "\\n" +
  body_hash</pre>
                </div>
              </div>
            </div>

            <div class="step">
              <div class="step-num" id="sign-step5-num">5</div>
              <div class="step-content">
                <div class="step-title">Compute HMAC-SHA256</div>
                <div class="step-desc">Sign the canonical message using your <strong>API Secret</strong> — the shared secret configured on both the Worker and your client. <em>Never sent in the request.</em></div>
                <div class="step-code">
                  <pre>X-Signature = HMAC_SHA256(API_SECRET, canonical_message)  → hex</pre>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div><!-- /docs left -->

      <!-- ── Right: Code Examples ────────────────── -->
      <div style="display:flex;flex-direction:column;gap:20px;">

        <div class="panel" style="padding:0;overflow:hidden;">
          <!-- Language tab bar -->
          <div class="lang-tabs-bar" style="padding:0 20px;background:rgba(11,15,25,0.3);">
            <button class="lang-tab active" data-lang="curl"   onclick="setLang('curl')"  >cURL / Bash</button>
            <button class="lang-tab"        data-lang="js"     onclick="setLang('js')"    >JavaScript</button>
            <button class="lang-tab"        data-lang="python" onclick="setLang('python')">Python</button>
          </div>

          <div style="position:relative;">
            <button class="copy-btn" onclick="copyCodeExample()" id="copy-code-btn">Copy</button>

            <!-- ─── cURL panels ─── -->
            <div id="lang-curl" class="lang-panel">
              <div data-mode="api-key-only" class="code-ex-wrap">
<pre>#!/bin/bash
curl -X POST YOUR_WORKER_URL/api/send \\
  -H "X-API-Key: rpt_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "user@example.com",
    "subject": "Hello from Reportary",
    "body": "&lt;h1&gt;Hello!&lt;/h1&gt;&lt;p&gt;Test email.&lt;/p&gt;"
  }'</pre>
              </div>
              <div data-mode="signed" class="code-ex-wrap" style="display:none;">
<pre>#!/bin/bash
API_KEY="rpt_your_api_key"
API_SECRET="your_api_secret"

BODY='{"to":"user@example.com","subject":"Hello","body":"&lt;h1&gt;Hello!&lt;/h1&gt;"}'
TIMESTAMP=$(date +%s)

# SHA-256 hash of the raw request body
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 | awk '{print $2}')

# Canonical message — signed mode uses empty nonce (two consecutive newlines)
MESSAGE="$TIMESTAMP

$BODY_HASH"

# HMAC-SHA256 signature
SIGNATURE=$(printf '%s' "$MESSAGE" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

curl -X POST YOUR_WORKER_URL/api/send \\
  -H "X-API-Key: $API_KEY" \\
  -H "X-Timestamp: $TIMESTAMP" \\
  -H "X-Signature: $SIGNATURE" \\
  -H "Content-Type: application/json" \\
  -d "$BODY"</pre>
              </div>
              <div data-mode="full" class="code-ex-wrap" style="display:none;">
<pre>#!/bin/bash
API_KEY="rpt_your_api_key"
API_SECRET="your_api_secret"

BODY='{"to":"user@example.com","subject":"Hello","body":"&lt;h1&gt;Hello!&lt;/h1&gt;"}'
TIMESTAMP=$(date +%s)
NONCE=$(uuidgen)   # or: cat /proc/sys/kernel/random/uuid

# SHA-256 hash of the raw request body
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 | awk '{print $2}')

# Canonical message: timestamp + newline + nonce + newline + body_hash
MESSAGE="$TIMESTAMP
$NONCE
$BODY_HASH"

# HMAC-SHA256 signature
SIGNATURE=$(printf '%s' "$MESSAGE" | openssl dgst -sha256 -hmac "$API_SECRET" | awk '{print $2}')

curl -X POST YOUR_WORKER_URL/api/send \\
  -H "X-API-Key: $API_KEY" \\
  -H "X-Timestamp: $TIMESTAMP" \\
  -H "X-Nonce: $NONCE" \\
  -H "X-Signature: $SIGNATURE" \\
  -H "Content-Type: application/json" \\
  -d "$BODY"</pre>
              </div>
            </div><!-- /lang-curl -->

            <!-- ─── JavaScript panels ─── -->
            <div id="lang-js" class="lang-panel" style="display:none;">
              <div data-mode="api-key-only" class="code-ex-wrap">
<pre>const response = await fetch('YOUR_WORKER_URL/api/send', {
  method: 'POST',
  headers: {
    'X-API-Key': 'rpt_your_api_key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    to: 'user@example.com',
    subject: 'Hello from Reportary',
    body: '&lt;h1&gt;Hello!&lt;/h1&gt;&lt;p&gt;Test email.&lt;/p&gt;'
  })
});

const data = await response.json();
console.log(data); // { success: true, id: 42 }</pre>
              </div>
              <div data-mode="signed" class="code-ex-wrap" style="display:none;">
<pre>async function sendEmail(apiKey, apiSecret, payload) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // SHA-256 of request body
  const bodyBytes = new TextEncoder().encode(body);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  // Canonical message — signed mode: empty nonce → two newlines
  const message = timestamp + "\\n" + "\\n" + bodyHash;

  // HMAC-SHA256 signature
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const signature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return fetch('YOUR_WORKER_URL/api/send', {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'Content-Type': 'application/json'
    },
    body
  });
}

// Usage
sendEmail('rpt_your_api_key', 'your_api_secret', {
  to: 'user@example.com',
  subject: 'Hello',
  body: '&lt;h1&gt;Hello!&lt;/h1&gt;'
});</pre>
              </div>
              <div data-mode="full" class="code-ex-wrap" style="display:none;">
<pre>async function sendEmail(apiKey, apiSecret, payload) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID(); // unique per request

  // SHA-256 of request body
  const bodyBytes = new TextEncoder().encode(body);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  // Canonical message: timestamp + newline + nonce + newline + body_hash
  const message = timestamp + "\\n" + nonce + "\\n" + bodyHash;

  // HMAC-SHA256 signature
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const signature = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return fetch('YOUR_WORKER_URL/api/send', {
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

// Usage
sendEmail('rpt_your_api_key', 'your_api_secret', {
  to: 'user@example.com',
  subject: 'Hello',
  body: '&lt;h1&gt;Hello!&lt;/h1&gt;'
});</pre>
              </div>
            </div><!-- /lang-js -->

            <!-- ─── Python panels ─── -->
            <div id="lang-python" class="lang-panel" style="display:none;">
              <div data-mode="api-key-only" class="code-ex-wrap">
<pre>import requests
import json

body = json.dumps({
    'to': 'user@example.com',
    'subject': 'Hello from Reportary',
    'body': '&lt;h1&gt;Hello!&lt;/h1&gt;&lt;p&gt;Test email.&lt;/p&gt;'
})
response = requests.post(
    'YOUR_WORKER_URL/api/send',
    headers={
        'X-API-Key': 'rpt_your_api_key',
        'Content-Type': 'application/json'
    },
    data=body
)
print(response.json())</pre>
              </div>
              <div data-mode="signed" class="code-ex-wrap" style="display:none;">
<pre>import requests, hmac, hashlib, time, json

API_KEY    = "rpt_your_api_key"
API_SECRET = "your_api_secret"

payload = {
    'to': 'user@example.com',
    'subject': 'Hello from Reportary',
    'body': '&lt;h1&gt;Hello!&lt;/h1&gt;'
}
# Use compact JSON — whitespace changes the body hash
body      = json.dumps(payload, separators=(',', ':'))
timestamp = str(int(time.time()))

# SHA-256 of request body
body_hash = hashlib.sha256(body.encode()).hexdigest()

# Canonical message — signed mode: empty nonce → two consecutive newlines
message   = timestamp + "\\n" + "\\n" + body_hash
signature = hmac.new(
    API_SECRET.encode(), message.encode(), hashlib.sha256
).hexdigest()

response = requests.post(
    'YOUR_WORKER_URL/api/send',
    headers={
        'X-API-Key':   API_KEY,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
        'Content-Type': 'application/json'
    },
    data=body
)
print(response.json())</pre>
              </div>
              <div data-mode="full" class="code-ex-wrap" style="display:none;">
<pre>import requests, hmac, hashlib, time, uuid, json

API_KEY    = "rpt_your_api_key"
API_SECRET = "your_api_secret"

payload = {
    'to': 'user@example.com',
    'subject': 'Hello from Reportary',
    'body': '&lt;h1&gt;Hello!&lt;/h1&gt;'
}
# Use compact JSON — whitespace changes the body hash
body      = json.dumps(payload, separators=(',', ':'))
timestamp = str(int(time.time()))
nonce     = str(uuid.uuid4())  # unique per request

# SHA-256 of request body
body_hash = hashlib.sha256(body.encode()).hexdigest()

# Canonical message: timestamp + newline + nonce + newline + body_hash
message   = timestamp + "\\n" + nonce + "\\n" + body_hash
signature = hmac.new(
    API_SECRET.encode(), message.encode(), hashlib.sha256
).hexdigest()

response = requests.post(
    'YOUR_WORKER_URL/api/send',
    headers={
        'X-API-Key':   API_KEY,
        'X-Timestamp': timestamp,
        'X-Nonce':     nonce,
        'X-Signature': signature,
        'Content-Type': 'application/json'
    },
    data=body
)
print(response.json())</pre>
              </div>
            </div><!-- /lang-python -->

          </div><!-- /position:relative -->
        </div><!-- /code examples panel -->

        <!-- Response -->
        <div class="panel">
          <div class="section-title" style="margin-bottom:12px;">Response</div>
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">On success, returns <code>202 Accepted</code>:</p>
          <pre>{
  "success": true,
  "id": 42,
  "message": "Email successfully queued for sending"
}</pre>
        </div>

        <!-- Error reference -->
        <div class="panel">
          <div class="section-title" style="margin-bottom:12px;">Error Reference</div>
          <table class="err-ref-table">
            <thead>
              <tr><th>HTTP</th><th>reason field</th><th>Cause</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>401</code></td>
                <td class="err-code">Invalid API key</td>
                <td class="err-reason">X-API-Key missing or does not match.</td>
              </tr>
              <tr>
                <td><code>401</code></td>
                <td class="err-code">Missing X-Timestamp header</td>
                <td class="err-reason">Header required in signed / full modes.</td>
              </tr>
              <tr>
                <td><code>401</code></td>
                <td class="err-code">Timestamp out of range</td>
                <td class="err-reason">Clock skew exceeds ±3 minutes. Ensure client timestamp is in UTC Unix epoch seconds.</td>
              </tr>
              <tr>
                <td><code>401</code></td>
                <td class="err-code">Missing X-Nonce header</td>
                <td class="err-reason">Nonce required in full mode.</td>
              </tr>
              <tr>
                <td><code>401</code></td>
                <td class="err-code">Invalid signature</td>
                <td class="err-reason">HMAC mismatch — body tampered or wrong API_SECRET.</td>
              </tr>
              <tr>
                <td><code>401</code></td>
                <td class="err-code">Nonce already used</td>
                <td class="err-reason">Replay attack detected — nonce seen before.</td>
              </tr>
              <tr>
                <td><code>400</code></td>
                <td class="err-code">Missing "to" / "subject" / "body"</td>
                <td class="err-reason">Required body fields not provided.</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div><!-- /docs right -->
    </div><!-- /docs-grid -->

  </div><!-- /docs-main -->
</div><!-- /view-docs -->

<!-- ═══════════════════════════════════════════════════════════════ Footer -->
<footer>
  &copy; 2026 Reportary. Running on Cloudflare Workers &amp; D1 Serverless SQLite.
</footer>

<script>
  // ── Storage helpers ──────────────────────────────────────────────────────
  function getApiKey()      { return localStorage.getItem('reportary_api_key') || ''; }
  function getApiSecret()   { return localStorage.getItem('reportary_api_secret') || ''; }
  function getSecurityMode(){ return localStorage.getItem('reportary_security_mode') || 'full'; }

  // ── Auth overlay ─────────────────────────────────────────────────────────
  var AUTH_MODE_HINTS = {
    'api-key-only': '<b>API Key Only:</b> Sends only the <code>X-API-Key</code> header. Simple to integrate but provides no protection against interception, body tampering, or replay attacks.',
    'signed':       '<b>Signed mode:</b> Attaches <code>X-Timestamp</code> and an HMAC signature. Protects against body tampering and stale captures. Requires <code>API_SECRET</code> on both sides.',
    'full':         '<b>Full mode:</b> Maximum security. Adds a unique <code>X-Nonce</code> on every request. Fully prevents replay attacks in addition to all Signed-mode protections. Requires <code>API_SECRET</code>.'
  };

  function selectAuthMode(mode) {
    ['apikey','signed','full'].forEach(function(m) {
      var b = document.getElementById('mode-btn-' + m);
      if (b) b.classList.remove('active');
    });
    var key = mode === 'api-key-only' ? 'apikey' : mode;
    var btn = document.getElementById('mode-btn-' + key);
    if (btn) btn.classList.add('active');

    document.getElementById('auth-secret-row').style.display =
      (mode === 'api-key-only') ? 'none' : '';
    document.getElementById('auth-mode-hint').innerHTML =
      AUTH_MODE_HINTS[mode] || '';

    localStorage.setItem('reportary_security_mode', mode);
    updateQuickRef();
  }

  function authenticate() {
    var apiKey    = (document.getElementById('dashboard-api-key').value || '').trim();
    var apiSecret = (document.getElementById('dashboard-api-secret').value || '').trim();
    var mode      = getSecurityMode();
    var errEl     = document.getElementById('auth-error');

    errEl.style.display = 'none';

    if (!apiKey) {
      errEl.textContent = 'API Key is required.';
      errEl.style.display = 'block'; return;
    }
    if (mode !== 'api-key-only' && !apiSecret) {
      errEl.textContent = 'API Secret is required for Signed and Full modes.';
      errEl.style.display = 'block'; return;
    }

    localStorage.setItem('reportary_api_key', apiKey);
    localStorage.setItem('reportary_api_secret', apiSecret);
    checkAuth();
  }

  function logout() {
    localStorage.removeItem('reportary_api_key');
    localStorage.removeItem('reportary_api_secret');
    document.getElementById('auth-overlay').style.display = 'flex';
  }

  async function checkAuth() {
    var key = getApiKey();
    if (!key) { document.getElementById('auth-overlay').style.display = 'flex'; return; }
    document.getElementById('auth-overlay').style.display = 'none';
    var ok = await fetchDashboardData();
    if (!ok) {
      document.getElementById('auth-overlay').style.display = 'flex';
      document.getElementById('auth-error').textContent = 'Authentication failed. Check your API Key.';
      document.getElementById('auth-error').style.display = 'block';
    } else {
      fetchDetailedLogsData();
    }
  }

  // ── Crypto signing ───────────────────────────────────────────────────────
  async function signRequest(apiSecret, rawBody, mode) {
    var timestamp = Math.floor(Date.now() / 1000).toString();
    var nonce     = (mode === 'full') ? crypto.randomUUID() : '';

    var bodyBytes   = new TextEncoder().encode(rawBody);
    var hashBuffer  = await crypto.subtle.digest('SHA-256', bodyBytes);
    var bodyHash    = Array.from(new Uint8Array(hashBuffer))
      .map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

    var message = timestamp + '\\n' + nonce + '\\n' + bodyHash;

    var keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(apiSecret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    var sigBuffer = await crypto.subtle.sign(
      'HMAC', keyMaterial, new TextEncoder().encode(message)
    );
    var signature = Array.from(new Uint8Array(sigBuffer))
      .map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');

    return { timestamp: timestamp, nonce: nonce, signature: signature };
  }

  function buildAuthHeaders(mode, apiKey, sigResult) {
    var h = { 'X-API-Key': apiKey };
    if (mode === 'signed' || mode === 'full') {
      h['X-Timestamp'] = sigResult.timestamp;
      h['X-Signature'] = sigResult.signature;
      if (mode === 'full') { h['X-Nonce'] = sigResult.nonce; }
    }
    return h;
  }

  // ── Expandable table helper ──────────────────────────────────────────────
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  function toggleExpand(rowId, prefix) {
    var caret = document.getElementById(prefix + 'caret-' + rowId);
    var details = document.getElementById(prefix + 'detail-' + rowId);
    if (caret && details) {
      var isHidden = details.style.display === 'none';
      details.style.display = isHidden ? '' : 'none';
      if (isHidden) {
        caret.classList.add('rotated');
      } else {
        caret.classList.remove('rotated');
      }
    }
  }

  function switchDetailBodyTab(prefix, id, tab) {
    var previewTab = document.getElementById(prefix + 'tab-preview-' + id);
    var rawTab = document.getElementById(prefix + 'tab-raw-' + id);
    var previewEl = document.getElementById(prefix + 'body-preview-' + id);
    var rawEl = document.getElementById(prefix + 'body-raw-' + id);
    
    if (previewTab && rawTab && previewEl && rawEl) {
      if (tab === 'preview') {
        previewTab.classList.add('active');
        rawTab.classList.remove('active');
        previewEl.style.display = '';
        rawEl.style.display = 'none';
      } else {
        previewTab.classList.remove('active');
        rawTab.classList.add('active');
        previewEl.style.display = 'none';
        rawEl.style.display = '';
      }
    }
  }

  function renderLogRow(tbody, log, prefix) {
    var date = new Date(log.updated_at);
    var timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
                  ' ' + date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                  
    var createdDate = new Date(log.created_at || log.updated_at);
    var createdTimeStr = createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
                        ' ' + createdDate.toLocaleDateString([], { month: 'short', day: 'numeric' });

    var toDisp = '';
    var ccDisp = '';
    var bccDisp = '';
    
    try {
      var toObj = JSON.parse(log.to_json);
      if (Array.isArray(toObj))       toDisp = toObj.map(function(o) { return typeof o === 'string' ? o : o.email; }).join(', ');
      else if (typeof toObj === 'object') toDisp = toObj.email || JSON.stringify(toObj);
      else                            toDisp = String(toObj);
    } catch(_) { toDisp = log.to_json; }

    try {
      if (log.cc_json) {
        var ccObj = JSON.parse(log.cc_json);
        if (Array.isArray(ccObj))       ccDisp = ccObj.map(function(o) { return typeof o === 'string' ? o : o.email; }).join(', ');
        else if (typeof ccObj === 'object') ccDisp = ccObj.email || JSON.stringify(ccObj);
        else                            ccDisp = String(ccObj);
      }
    } catch(_) { ccDisp = log.cc_json; }

    try {
      if (log.bcc_json) {
        var bccObj = JSON.parse(log.bcc_json);
        if (Array.isArray(bccObj))       bccDisp = bccObj.map(function(o) { return typeof o === 'string' ? o : o.email; }).join(', ');
        else if (typeof bccObj === 'object') bccDisp = bccObj.email || JSON.stringify(bccObj);
        else                            bccDisp = String(bccObj);
      }
    } catch(_) { bccDisp = log.bcc_json; }

    var tr = document.createElement('tr');
    tr.className = 'log-row';
    tr.onclick = function(e) {
      if (e.target.closest('.detail-container') || e.target.closest('button') || e.target.closest('a')) return;
      toggleExpand(log.id, prefix);
    };

    tr.innerHTML =
      '<td style="text-align:center; padding:10px 0;"><svg id="' + prefix + 'caret-' + log.id + '" class="expand-caret" width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:var(--text-muted);"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"/></svg></td>' +
      '<td style="color:var(--text-muted);font-weight:600;">#' + log.id + '</td>' +
      '<td style="font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + toDisp + '">' + toDisp + '</td>' +
      '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + log.subject + '">' + log.subject + '</td>' +
      '<td><span class="status-badge badge-' + log.status + '">' + log.status + '</span></td>' +
      '<td style="text-align:center;">' + log.attempts + '</td>' +
      '<td style="color:var(--text-muted);font-size:12px;">' + timeStr + '</td>';

    tbody.appendChild(tr);

    // Detail row rendering
    var detTr = document.createElement('tr');
    detTr.id = prefix + 'detail-' + log.id;
    detTr.className = 'detail-row';
    detTr.style.display = 'none';

    var ccHtml = ccDisp ? '<div><span style="font-weight:600; color:var(--color-orange);">CC:</span> ' + escapeHtml(ccDisp) + '</div>' : '';
    var bccHtml = bccDisp ? '<div><span style="font-weight:600; color:var(--color-purple);">BCC:</span> ' + escapeHtml(bccDisp) + '</div>' : '';
    
    var errHtml = log.error ? 
      '<div class="detail-block">' +
        '<div class="detail-label" style="color:var(--color-red);">Error Log</div>' +
        '<div class="detail-val-mono" style="border-color:rgba(239, 68, 68, 0.3); color:#fca5a5;">' + escapeHtml(log.error) + '</div>' +
      '</div>' : '';

    detTr.innerHTML = 
      '<td colspan="7">' +
        '<div class="detail-container">' +
          '<div class="detail-grid">' +
            '<div class="detail-block">' +
              '<div class="detail-label">Recipients</div>' +
              '<div class="detail-val">' +
                '<div><span style="font-weight:600; color:var(--color-cyan);">To:</span> ' + escapeHtml(toDisp) + '</div>' +
                ccHtml +
                bccHtml +
              '</div>' +
            '</div>' +
            '<div class="detail-block">' +
              '<div class="detail-label">Timestamps (UTC)</div>' +
              '<div class="detail-val">' +
                '<strong>Created:</strong> ' + createdTimeStr + '<br>' +
                '<strong>Updated:</strong> ' + timeStr +
              '</div>' +
            '</div>' +
          '</div>' +
          errHtml +
          '<div class="detail-block">' +
            '<div class="detail-label">Email Body Content</div>' +
            '<div class="detail-tabs-bar">' +
              '<button class="detail-tab active" id="' + prefix + 'tab-preview-' + log.id + '" onclick="switchDetailBodyTab(\'' + prefix + '\', ' + log.id + ', \'preview\')">Visual Preview</button>' +
              '<button class="detail-tab" id="' + prefix + 'tab-raw-' + log.id + '" onclick="switchDetailBodyTab(\'' + prefix + '\', ' + log.id + ', \'raw\')">Raw Content</button>' +
            '</div>' +
            '<div id="' + prefix + 'body-preview-' + log.id + '">' +
              '<iframe class="body-preview-iframe" srcdoc="' + escapeHtml(log.body) + '"></iframe>' +
            '</div>' +
            '<div id="' + prefix + 'body-raw-' + log.id + '" style="display:none;">' +
              '<div class="detail-val-mono">' + escapeHtml(log.body) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</td>';

    tbody.appendChild(detTr);
  }

  // ── Dashboard data (Last 10 emails) ──────────────────────────────────────
  async function fetchDashboardData(btn) {
    var key = getApiKey();
    if (!key) return false;

    if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
    try {
      var headers = { 'X-API-Key': key };

      var statsRes = await fetch('/api/status', { headers: headers });
      if (statsRes.status === 401) return false;
      var stats = await statsRes.json();
      document.getElementById('stats-queued').textContent  = stats.queued  || 0;
      document.getElementById('stats-sending').textContent = stats.sending || 0;
      document.getElementById('stats-sent').textContent    = stats.sent    || 0;
      document.getElementById('stats-failed').textContent  = stats.failed  || 0;

      // Limit to 10 logs on main dashboard
      var logsRes = await fetch('/api/logs?limit=10', { headers: headers });
      var data    = await logsRes.json();
      var logs    = data.results || [];
      var tbody   = document.getElementById('logs-body');

      if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No recent emails queued or sent.</td></tr>';
      } else {
        tbody.innerHTML = '';
        logs.forEach(function(log) {
          renderLogRow(tbody, log, 'dash-');
        });
      }
      return true;
    } catch(err) {
      console.error('Fetch dashboard error:', err); return false;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Refresh Queue'; }
    }
  }

  // ── Detailed Logs page state & data ──────────────────────────────────────
  var logsFilterStatus = '';
  var logsSortOrder    = 'updated_at_desc';
  var logsSearchQuery  = '';
  var logsPageOffset   = 0;
  var logsPageLimit    = 100;
  var searchTimeout    = null;

  function onLogFilterChange() {
    logsFilterStatus = document.getElementById('log-filter-status').value;
    logsSortOrder    = document.getElementById('log-filter-sort').value;
    logsPageOffset   = 0; 
    fetchDetailedLogsData();
  }

  function onLogSearchInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() {
      logsSearchQuery = document.getElementById('log-filter-search').value.trim();
      logsPageOffset   = 0; 
      fetchDetailedLogsData();
    }, 450);
  }

  function resetLogFilters() {
    document.getElementById('log-filter-status').value = '';
    document.getElementById('log-filter-sort').value = 'updated_at_desc';
    document.getElementById('log-filter-search').value = '';
    logsFilterStatus = '';
    logsSortOrder    = 'updated_at_desc';
    logsSearchQuery  = '';
    logsPageOffset   = 0;
    fetchDetailedLogsData();
  }

  function changeLogsPage(dir) {
    if (dir === -1) {
      logsPageOffset = Math.max(0, logsPageOffset - logsPageLimit);
    } else {
      logsPageOffset += logsPageLimit;
    }
    fetchDetailedLogsData();
  }

  async function fetchDetailedLogsData(btn) {
    var key = getApiKey();
    if (!key) return false;

    if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
    try {
      var headers = { 'X-API-Key': key };
      var url = '/api/logs?limit=' + logsPageLimit + '&offset=' + logsPageOffset;
      if (logsFilterStatus) url += '&status=' + encodeURIComponent(logsFilterStatus);
      if (logsSortOrder)    url += '&sort=' + encodeURIComponent(logsSortOrder);
      if (logsSearchQuery)  url += '&q=' + encodeURIComponent(logsSearchQuery);

      var res = await fetch(url, { headers: headers });
      var data = await res.json();
      var tbody = document.getElementById('detailed-logs-body');

      // Update pagination info
      var total = data.total || 0;
      var start = total === 0 ? 0 : logsPageOffset + 1;
      var end = Math.min(total, logsPageOffset + logsPageLimit);
      document.getElementById('logs-pagination-info').textContent = 
        'Showing ' + start + ' - ' + end + ' of ' + total + ' entries';

      // Update button disabled state
      document.getElementById('btn-prev-page').disabled = (logsPageOffset === 0);
      document.getElementById('btn-next-page').disabled = (logsPageOffset + logsPageLimit >= total);

      var results = data.results || [];
      if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No matching logs found.</td></tr>';
      } else {
        tbody.innerHTML = '';
        results.forEach(function(log) {
          renderLogRow(tbody, log, 'det-');
        });
      }
      return true;
    } catch(err) {
      console.error('Fetch detailed logs error:', err);
      return false;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sync Table'; }
    }
  }

  // ── Test email ───────────────────────────────────────────────────────────
  async function sendTestEmail(event) {
    event.preventDefault();
    var key    = getApiKey();
    var secret = getApiSecret();
    var mode   = getSecurityMode();
    if (!key) return;

    var toField      = document.getElementById('test-to').value.trim();
    var ccField      = document.getElementById('test-cc').value.trim();
    var bccField     = document.getElementById('test-bcc').value.trim();
    var subjectField = document.getElementById('test-subject').value.trim();
    var bodyField    = document.getElementById('test-body').value.trim();
    var submitBtn    = document.getElementById('send-test-btn');
    var resultDiv    = document.getElementById('test-result');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enqueuing…';
    resultDiv.style.display = 'none';

    var cc  = ccField  ? ccField.split(',').map(function(s){return s.trim();}).filter(Boolean)  : undefined;
    var bcc = bccField ? bccField.split(',').map(function(s){return s.trim();}).filter(Boolean) : undefined;
    var to;
    if (toField.startsWith('[') || toField.startsWith('{')) {
      try { to = JSON.parse(toField); } catch(_) { to = toField.split(',').map(function(s){return s.trim();}).filter(Boolean); }
    } else { to = toField.split(',').map(function(s){return s.trim();}).filter(Boolean); }

    var payload = { to: to, subject: subjectField, body: bodyField };
    if (cc)  payload.cc  = cc;
    if (bcc) payload.bcc = bcc;
    var rawBody = JSON.stringify(payload);

    try {
      var headers = { 'Content-Type': 'application/json' };

      if (mode === 'api-key-only') {
        headers['X-API-Key'] = key;
      } else {
        if (!secret) {
          resultDiv.style.display = 'block';
          resultDiv.style.color   = 'var(--color-red)';
          resultDiv.textContent   = 'API Secret is required for ' + mode + ' mode. Please re-authenticate.';
          submitBtn.disabled = false; submitBtn.textContent = 'Enqueue Test Email'; return;
        }
        var sigResult = await signRequest(secret, rawBody, mode);
        var authHeaders = buildAuthHeaders(mode, key, sigResult);
        Object.assign(headers, authHeaders);
      }

      var res  = await fetch('/api/send', { method: 'POST', headers: headers, body: rawBody });
      var data = await res.json();
      resultDiv.style.display = 'block';

      if (res.status === 200 || res.status === 202) {
        resultDiv.style.color   = 'var(--color-green)';
        resultDiv.textContent   = 'Success! Email queued (ID: ' + data.id + '). Background job started.';
        document.getElementById('test-subject').value = '';
        document.getElementById('test-body').value    = '';
        setTimeout(function(){ fetchDashboardData(); fetchDetailedLogsData(); }, 1000);
      } else {
        resultDiv.style.color = 'var(--color-red)';
        resultDiv.textContent = 'Error: ' + (data.reason || data.error || 'Unknown error');
      }
    } catch(err) {
      resultDiv.style.display = 'block';
      resultDiv.style.color   = 'var(--color-red)';
      resultDiv.textContent   = 'Network error: ' + err.message;
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Enqueue Test Email';
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  function switchView(view) {
    document.getElementById('view-dashboard').style.display = (view === 'dashboard') ? '' : 'none';
    document.getElementById('view-logs').style.display      = (view === 'logs') ? '' : 'none';
    document.getElementById('view-docs').style.display      = (view === 'docs') ? '' : 'none';
    
    document.querySelectorAll('.nav-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.view === view);
    });

    if (view === 'logs') {
      fetchDetailedLogsData();
    } else if (view === 'dashboard') {
      fetchDashboardData();
    }
  }

  // ── Docs page ────────────────────────────────────────────────────────────
  var currentDocsMode = 'full';
  var currentLang     = 'curl';

  var MODE_DESCS = {
    'api-key-only': 'Basic authentication via the X-API-Key header. Simplest to integrate but provides no protection against interception, body tampering, or replay attacks.',
    'signed':       'API key + HMAC-SHA256 signature + timestamp. Protects against body tampering and stale captured requests (clock window ±3 min). Does not prevent replay of a request within the window.',
    'full':         'Maximum security. Verifies API key, HMAC signature, timestamp (±3 min), and a unique per-request nonce stored in D1. Fully prevents tampering, replay attacks, and stale captures.'
  };
  var MODE_ICONS = { 'api-key-only': '🔑', 'signed': '🔐', 'full': '🛡️' };

  function setDocsMode(mode) {
    currentDocsMode = mode;

    // Mode pill active state
    document.querySelectorAll('.mode-pill').forEach(function(b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    // Mode description
    document.getElementById('mode-desc-text').textContent = MODE_DESCS[mode] || '';
    document.getElementById('mode-desc-box').firstChild.textContent = MODE_ICONS[mode] + ' ';

    // Show/hide header rows in reference table
    var needSig = (mode === 'signed' || mode === 'full');
    document.getElementById('hdr-timestamp').style.display = needSig ? '' : 'none';
    document.getElementById('hdr-nonce').style.display     = (mode === 'full') ? '' : 'none';
    document.getElementById('hdr-sig').style.display       = needSig ? '' : 'none';

    // Show/hide request anatomy lines
    document.getElementById('req-timestamp-line').style.display = needSig ? '' : 'none';
    document.getElementById('req-nonce-line').style.display      = (mode === 'full') ? '' : 'none';
    document.getElementById('req-sig-line').style.display        = needSig ? '' : 'none';

    // Show/hide signing guide
    document.getElementById('signing-guide-panel').style.display = needSig ? '' : 'none';
    var nonceStep = document.getElementById('sign-step-nonce');
    if (nonceStep) nonceStep.style.display = (mode === 'full') ? '' : 'none';

    // Renumber signing steps
    if (needSig) {
      var s3 = mode === 'full' ? 3 : 2;
      document.getElementById('sign-step3-num').textContent = s3;
      document.getElementById('sign-step4-num').textContent = s3 + 1;
      document.getElementById('sign-step5-num').textContent = s3 + 2;
    }

    // Canonical message display
    var msg = document.getElementById('sign-canonical-msg');
    if (msg) {
      if (mode === 'full') {
        msg.textContent = 'canonical_message =\\n  timestamp    + "\\n" +\\n  nonce        + "\\n" +\\n  body_hash';
      } else {
        msg.textContent = 'canonical_message =\\n  timestamp    + "\\n\\n" +\\n  body_hash  (empty nonce)';
      }
    }

    // Code examples
    document.querySelectorAll('.code-ex-wrap').forEach(function(el) {
      el.style.display = (el.dataset.mode === mode) ? '' : 'none';
    });
  }

  function setLang(lang) {
    currentLang = lang;
    document.querySelectorAll('.lang-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.lang === lang);
    });
    var panels = { curl: 'lang-curl', js: 'lang-js', python: 'lang-python' };
    Object.keys(panels).forEach(function(k) {
      document.getElementById(panels[k]).style.display = (k === lang) ? '' : 'none';
    });
  }

  function copyCodeExample() {
    var activeLang  = document.getElementById('lang-' + currentLang);
    var activeWrap  = activeLang ? activeLang.querySelector('.code-ex-wrap[data-mode="' + currentDocsMode + '"]') : null;
    var pre         = activeWrap ? activeWrap.querySelector('pre') : null;
    if (!pre) return;
    var btn = document.getElementById('copy-code-btn');
    navigator.clipboard.writeText(pre.textContent || '').then(function() {
      btn.textContent = 'Copied!'; btn.classList.add('copied');
      setTimeout(function(){ btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    });
  }

  // ── Quick reference panel ────────────────────────────────────────────────
  function updateQuickRef() {
    var mode = getSecurityMode();
    var modeLabels = { 'api-key-only': '🔑 API Key Only', 'signed': '🔐 Signed', 'full': '🛡️ Full' };
    var modeClass  = { 'api-key-only': 'mode-apikey', 'signed': 'mode-signed', 'full': 'mode-full' };
    var badge = document.getElementById('qr-mode-badge');
    if (badge) badge.innerHTML = '<span class="mode-indicator ' + (modeClass[mode] || 'mode-full') + '">' + (modeLabels[mode] || mode) + '</span>';
    var hdrs = document.getElementById('qr-headers');
    if (hdrs) {
      if (mode === 'api-key-only') hdrs.textContent = 'X-API-Key';
      else if (mode === 'signed')  hdrs.textContent = 'X-API-Key, X-Timestamp, X-Signature';
      else                         hdrs.textContent = 'X-API-Key, X-Timestamp, X-Nonce, X-Signature';
    }
  }

  // ── Clipboard util ───────────────────────────────────────────────────────
  function copyText(elementId) {
    var text = document.getElementById(elementId);
    if (!text) return;
    navigator.clipboard.writeText(text.textContent || '').then(function() {
      alert('Copied!');
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  // Update endpoint URLs in docs
  document.querySelectorAll('pre, code').forEach(function(el) {
    if (el.textContent && el.textContent.indexOf('YOUR_WORKER_URL') !== -1) {
      el.textContent = el.textContent.replace(/YOUR_WORKER_URL/g, window.location.origin);
    }
  });
  document.getElementById('qr-endpoint').textContent = window.location.origin + '/api/send';
  document.getElementById('docs-endpoint').textContent = window.location.origin + '/api/send';
  document.getElementById('req-path').textContent = window.location.origin + '/api/send';

  // Restore saved auth mode in overlay
  var savedMode = getSecurityMode();
  selectAuthMode(savedMode);
  if (savedMode !== 'api-key-only') {
    var secretInput = document.getElementById('dashboard-api-secret');
    if (secretInput && getApiSecret()) secretInput.value = getApiSecret();
  }

  // Init docs page to full mode
  setDocsMode('full');

  // Auto-refresh every 8 seconds
  setInterval(function() {
    if (getApiKey() && document.getElementById('view-dashboard').style.display !== 'none') {
      fetchDashboardData();
    }
  }, 8000);

  // Initial auth check
  checkAuth();
  updateQuickRef();
</script>
</body>
</html>`;
}
