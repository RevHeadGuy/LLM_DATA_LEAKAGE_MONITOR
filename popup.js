'use strict';

const { mergeSettings } = window.LdlmDetection;

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
      const settings = mergeSettings(llmLeakageSettings);
      const events   = Array.isArray(llmBlockedEvents) ? llmBlockedEvents : [];
      const state    = llmModelStatus || 'loading';

      const dot = document.getElementById('modelDot');
      const txt = document.getElementById('modelStatus');
      dot.className   = `model-dot ${state}`;
      txt.textContent = state === 'ready' ? 'Loaded \u2713' : state === 'error' ? 'Failed \u2717' : 'Loading\u2026';
      txt.style.color = state === 'ready'   ? 'var(--success)'
                      : state === 'error'   ? 'var(--danger)'
                      :                       'var(--warn)';

      const now = Date.now();
      const day = 86400000;
      document.getElementById('sBlocked').textContent = events.filter(e => e.action === 'Blocked').length;
      document.getElementById('sWarned').textContent  = events.filter(e => e.action === 'Warning').length;
      document.getElementById('sToday').textContent   = events.filter(e => now - e.time < day).length;

      ['block', 'warn', 'off'].forEach(m => {
        const id  = `mode${m.charAt(0).toUpperCase()}${m.slice(1)}`;
        const btn = document.getElementById(id);
        if (btn) btn.className = `mode-btn${settings.mode === m ? ` active-${m}` : ''}`;
      });

      const scopeBox = document.getElementById('scopeLlmOnly');
      if (scopeBox) scopeBox.checked = settings.scope !== 'all';

      const container = document.getElementById('recentEvents');
      if (!events.length) {
        container.innerHTML = '<div class="no-events">No detections yet</div>';
      } else {
        container.innerHTML = events.slice(0, 5).map(e => {
          const dotClass = e.action === 'Blocked' ? 'blocked' : 'warning';
          const domain = String(e.domain || 'unknown').replace(/[<>&"]/g, '');
          const cat = String(e.category || '').replace(/[<>&"]/g, '');
          return `<div class="event-item">
            <div class="event-dot ${dotClass}"></div>
            <span class="event-domain">${domain}</span>
            <span class="event-cat">${cat}</span>
            <span class="event-time">${timeAgo(e.time)}</span>
          </div>`;
        }).join('');
      }
    }
  );
}

function savePatch(patch, cb) {
  chrome.storage.local.get(['llmLeakageSettings'], ({ llmLeakageSettings }) => {
    const next = mergeSettings({ ...mergeSettings(llmLeakageSettings), ...patch });
    chrome.storage.local.set({ llmLeakageSettings: next }, cb || loadAll);
  });
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => savePatch({ mode: btn.dataset.mode }));
});

document.getElementById('scopeLlmOnly')?.addEventListener('change', (e) => {
  const checkbox = e.target;
  const wantAllSites = !checkbox.checked;

  if (wantAllSites) {
    // "All sites" needs the broad host permission. The checkbox click is a
    // user gesture, so we can request it here. If the user declines, revert.
    chrome.permissions.request({ origins: ['<all_urls>'] }, (granted) => {
      if (!granted) {
        checkbox.checked = true;
        return;
      }
      savePatch({ scope: 'all' });
    });
    return;
  }

  // Back to LLM-only: drop the broad permission we no longer need.
  savePatch({ scope: 'llm' }, () => {
    chrome.permissions.remove({ origins: ['<all_urls>'] }, loadAll);
  });
});

document.getElementById('openDashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') loadAll();
});

loadAll();
