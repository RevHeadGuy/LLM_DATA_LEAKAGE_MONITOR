'use strict';

// ─── Storage helpers ──────────────────────────────────────────────────────────
function getStorage(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function setStorage(obj)  { return new Promise(r => chrome.storage.local.set(obj, r)); }

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
let modelPollTimer = setInterval(async () => {
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
  const current = llmLeakageSettings || { mode: 'block', allowlist: [] };
  const newMode = quickToggle.checked ? 'block' : 'off';
  await setStorage({ llmLeakageSettings: { ...current, mode: newMode } });
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
  const week   = 7 * day;

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
      <span class="bar-label" title="${label}">${label}</span>
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
      <span class="bar-label" title="${domain}">${domain}</span>
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
    cats.map(c=>`<option value="${c}"${c===prev?' selected':''}>${c}</option>`).join('');
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
    const rowClass = e.action==='Blocked' ? 'row-blocked' : 'row-warned';
    const actionBadge = e.action==='Blocked'
      ? `<span class="badge blocked">🚫 Blocked</span>`
      : `<span class="badge warning">⚠ Warning</span>`;
    const methodBadge = e.detectionMethod==='bert'
      ? `<span class="badge bert">BERT</span>`
      : `<span class="badge regex">Regex</span>`;

    return `<tr class="${rowClass}" data-idx="${idx}">
      <td style="color:var(--muted);white-space:nowrap;font-size:12px">${timeStr}</td>
      <td>${actionBadge}</td>
      <td><span class="badge category">${e.category||'Unknown'}</span></td>
      <td>${methodBadge}</td>
      <td style="font-size:12px">${e.domain||'—'}</td>
      <td style="color:var(--muted);font-size:12px">${e.source||'—'}</td>
    </tr>
    <tr class="row-detail" id="detail-${idx}">
      <td colspan="6">
        <div class="row-detail-grid">
          <div class="row-detail-item"><strong>Full Timestamp</strong>${new Date(e.time||Date.now()).toLocaleString()}</div>
          <div class="row-detail-item"><strong>Detection Method</strong>${e.detectionMethod||'regex'}</div>
          <div class="row-detail-item"><strong>Category</strong>${e.category||'Unknown'}</div>
          <div class="row-detail-item"><strong>Domain</strong>${e.domain||'—'}</div>
          <div class="row-detail-item"><strong>Source</strong>${e.source||'—'}</div>
          <div class="row-detail-item"><strong>Action</strong>${e.action||'—'}</div>
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

  const header = ['Time','Action','Category','Method','Domain','Source'];
  const rows = events.map(e => {
    return [new Date(e.time||Date.now()).toISOString(), e.action,
      e.category||'Unknown', e.detectionMethod||'regex', e.domain||'', e.source||'']
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
  const settings = llmLeakageSettings || { mode:'block', allowlist:[] };
  const events   = Array.isArray(llmBlockedEvents) ? llmBlockedEvents : [];

  document.getElementById('modeSelect').value     = settings.mode || 'block';
  document.getElementById('allowlistInput').value = (settings.allowlist||[]).join('\n');

  const modeLabels = { block:'Block', warn:'Warn only', off:'Off' };
  document.getElementById('infoMode').textContent      = modeLabels[settings.mode]||settings.mode;
  document.getElementById('infoAllowlist').textContent = (settings.allowlist||[]).length || 'None';
  document.getElementById('infoEvents').textContent    = events.length;

  const infoBert = document.getElementById('infoBert');
  if (infoBert) {
    const state = llmModelStatus || 'loading';
    infoBert.className   = `info-val ${state==='ready'?'good':state==='error'?'bad':'loading'}`;
    infoBert.textContent = state==='ready' ? 'Loaded \u2713' : state==='error' ? 'Failed \u2717' : 'Loading\u2026';
  }
}

document.getElementById('saveSettingsBtn')?.addEventListener('click', async () => {
  const mode = document.getElementById('modeSelect').value;
  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  await setStorage({ llmLeakageSettings: { ...(llmLeakageSettings||{}), mode } });
  const s = document.getElementById('saveStatus');
  s.classList.add('show'); setTimeout(()=>s.classList.remove('show'),2000);
  loadSettings();
  // sync quick toggle
  if (quickToggle) quickToggle.checked = mode !== 'off';
});

document.getElementById('saveAllowlistBtn')?.addEventListener('click', async () => {
  const raw = document.getElementById('allowlistInput').value || '';
  const allowlist = raw.split(/[\n,]+/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  const { llmLeakageSettings } = await getStorage(['llmLeakageSettings']);
  await setStorage({ llmLeakageSettings: { ...(llmLeakageSettings||{}), allowlist } });
  const s = document.getElementById('saveAllowlistStatus');
  s.classList.add('show'); setTimeout(()=>s.classList.remove('show'),2000);
  loadSettings();
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
