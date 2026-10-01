'use strict';

const DEFAULT_SETTINGS = { mode: 'block', allowlist: [] };

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function loadAll() {
  chrome.storage.local.get(
    ['llmLeakageSettings', 'llmBlockedEvents', 'llmModelStatus'],
    ({ llmLeakageSettings, llmBlockedEvents, llmModelStatus }) => {
      const settings = llmLeakageSettings || DEFAULT_SETTINGS;
      const events   = Array.isArray(llmBlockedEvents) ? llmBlockedEvents : [];
      const state    = llmModelStatus || 'loading';

      // Model badge
      const dot = document.getElementById('modelDot');
      const txt = document.getElementById('modelStatus');
      dot.className   = `model-dot ${state}`;
      txt.textContent = state === 'ready' ? 'Loaded \u2713' : state === 'error' ? 'Failed \u2717' : 'Loading\u2026';
      txt.style.color = state === 'ready'   ? 'var(--success)'
                      : state === 'error'   ? 'var(--danger)'
                      :                       'var(--warn)';

      // Stats
      const now = Date.now();
      const day = 86400000;
      document.getElementById('sBlocked').textContent = events.filter(e => e.action === 'Blocked').length;
      document.getElementById('sWarned').textContent  = events.filter(e => e.action === 'Warning').length;
      document.getElementById('sToday').textContent   = events.filter(e => now - e.time < day).length;

      // Mode buttons
      ['block', 'warn', 'off'].forEach(m => {
        const id  = `mode${m.charAt(0).toUpperCase()}${m.slice(1)}`;
        const btn = document.getElementById(id);
        if (btn) btn.className = `mode-btn${settings.mode === m ? ` active-${m}` : ''}`;
      });

      // Recent events (last 5)
      const container = document.getElementById('recentEvents');
      if (!events.length) {
        container.innerHTML = '<div class="no-events">No detections yet</div>';
      } else {
        container.innerHTML = events.slice(0, 5).map(e => {
          const dotClass = e.action === 'Blocked' ? 'blocked' : 'warning';
          return `<div class="event-item">
            <div class="event-dot ${dotClass}"></div>
            <span class="event-domain">${e.domain || 'unknown'}</span>
            <span class="event-cat">${e.category || ''}</span>
            <span class="event-time">${timeAgo(e.time)}</span>
          </div>`;
        }).join('');
      }
    }
  );
}

// Mode toggle buttons
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    chrome.storage.local.get(['llmLeakageSettings'], ({ llmLeakageSettings }) => {
      const current = llmLeakageSettings || DEFAULT_SETTINGS;
      chrome.storage.local.set(
        { llmLeakageSettings: { ...current, mode: btn.dataset.mode } },
        loadAll
      );
    });
  });
});

// Open dashboard in a new tab
document.getElementById('openDashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

// Live updates when storage changes (e.g. new event detected on a page)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') loadAll();
});

// Initial render
loadAll();
