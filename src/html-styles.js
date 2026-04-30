// Sobha-branded styling shared by compare HTML and audit-delta HTML.
// Vanilla-HTML compatible (no Tabulator). Bronze + dark-brown palette,
// Dubai/Inter typography. Matches Sobha document branding.

const SOBHA_STYLE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Dubai:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{
    --bg:          #F6F1E9;
    --surface:     #FFFFFF;
    --surface-2:   #FBF5EA;
    --border:      #E3D9C8;
    --border-2:    #C8B896;
    --ink:         #1F1A14;
    --ink-2:       #5A4A37;
    --muted:       #8A7E69;
    --accent:      #85633B;
    --accent-dark: #5C3D1E;
    --accent-soft: #F0E4CE;
    --ok:   #2E6B3A; --ok-bg:   #DCEDC8;
    --up:   #1E6B34; --up-bg:   #C5E1A5;
    --down: #A12C1B; --down-bg: #F3C8BD;
    --warn: #8A5A08; --warn-bg: #F5D78E;
    --dld:  #1E4E7A; --dld-bg:  #BFD4E8;
    --sf:   #5A2B82; --sf-bg:   #D6BFE4;
    --shadow-1: 0 1px 2px rgba(28,20,10,.04), 0 2px 8px rgba(28,20,10,.04);
    --shadow-2: 0 4px 14px rgba(28,20,10,.10);
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--ink)}
  body{font:13px/1.5 'Dubai','Inter','Segoe UI',Arial,sans-serif}

  /* ── Top brand bar ───────────────────────────────────────────────────── */
  .topbar{display:flex;align-items:center;gap:14px;padding:10px 22px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:50;box-shadow:var(--shadow-1)}
  .topbar .logo{font:700 10.5pt/1 'Inter',sans-serif;letter-spacing:3px;text-transform:uppercase;color:var(--accent);white-space:nowrap}
  .topbar .dept{font-size:10.5px;color:var(--muted);letter-spacing:1px;text-transform:uppercase}
  .topbar .spacer{flex:1}
  .topbar .stamp{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}

  /* ── Page container ──────────────────────────────────────────────────── */
  .page{max-width:100%;padding:16px 22px 24px}
  .title-row{display:flex;align-items:baseline;gap:14px;margin-bottom:4px;flex-wrap:wrap}
  .title-row h1{margin:0;font:700 22px/1.2 'Dubai','Inter',sans-serif;color:var(--ink)}
  .meta{color:var(--ink-2);font-size:13px;font-weight:500;margin-bottom:14px}
  .meta b{color:var(--accent-dark);font-weight:700}
  .meta .sep{color:var(--border-2);margin:0 6px}

  /* ── Toolbar (search + filter chips) ─────────────────────────────────── */
  .controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 14px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:var(--shadow-1)}
  .search{flex:1 1 320px;min-width:260px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px 12px 8px 34px;font:inherit;font-size:13px;color:var(--ink);outline:none;transition:border-color .15s,box-shadow .15s;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23898170' stroke-width='2'><circle cx='11' cy='11' r='7'/><path d='m21 21-4.35-4.35'/></svg>");background-repeat:no-repeat;background-position:10px center}
  .search:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(133,99,59,.14)}

  .chip{padding:6px 12px;border-radius:3px;font:700 11px/1.2 'Inter',sans-serif;letter-spacing:.4px;text-transform:uppercase;cursor:pointer;border:1px solid transparent;transition:filter .15s,opacity .15s;user-select:none}
  .chip:hover{filter:brightness(.96)}
  .chip.off{opacity:.42;filter:grayscale(.5)}
  .chip.ok   {background:var(--ok-bg);   color:var(--ok);   border-color:#B8DC9D}
  .chip.up   {background:var(--up-bg);   color:var(--up);   border-color:#A9CF82}
  .chip.down {background:var(--down-bg); color:var(--down); border-color:#E8AC9C}
  .chip.warn {background:var(--warn-bg); color:var(--warn); border-color:#E9C26F}
  .chip.dld  {background:var(--dld-bg);  color:var(--dld);  border-color:#9DB9D2}
  .chip.sf   {background:var(--sf-bg);   color:var(--sf);   border-color:#B79DCD}
  .chip.flat {background:#ECE4D6;        color:#666;        border-color:#D5CCBA}

  .btn-reset{background:var(--surface);color:var(--ink-2);border:1px solid var(--border);padding:7px 12px;border-radius:4px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
  .btn-reset:hover{background:var(--surface-2);border-color:var(--border-2);color:var(--accent-dark)}
  .count{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}
  .count b{color:var(--ink);font-weight:700}

  /* ── Table card ──────────────────────────────────────────────────────── */
  .table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:6px;overflow:hidden;box-shadow:var(--shadow-1)}
  .table-scroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:1400px}
  thead th{background:var(--accent);color:#fff;font:700 11px/1.2 'Inter',sans-serif;letter-spacing:.5px;text-transform:uppercase;text-align:left;padding:9px 10px;border-right:1px solid rgba(255,255,255,.18);border-bottom:2px solid var(--accent-dark);position:sticky;top:0;cursor:pointer;user-select:none;white-space:nowrap}
  thead th:hover{background:var(--accent-dark)}
  thead th[data-align="num"]{text-align:right}
  thead th.sort-asc::after {content:"  ↑";color:#fff;opacity:.75}
  thead th.sort-desc::after{content:"  ↓";color:#fff;opacity:.75}
  tbody td{padding:7px 10px;border-bottom:1px solid #EEE5D0;border-right:1px solid #F1E8D6;vertical-align:top;white-space:nowrap;color:var(--ink);font-weight:500}
  tbody td.num{text-align:right;font-variant-numeric:tabular-nums}
  tbody td.up  {color:var(--up);  font-weight:700}
  tbody td.down{color:var(--down);font-weight:700}
  tbody td.flat{color:var(--muted)}
  tbody td.warn-days{color:var(--warn);font-weight:700}
  tbody tr:nth-child(even) td{background:var(--surface-2)}
  tbody tr.ok   td{background:var(--ok-bg)  !important}
  tbody tr.up   td{background:var(--up-bg)  !important}
  tbody tr.down td{background:var(--down-bg)!important}
  tbody tr.warn td{background:var(--warn-bg)!important}
  tbody tr.dld  td{background:var(--dld-bg) !important}
  tbody tr.sf   td{background:var(--sf-bg)  !important}
  tbody tr:hover td{background:#FFEFC9 !important}
  tbody tr.hidden{display:none}

  /* ── Status badges ───────────────────────────────────────────────────── */
  .badge{display:inline-block;padding:2px 8px;border-radius:3px;font:700 10px/1.4 'Inter',sans-serif;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap}
  .badge.ok   {background:var(--ok-bg);   color:var(--ok)}
  .badge.up   {background:var(--up-bg);   color:var(--up)}
  .badge.down {background:var(--down-bg); color:var(--down)}
  .badge.warn {background:var(--warn-bg); color:var(--warn)}
  .badge.dld  {background:var(--dld-bg);  color:var(--dld)}
  .badge.sf   {background:var(--sf-bg);   color:var(--sf)}
  .badge.flat {background:#ECE4D6;        color:#666}

  /* ── Audit-flag pills (✓ / ✗ / —) ────────────────────────────────────── */
  .flag-ok  {color:var(--ok);  font-weight:700}
  .flag-no  {color:var(--down);font-weight:700}
  .flag-blank{color:var(--muted)}

  footer{margin-top:14px;color:var(--muted);font-size:11px;text-align:right;padding:0 4px}
  footer .sig{color:var(--accent-dark);font-weight:700;margin-left:8px}
`;

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(v) {
  if (v == null || v === '') return '';
  return Math.round(+v).toLocaleString();
}

function fmtSqm(v) {
  if (v == null || v === '') return '';
  const n = +v;
  if (!isFinite(n)) return '';
  // 2 decimals; trim trailing zeros for cleaner display
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function fmtPct(v) {
  if (v == null) return '';
  const sign = v > 0 ? '+' : '';
  return sign + (+v).toFixed(2) + '%';
}

function brandBar(rightStamp) {
  return `<div class="topbar">
  <span class="logo">SOBHA REALTY</span>
  <span class="dept">Registration / DLD</span>
  <span class="spacer"></span>
  <span class="stamp">${escHtml(rightStamp || '')}</span>
</div>`;
}

module.exports = { SOBHA_STYLE_CSS, escHtml, fmtMoney, fmtSqm, fmtPct, brandBar };
