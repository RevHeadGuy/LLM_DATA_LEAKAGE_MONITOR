'use strict';

const { mergeSettings } = window.LdlmDetection;

// ─── Storage helpers ──────────────────────────────────────────────────────────
function getStorage(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function setStorage(obj)  { return new Promise(r => chrome.storage.local.set(obj, r)); }

// Escape stored values before interpolating them into innerHTML. Event fields
// (domain, category, source) are controlled, but this is defense-in-depth so a
// crafted hostname in storage can never inject markup.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const navButtons = document.querySelectorAll('nav button[data-page]');
const pages      = document.querySelectorAll('.page');

navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.page;
    navButtons.forEach(b => b.classList.toggle('active', b === btn));
    pages.forEach(p => p.classList.toggle('active', p.id === `page-${target}`));
    if (target === 'events')   renderEventTable();
    if (target === 'settings') loadSettings();
  });
});

// ─── Last-updated timestamp ───────────────────────────────────────────────────
function updateTimestamp() {
  const el = document.getElementById('lastUpdated');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateTimestamp, 30000);
updateTimestamp();

// ─── Model status (settings card only) ───────────────────────────────────────
async function refreshModelBadge() {
  const { llmModelStatus } = await getStorage(['llmModelStatus']);
  const state = llmModelStatus || 'loading';
  const infoBert = document.getElementById('infoBert');
  if (infoBert) {
    infoBert.className = `info-val ${state === 'ready' ? 'good' : state === 'error' ? 'bad' : 'loading'}`;
    infoBert.textContent = state === 'ready' ? 'Loaded \u2713' : state === 'error' ? 'Failed \u2717' : 'Loading\u2026';
  }
}
const modelPollTimer = setInterval(async () => {
  const { llmModelStatus } = await getStorage(['llmModelStatus']);
  if (llmModelStatus === 'ready' || llmModelStatus === 'error') clearInterval(modelPollTimer);
  refreshModelBadge();
}, 3000);
refreshModelBadge();

// ─── Quick sidebar toggle ─────────────────────────────────────────────────────
const quickToggle = document.getElementById('quickToggle');
(async () => {
  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  const mode = llmLeakageSettings?.mode || 'block';
  quickToggle.checked = mode !== 'off';
})();
quickToggle?.addEventListener('change', async () => {
  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  const current = mergeSettings(llmLeakageSettings);
  const newMode = quickToggle.checked ? (current.mode === 'off' ? 'block' : current.mode) : 'off';
  await setStorage({ llmLeakageSettings: mergeSettings({ ...current, mode: newMode }) });
});

// ─── Data ─────────────────────────────────────────────────────────────────────
async function loadEvents() {
  const { llmBlockedEvents } = await getStorage(['llmBlockedEvents']);
  return Array.isArray(llmBlockedEvents) ? llmBlockedEvents : [];
}

// ─── Counter animation ────────────────────────────────────────────────────────
function animateCount(el, target) {
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const dur = 600, fps = 30, steps = Math.ceil(dur / (1000 / fps));
  let step = 0;
  const timer = setInterval(() => {
    step++;
    const val = Math.round(start + (target - start) * (step / steps));
    el.textContent = val;
    if (step >= steps) { el.textContent = target; clearInterval(timer); }
  }, 1000 / fps);
}

// ─── Time-ago helper ──────────────────────────────────────────────────────────
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400)return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// ─── Sparkline renderer ───────────────────────────────────────────────────────
function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr  = window.devicePixelRatio || 1;
  const W    = canvas.offsetWidth  || 64;
  const H    = canvas.offsetHeight || 28;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const max = Math.max(...data, 1);
  const step = W / (data.length - 1);

  const pts = data.map((v, i) => ({ x: i * step, y: H - (v / max) * (H - 4) - 2 }));

  // fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color.replace(')', ',0.3)').replace('rgb', 'rgba'));
  grad.addColorStop(1, color.replace(')', ',0)').replace('rgb', 'rgba'));

  ctx.beginPath();
  ctx.moveTo(pts[0].x, H);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length-1].x, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const cpx = (pts[i].x + pts[i+1].x) / 2;
    ctx.bezierCurveTo(cpx, pts[i].y, cpx, pts[i+1].y, pts[i+1].x, pts[i+1].y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'round';
  ctx.stroke();
}

// ─── Stats + sparklines ───────────────────────────────────────────────────────
async function renderStats() {
  const events = await loadEvents();
  const now    = Date.now();
  const hour   = 3600000;
  const day    = 86400000;

  const blocked = events.filter(e => e.action === 'Blocked');
  const warned  = events.filter(e => e.action === 'Warning');
  const today   = events.filter(e => now - e.time < day);
  const sites   = new Set(events.map(e => e.domain)).size;
  const bert    = events.filter(e => e.detectionMethod === 'bert');

  // Top category
  const catCounts = {};
  events.forEach(e => { const k = e.category || 'Unknown'; catCounts[k] = (catCounts[k] || 0) + 1; });
  const topCat = Object.entries(catCounts).sort((a,b) => b[1]-a[1])[0];

  // Animate counters
  animateCount(document.getElementById('statBlocked'), blocked.length);
  animateCount(document.getElementById('statWarned'),  warned.length);
  animateCount(document.getElementById('statToday'),   today.length);
  animateCount(document.getElementById('statSites'),   sites);
  animateCount(document.getElementById('statBert'),    bert.length);

  document.getElementById('statTopCat').textContent      = topCat ? topCat[0] : '—';
  document.getElementById('statTopCatCount').textContent = topCat ? `${topCat[1]} detection${topCat[1]!==1?'s':''}` : '';

  // Last detection timestamps
  const lb = blocked[0];
  const lw = warned[0];
  const lbEl = document.getElementById('lastBlocked');
  const lwEl = document.getElementById('lastWarned');
  if (lbEl) lbEl.textContent = lb ? `Last: ${timeAgo(lb.time)}` : '';
  if (lwEl) lwEl.textContent = lw ? `Last: ${timeAgo(lw.time)}` : '';

  // Nav badge
  const nb = document.getElementById('navEventCount');
  if (nb) nb.textContent = events.length;

  // Sparklines — 7 daily buckets
  function dailyBuckets(filter) {
    return Array.from({ length: 7 }, (_, i) => {
      const start = now - (6 - i) * day;
      const end   = start + day;
      return filter(events.filter(e => e.time >= start && e.time < end));
    });
  }
  drawSparkline('spark-blocked', dailyBuckets(ev => ev.filter(e=>e.action==='Blocked').length), '#f43f5e');
  drawSparkline('spark-warned',  dailyBuckets(ev => ev.filter(e=>e.action==='Warning').length), '#f59e0b');
  drawSparkline('spark-today',   Array.from({length:7},(_,i)=>{
    const h=now-(6-i)*hour; return events.filter(e=>e.time>=h&&e.time<h+hour).length;
  }), '#06b6d4');
  drawSparkline('spark-sites',   dailyBuckets(ev => new Set(ev.map(e=>e.domain)).size), '#10b981');
  drawSparkline('spark-bert',    dailyBuckets(ev => ev.filter(e=>e.detectionMethod==='bert').length), '#8b5cf6');
}

// ─── Timeline canvas ──────────────────────────────────────────────────────────
async function renderTimeline() {
  const canvas = document.getElementById('timelineCanvas');
  if (!canvas) return;
  const events = await loadEvents();
  const now = Date.now(), hour = 3600000, HOURS = 24;

  const blocked = new Array(HOURS).fill(0);
  const warned  = new Array(HOURS).fill(0);
  events.forEach(e => {
    const age = now - e.time;
    if (age > HOURS * hour) return;
    const b = HOURS - 1 - Math.floor(age / hour);
    if (e.action === 'Blocked') blocked[b]++; else warned[b]++;
  });

  const maxVal = Math.max(...blocked.map((v,i) => v + warned[i]), 1);
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const W = rect.width, H = rect.height;
  const PL=30, PR=12, PT=8, PB=24;
  const plotW = W-PL-PR, plotH = H-PT-PB, step = plotW/(HOURS-1);

  ctx.clearRect(0,0,W,H);

  // grid
  for (let i=0;i<=4;i++) {
    const y = PT + plotH - (i/4)*plotH;
    ctx.beginPath(); ctx.moveTo(PL,y); ctx.lineTo(W-PR,y);
    ctx.strokeStyle = i===0 ? 'rgba(99,120,200,0.12)' : 'rgba(99,120,200,0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash(i===0?[]:[3,4]);
    ctx.stroke(); ctx.setLineDash([]);
    if (i>0) {
      ctx.fillStyle='rgba(100,116,139,0.65)';
      ctx.font='9px Inter,system-ui';
      ctx.fillText(Math.round((i/4)*maxVal), 2, y+3);
    }
  }

  const series = [
    { data: warned,  fill:'rgba(245,158,11,0.15)', stroke:'#f59e0b' },
    { data: blocked, fill:'rgba(244,63,94,0.18)',  stroke:'#f43f5e' },
  ];

  series.forEach(({ data, fill, stroke }) => {
    const pts = data.map((v,i) => ({ x: PL+i*step, y: PT+plotH-(v/maxVal)*plotH }));

    function smooth(p) {
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
      for (let i=0;i<p.length-1;i++) {
        const cx=(p[i].x+p[i+1].x)/2;
        ctx.bezierCurveTo(cx,p[i].y,cx,p[i+1].y,p[i+1].x,p[i+1].y);
      }
    }

    const grad = ctx.createLinearGradient(0,PT,0,PT+plotH);
    grad.addColorStop(0, fill.replace(/[\d.]+\)$/, '0.45)'));
    grad.addColorStop(1, fill.replace(/[\d.]+\)$/, '0.01)'));

    smooth(pts);
    ctx.lineTo(pts[pts.length-1].x, PT+plotH);
    ctx.lineTo(pts[0].x, PT+plotH);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    smooth(pts);
    ctx.strokeStyle=stroke; ctx.lineWidth=2.5;
    ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();

    pts.forEach((p,i) => {
      if (!data[i]) return;
      ctx.beginPath(); ctx.arc(p.x,p.y,3.5,0,Math.PI*2);
      ctx.fillStyle=stroke; ctx.fill();
      ctx.strokeStyle='#060810'; ctx.lineWidth=1.5; ctx.stroke();
    });
  });

  ctx.fillStyle='rgba(100,116,139,0.65)'; ctx.font='9px Inter,system-ui';
  for (let i=0;i<HOURS;i+=4) {
    const x=PL+i*step;
    const lbl=new Date(now-(HOURS-1-i)*hour).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    ctx.fillText(lbl, x-14, H-4);
  }
}

// ─── Category bar ─────────────────────────────────────────────────────────────
async function renderCategoryChart() {
  const el = document.getElementById('categoryBarChart');
  if (!el) return;
  const events = await loadEvents();
  const counts = {};
  events.forEach(e => { const k=e.category||'Unknown'; counts[k]=(counts[k]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if (!sorted.length) { el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:14px 0;text-align:center">No detections yet</div>'; return; }
  const max = sorted[0][1];
  el.innerHTML = sorted.map(([label,count]) =>
    `<div class="bar-row">
      <span class="bar-label" title="${esc(label)}">${esc(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(count/max*100).toFixed(1)}%"></div></div>
      <span class="bar-n">${count}</span>
    </div>`).join('');
}

// ─── Domain bar ───────────────────────────────────────────────────────────────
async function renderDomainChart() {
  const el = document.getElementById('domainBarChart');
  if (!el) return;
  const events = await loadEvents();
  const counts = {};
  events.forEach(e => { const k=e.domain||'unknown'; counts[k]=(counts[k]||0)+1; });
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if (!sorted.length) { el.innerHTML='<div style="color:var(--muted);font-size:13px;padding:14px 0;text-align:center">No detections yet</div>'; return; }
  const max = sorted[0][1];
  el.innerHTML = sorted.map(([domain,count]) =>
    `<div class="bar-row">
      <span class="bar-label" title="${esc(domain)}">${esc(domain)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(count/max*100).toFixed(1)}%;background:linear-gradient(90deg,#8b5cf6,#6366f1)"></div></div>
      <span class="bar-n">${count}</span>
    </div>`).join('');
}

// ─── Method donut ─────────────────────────────────────────────────────────────
async function renderMethodDonut() {
  const events = await loadEvents();
  const total  = events.length;
  const rN = events.filter(e=>e.detectionMethod==='regex').length;
  const bN = events.filter(e=>e.detectionMethod==='bert').length;
  const oN = total - rN - bN;

  const donut  = document.getElementById('methodDonut');
  const legend = document.getElementById('methodLegend');
  document.getElementById('donutTotal').textContent = total;

  if (!total) {
    donut.style.background = 'var(--surface2)';
    legend.innerHTML = '<div style="color:var(--muted);font-size:12px">No data yet</div>';
    return;
  }

  const rP = (rN/total*100).toFixed(1);
  const bP = (bN/total*100).toFixed(1);
  donut.style.background =
    `conic-gradient(#6366f1 0% ${rP}%, #8b5cf6 ${rP}% ${(+rP+ +bP).toFixed(1)}%, #1e2640 ${(+rP+ +bP).toFixed(1)}% 100%)`;

  const rows = [
    { color:'#6366f1', label:'Regex',    count:rN, pct:rP },
    { color:'#8b5cf6', label:'BERT NER', count:bN, pct:bP },
    { color:'#1e2640', label:'Other',    count:oN, pct:(oN/total*100).toFixed(1) },
  ].filter(r=>r.count>0);

  legend.innerHTML = rows.map(r =>
    `<div class="dl-row">
      <div class="dl-dot" style="background:${r.color}"></div>
      <span class="dl-name">${r.label}</span>
      <span class="dl-count">${r.count} (${r.pct}%)</span>
    </div>`).join('');
}

// ─── Event table ──────────────────────────────────────────────────────────────
let allEvents = [];

async function renderEventTable() {
  allEvents = await loadEvents();
  const catFilter = document.getElementById('filterCategory');
  const cats = [...new Set(allEvents.map(e=>e.category||'Unknown'))].sort();
  const prev = catFilter.value;
  catFilter.innerHTML = '<option value="">All categories</option>' +
    cats.map(c=>`<option value="${esc(c)}"${c===prev?' selected':''}>${esc(c)}</option>`).join('');
  applyFilters();
}

function applyFilters() {
  const action   = document.getElementById('filterAction').value;
  const method   = document.getElementById('filterMethod').value;
  const category = document.getElementById('filterCategory').value;
  const domain   = document.getElementById('filterDomain').value.toLowerCase().trim();

  const filtered = allEvents.filter(e => {
    if (action   && e.action !== action) return false;
    if (method   && e.detectionMethod !== method) return false;
    if (category && (e.category||'Unknown') !== category) return false;
    if (domain   && !(e.domain||'').toLowerCase().includes(domain)) return false;
    return true;
  });

  const tbody = document.getElementById('eventTableBody');
  const empty = document.getElementById('eventEmptyState');

  if (!filtered.length) { tbody.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';

  tbody.innerHTML = filtered.map((e, idx) => {
    const t = new Date(e.time||Date.now());
    const timeStr = t.toLocaleDateString([],{month:'short',day:'numeric'}) + ' ' +
                    t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const rowClass = e.action==='Blocked' ? 'row-blocked'
      : e.action==='Redacted' ? 'row-redacted'
      : e.action==='Overridden' ? 'row-overridden' : 'row-warned';
    const actionBadge = e.action==='Blocked'
      ? `<span class="badge blocked">🚫 Blocked</span>`
      : e.action==='Redacted'
        ? `<span class="badge redacted">✂ Redacted</span>`
        : e.action==='Overridden'
          ? `<span class="badge overridden">↪ Overridden</span>`
          : `<span class="badge warning">⚠ Warning</span>`;
    const methodBadge = e.detectionMethod==='bert'
      ? `<span class="badge bert">BERT</span>`
      : `<span class="badge regex">Regex</span>`;
    const previewCell = e.preview
      ? `<code class="match-preview">${esc(e.preview)}</code>`
      : '<span style="color:var(--muted)">—</span>';

    return `<tr class="${rowClass}" data-idx="${idx}">
      <td style="color:var(--muted);white-space:nowrap;font-size:12px">${esc(timeStr)}</td>
      <td>${actionBadge}</td>
      <td><span class="badge category">${esc(e.category||'Unknown')}</span></td>
      <td>${previewCell}</td>
      <td>${methodBadge}</td>
      <td style="font-size:12px">${esc(e.domain||'—')}</td>
      <td style="color:var(--muted);font-size:12px">${esc(e.source||'—')}</td>
    </tr>
    <tr class="row-detail" id="detail-${idx}">
      <td colspan="7">
        <div class="row-detail-grid">
          <div class="row-detail-item"><strong>Full Timestamp</strong>${esc(new Date(e.time||Date.now()).toLocaleString())}</div>
          <div class="row-detail-item"><strong>Detection Method</strong>${esc(e.detectionMethod||'regex')}</div>
          <div class="row-detail-item"><strong>Category</strong>${esc(e.category||'Unknown')}</div>
          <div class="row-detail-item"><strong>Matched (masked)</strong>${e.preview ? `<code class="match-preview">${esc(e.preview)}</code>` : '—'}</div>
          <div class="row-detail-item"><strong>Domain</strong>${esc(e.domain||'—')}</div>
          <div class="row-detail-item"><strong>Source</strong>${esc(e.source||'—')}</div>
          <div class="row-detail-item"><strong>Action</strong>${esc(e.action||'—')}</div>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Row expand on click
  tbody.querySelectorAll('tr[data-idx]').forEach(row => {
    row.addEventListener('click', () => {
      const idx = row.dataset.idx;
      const detail = document.getElementById(`detail-${idx}`);
      if (detail) detail.classList.toggle('open');
    });
  });
}

['filterAction','filterMethod','filterCategory','filterDomain'].forEach(id =>
  document.getElementById(id)?.addEventListener('input', applyFilters)
);

// Clear
document.getElementById('clearBtn')?.addEventListener('click', async () => {
  if (!confirm('Clear all event history? This cannot be undone.')) return;
  await setStorage({ llmBlockedEvents: [] });
  allEvents = [];
  applyFilters();
  renderOverview();
});

// Export with feedback
document.getElementById('exportBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('exportBtn');
  const events = await loadEvents();
  if (!events.length) { alert('No events to export.'); return; }

  btn.textContent = 'Exporting…';
  btn.classList.add('exporting');

  const header = ['Time','Action','Category','Match','Method','Domain','Source'];
  const rows = events.map(e => {
    return [new Date(e.time||Date.now()).toISOString(), e.action,
      e.category||'Unknown', e.preview||'', e.detectionMethod||'regex', e.domain||'', e.source||'']
      .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
  });

  const csv  = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `llm-monitor-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);

  btn.textContent = 'Done \u2713';
  btn.classList.remove('exporting');
  btn.classList.add('done');
  setTimeout(() => { btn.textContent = '\u2b07 Export CSV'; btn.classList.remove('done'); }, 2500);
});

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const { llmLeakageSettings, llmBlockedEvents, llmModelStatus } =
    await getStorage(['llmLeakageSettings','llmBlockedEvents','llmModelStatus']);
  const settings = mergeSettings(llmLeakageSettings);
  const events   = Array.isArray(llmBlockedEvents) ? llmBlockedEvents : [];

  document.getElementById('modeSelect').value     = settings.mode || 'block';
  const scopeSelect = document.getElementById('scopeSelect');
  if (scopeSelect) scopeSelect.value = settings.scope || 'llm';
  document.getElementById('allowlistInput').value = (settings.allowlist||[]).join('\n');

  const policyMap = {
    policySecrets: 'secrets',
    policyIdentity: 'identity',
    policyTokens: 'tokens',
    policyContact: 'contact',
    policyPersonal: 'personal',
    policyNer: 'ner',
    policySecrets2: 'secrets2',
    policyCustom: 'custom'
  };
  Object.entries(policyMap).forEach(([id, group]) => {
    const el = document.getElementById(id);
    if (el) el.value = settings.categoryActions[group] || 'warn';
  });

  renderRuleList(settings.customRules || []);

  const modeLabels = { block:'Block', redact:'Redact', warn:'Warn only', off:'Off' };
  document.getElementById('infoMode').textContent      = modeLabels[settings.mode]||settings.mode;
  const infoScope = document.getElementById('infoScope');
  if (infoScope) infoScope.textContent = settings.scope === 'all' ? 'All sites' : 'LLM sites only';
  document.getElementById('infoAllowlist').textContent = (settings.allowlist||[]).length || 'None';
  const infoRules = document.getElementById('infoRules');
  if (infoRules) infoRules.textContent = (settings.customRules||[]).length || 'None';
  document.getElementById('infoEvents').textContent    = events.length;

  const infoBert = document.getElementById('infoBert');
  if (infoBert) {
    const state = llmModelStatus || 'loading';
    infoBert.className   = `info-val ${state==='ready'?'good':state==='error'?'bad':'loading'}`;
    infoBert.textContent = state==='ready' ? 'Loaded \u2713' : state==='error' ? 'Failed \u2717' : 'Loading\u2026';
  }
}

// "All sites" scope requires the <all_urls> optional host permission. Request
// it (user gesture = the save click) when turning it on, drop it when off.
function ensureScopePermission(scope) {
  return new Promise((resolve) => {
    if (scope === 'all') {
      chrome.permissions.request({ origins: ['<all_urls>'] }, (granted) => resolve(granted));
    } else {
      chrome.permissions.remove({ origins: ['<all_urls>'] }, () => resolve(true));
    }
  });
}

document.getElementById('saveSettingsBtn')?.addEventListener('click', async () => {
  const mode = document.getElementById('modeSelect').value;
  let scope = document.getElementById('scopeSelect')?.value || 'llm';

  if (scope === 'all') {
    const granted = await ensureScopePermission('all');
    if (!granted) {
      // Permission denied — fall back to LLM-only so the setting stays honest.
      scope = 'llm';
      const scopeSelect = document.getElementById('scopeSelect');
      if (scopeSelect) scopeSelect.value = 'llm';
    }
  } else {
    await ensureScopePermission('llm');
  }

  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  await setStorage({ llmLeakageSettings: mergeSettings({ ...(llmLeakageSettings||{}), mode, scope }) });
  const s = document.getElementById('saveStatus');
  s.classList.add('show'); setTimeout(()=>s.classList.remove('show'),2000);
  loadSettings();
  if (quickToggle) quickToggle.checked = mode !== 'off';
});

document.getElementById('savePolicyBtn')?.addEventListener('click', async () => {
  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  const categoryActions = {
    secrets: document.getElementById('policySecrets').value,
    identity: document.getElementById('policyIdentity').value,
    tokens: document.getElementById('policyTokens').value,
    contact: document.getElementById('policyContact').value,
    personal: document.getElementById('policyPersonal').value,
    ner: document.getElementById('policyNer').value,
    secrets2: document.getElementById('policySecrets2').value,
    custom: document.getElementById('policyCustom').value
  };
  await setStorage({ llmLeakageSettings: mergeSettings({ ...(llmLeakageSettings||{}), categoryActions }) });
  const s = document.getElementById('savePolicyStatus');
  s.classList.add('show'); setTimeout(()=>s.classList.remove('show'),2000);
  loadSettings();
});

document.getElementById('saveAllowlistBtn')?.addEventListener('click', async () => {
  const raw = document.getElementById('allowlistInput').value || '';
  const allowlist = raw.split(/[\n,]+/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  await setStorage({ llmLeakageSettings: mergeSettings({ ...(llmLeakageSettings||{}), allowlist }) });
  const s = document.getElementById('saveAllowlistStatus');
  s.classList.add('show'); setTimeout(()=>s.classList.remove('show'),2000);
  loadSettings();
});

// ─── Custom rules ─────────────────────────────────────────────────────────────
function renderRuleList(rules) {
  const el = document.getElementById('ruleList');
  if (!el) return;
  if (!rules.length) {
    el.innerHTML = '<div class="rule-empty">No custom rules yet. Add one above.</div>';
    return;
  }
  el.innerHTML = rules.map((r, i) =>
    `<div class="rule-item">
      <span class="ri-name">${esc(r.name)}</span>
      <span class="ri-type">${esc(r.type)}</span>
      <span class="ri-pattern" title="${esc(r.pattern)}">${esc(r.pattern)}</span>
      <button class="ri-del" data-idx="${i}" type="button">Delete</button>
    </div>`).join('');

  el.querySelectorAll('.ri-del').forEach(btn => {
    btn.addEventListener('click', () => deleteRule(Number(btn.dataset.idx)));
  });
}

function showRuleError(msg) {
  const el = document.getElementById('ruleError');
  if (el) el.textContent = msg || '';
}

function flashRuleSaved() {
  const s = document.getElementById('saveRuleStatus');
  if (s) { s.classList.add('show'); setTimeout(() => s.classList.remove('show'), 2000); }
}

document.getElementById('addRuleBtn')?.addEventListener('click', async () => {
  showRuleError('');
  const name = document.getElementById('ruleName').value.trim();
  const type = document.getElementById('ruleType').value === 'keyword' ? 'keyword' : 'regex';
  const pattern = document.getElementById('rulePattern').value.trim();

  if (!pattern) { showRuleError('Pattern is required.'); return; }
  if (type === 'regex') {
    try {
      new RegExp(pattern);
    } catch (err) {
      showRuleError('Invalid regular expression: ' + err.message);
      return;
    }
  }

  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  const current = mergeSettings(llmLeakageSettings);
  const next = [...(current.customRules || []), { name: name || 'Custom Rule', type, pattern }];
  await setStorage({ llmLeakageSettings: mergeSettings({ ...current, customRules: next }) });

  document.getElementById('ruleName').value = '';
  document.getElementById('rulePattern').value = '';
  flashRuleSaved();
  loadSettings();
});

async function deleteRule(idx) {
  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  const current = mergeSettings(llmLeakageSettings);
  const next = (current.customRules || []).filter((_, i) => i !== idx);
  await setStorage({ llmLeakageSettings: mergeSettings({ ...current, customRules: next }) });
  flashRuleSaved();
  loadSettings();
}

// ─── Settings backup / restore ─────────────────────────────────────────────────
document.getElementById('exportSettingsBtn')?.addEventListener('click', async () => {
  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  const settings = mergeSettings(llmLeakageSettings);
  const payload = {
    type: 'llm-data-leakage-monitor-settings',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      mode: settings.mode,
      scope: settings.scope,
      allowlist: settings.allowlist,
      categoryActions: settings.categoryActions,
      customRules: settings.customRules
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `llm-monitor-settings-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

function showImportError(msg) {
  const el = document.getElementById('importError');
  if (el) el.textContent = msg || '';
}

document.getElementById('importSettingsBtn')?.addEventListener('click', () => {
  showImportError('');
  document.getElementById('importSettingsFile')?.click();
});

document.getElementById('importSettingsFile')?.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || ''));
      // Accept either the wrapped export shape or a bare settings object.
      const raw = parsed && parsed.settings ? parsed.settings : parsed;
      if (!raw || typeof raw !== 'object') throw new Error('Unrecognized file format.');

      // mergeSettings validates and sanitizes everything (drops bad rules,
      // normalizes mode/scope), so an untrusted file can't inject bad state.
      const clean = mergeSettings(raw);

      if (!confirm('Import this configuration? It will replace your current mode, policies, allowlist, and custom rules.')) {
        return;
      }

      // "All sites" scope needs the broad permission; if we can't get it, keep LLM-only.
      if (clean.scope === 'all') {
        const granted = await ensureScopePermission('all');
        if (!granted) clean.scope = 'llm';
      } else {
        await ensureScopePermission('llm');
      }

      await setStorage({ llmLeakageSettings: clean });
      const s = document.getElementById('importStatus');
      if (s) { s.classList.add('show'); setTimeout(() => s.classList.remove('show'), 2500); }
      loadSettings();
      if (quickToggle) quickToggle.checked = clean.mode !== 'off';
    } catch (err) {
      showImportError('Could not import: ' + err.message);
    } finally {
      e.target.value = '';
    }
  };
  reader.onerror = () => showImportError('Could not read the selected file.');
  reader.readAsText(file);
});

// ─── Overview ─────────────────────────────────────────────────────────────────
async function renderOverview() {
  await Promise.all([
    renderStats(),
    renderTimeline(),
    renderCategoryChart(),
    renderDomainChart(),
    renderMethodDonut(),
  ]);
  updateTimestamp();
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderTimeline, 150);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.llmBlockedEvents) {
    renderOverview();
    if (document.getElementById('page-events').classList.contains('active')) renderEventTable();
  }
  if (changes.llmModelStatus) refreshModelBadge();
  if (changes.llmLeakageSettings) {
    const mode = changes.llmLeakageSettings.newValue?.mode;
    if (quickToggle && mode) quickToggle.checked = mode !== 'off';
  }
});

renderOverview();
