console.log('LLM Data Leakage Monitor content script loaded!');

const {
  MIN_INPUT_LENGTH,
  detectCategory,
  mergeSettings,
  evaluateRegex,
  evaluateNer,
  hasDisclosureContext
} = window.LdlmDetection;

const { getAdapter, isSendKey, getFieldText, isLlmContext } = window.LdlmAdapters;

let settingsCache = mergeSettings(null);
let passThroughSend = false;
let sendCheckInFlight = false;
let lastSendGuardAt = 0;

function hydrateSettings(raw) {
  return mergeSettings(raw);
}

function isInScope(settings = settingsCache) {
  if ((settings.scope || 'llm') === 'all') return true;
  return isLlmContext();
}

function shouldRunNer(text) {
  return ['PER', 'ORG', 'LOC', 'MISC'].some((type) => hasDisclosureContext(text, type));
}

function loadSettingsCache() {
  chrome.storage.local.get(['llmLeakageSettings'], (result) => {
    settingsCache = hydrateSettings(result.llmLeakageSettings);
    maybeInjectModel(settingsCache);
  });
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['llmLeakageSettings'], (result) => {
      const settings = hydrateSettings(result.llmLeakageSettings);
      settingsCache = settings;
      resolve(settings);
    });
  });
}

function isAllowedDomain(settings) {
  const hostname = window.location.hostname.toLowerCase();
  const allowlist = (settings.allowlist || []).map((entry) => entry.trim().toLowerCase()).filter(Boolean);

  if (allowlist.length === 0) {
    return false;
  }

  return allowlist.some((entry) => {
    const normalized = entry.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

function saveBlockedEvent(action, source = 'input', domain = window.location.hostname, detectionMethod = 'regex', category = 'Unknown') {
  chrome.storage.local.get(['llmBlockedEvents'], (result) => {
    const prior = Array.isArray(result.llmBlockedEvents) ? result.llmBlockedEvents : [];
    const next = [
      {
        action,
        source,
        domain,
        detectionMethod,
        category,
        time: Date.now()
      },
      ...prior
    ].slice(0, 200);

    chrome.storage.local.set({ llmBlockedEvents: next });
  });
}

function showToast(msg, isWarning = false) {
  const existing = document.getElementById('llm-data-leakage-toast');
  if (existing) existing.remove();

  const t = document.createElement('div');
  t.id = 'llm-data-leakage-toast';
  t.textContent = msg;

  Object.assign(t.style, {
    position: 'fixed',
    bottom: '30px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: isWarning ? '#ff9800' : '#d32f2f',
    color: '#fff',
    padding: '12px 24px',
    borderRadius: '6px',
    fontSize: '16px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    zIndex: 2147483647,
    opacity: 0.95
  });

  (document.body || document.documentElement).appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function blockInput(el, source = 'input', detectionMethod = 'regex', category = 'Sensitive Data') {
  if (el) {
    el.style.backgroundColor = '#ffcccc';
    if (el.isContentEditable) {
      el.innerText = '';
    } else if ('value' in el) {
      el.value = '';
    }
    el.setCustomValidity?.('Sensitive data detected! Input cleared.');
  }
  saveBlockedEvent('Blocked', source, window.location.hostname, detectionMethod, category);
  showToast('Sensitive data detected! Input cleared.');
}

function warnOnly(el, source = 'input', detectionMethod = 'regex', category = 'Sensitive Data') {
  if (el) {
    el.style.backgroundColor = '#fff3cd';
    el.setCustomValidity?.('Sensitive data detected. Warning mode enabled.');
  }
  saveBlockedEvent('Warning', source, window.location.hostname, detectionMethod, category);
  showToast('Sensitive data detected. Warning mode enabled.', true);
}

function clearBlock(el) {
  if (!el) return;
  el.style.backgroundColor = '';
  el.setCustomValidity?.('');
}

function applyVerdict(el, verdict, source, detectionMethod, text, categoryOverride) {
  const category = categoryOverride
    || (detectionMethod === 'bert' ? 'PII (NER)' : detectCategory(text));
  if (verdict === 'warn') {
    warnOnly(el, source, detectionMethod, category);
    return 'warn';
  }
  blockInput(el, source, detectionMethod, category);
  return 'block';
}

function regexDecision(text, settings = settingsCache) {
  if (!isInScope(settings) || isAllowedDomain(settings) || settings.mode === 'off') {
    return { action: 'skip', category: null, method: 'regex' };
  }
  return evaluateRegex(text, settings);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function injectModuleScript() {
  if (document.querySelector('script[data-ldlm-ner="1"]')) return;
  const moduleScript = document.createElement('script');
  moduleScript.type = 'module';
  moduleScript.src = chrome.runtime.getURL('libs/page-injected-module.js');
  moduleScript.setAttribute('data-ldlm-ner', '1');
  moduleScript.setAttribute('data-model-path', chrome.runtime.getURL('web_model/'));
  moduleScript.setAttribute('data-wasm-path', chrome.runtime.getURL('wasm/'));
  (document.head || document.documentElement).appendChild(moduleScript);
  moduleScript.onload = () => moduleScript.remove();
}

function maybeInjectModel(settings = settingsCache) {
  if (settings.mode === 'off' || isAllowedDomain(settings) || !isInScope(settings)) return;
  injectModuleScript();
}

maybeInjectModel();
loadSettingsCache();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.llmLeakageSettings) {
    settingsCache = hydrateSettings(changes.llmLeakageSettings.newValue);
    maybeInjectModel(settingsCache);
  }
});

window.addEventListener('llm-model-status', (e) => {
  const status = e.detail?.status || 'error';
  chrome.runtime.sendMessage({ type: 'modelStatus', status });
});

function checkNerWithPage(text, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const id = 'llm-pii-check-' + Math.random().toString(36).slice(2);
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener('llm-pii-result', handler);
      clearTimeout(timer);
    };

    function handler(e) {
      if (e.detail && e.detail.id === id) {
        cleanup();
        resolve(Array.isArray(e.detail.entities) ? e.detail.entities : []);
      }
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve([]);
    }, timeoutMs);

    window.addEventListener('llm-pii-result', handler);
    window.dispatchEvent(new CustomEvent('llm-pii-check', { detail: { id, text } }));
  });
}

/**
 * @returns {Promise<'block'|'warn'|false>}
 */
async function processSensitiveText(el, text, source = 'input') {
  const settings = await getSettings();

  if (!isInScope(settings) || isAllowedDomain(settings) || settings.mode === 'off' || text.length < MIN_INPUT_LENGTH) {
    clearBlock(el);
    return false;
  }

  const sync = regexDecision(text, settings);
  if (sync.action === 'warn' || sync.action === 'block') {
    return applyVerdict(el, sync.action, source, 'regex', text, sync.category);
  }

  if (!shouldRunNer(text)) {
    clearBlock(el);
    return false;
  }

  try {
    const entities = await checkNerWithPage(text);
    const ner = evaluateNer(text, entities, settings);
    if (ner.action === 'warn' || ner.action === 'block') {
      return applyVerdict(el, ner.action, source, 'bert', text, ner.category);
    }
    clearBlock(el);
    return false;
  } catch {
    clearBlock(el);
    return false;
  }
}

const onInput = debounce(async (e) => {
  const el = e.target;
  if (!el || !el.tagName) return;

  await processSensitiveText(el, getFieldText(el), 'input');
}, 700);

function onPaste(e) {
  const el = e.target;
  if (!el) return;

  const textToCheck = (e.clipboardData?.getData('text/plain') || '').trim();
  if (textToCheck.length < MIN_INPUT_LENGTH) return;

  const sync = regexDecision(textToCheck);
  if (sync.action === 'block') {
    e.preventDefault();
    applyVerdict(el, 'block', 'paste', 'regex', textToCheck, sync.category);
    return;
  }
  if (sync.action === 'warn') {
    applyVerdict(el, 'warn', 'paste', 'regex', textToCheck, sync.category);
    return;
  }
  processSensitiveText(el, textToCheck, 'paste');
}

function onDrop(e) {
  const el = e.target;
  const textToCheck = (e.dataTransfer?.getData('text/plain') || '').trim();
  if (!textToCheck || textToCheck.length < MIN_INPUT_LENGTH) return;

  const sync = regexDecision(textToCheck);
  if (sync.action === 'block') {
    e.preventDefault();
    applyVerdict(el, 'block', 'drop', 'regex', textToCheck, sync.category);
    return;
  }
  if (sync.action === 'warn') {
    applyVerdict(el, 'warn', 'drop', 'regex', textToCheck, sync.category);
    return;
  }
  processSensitiveText(el, textToCheck, 'drop');
}

function resumeSend(adapter) {
  passThroughSend = true;
  try {
    if (!adapter || !adapter.submit()) {
      const composer = adapter && adapter.getComposer();
      if (composer) {
        composer.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        }));
      }
    }
  } finally {
    setTimeout(() => {
      passThroughSend = false;
    }, 50);
  }
}

async function holdForBertThenSend(el, text, source, adapter) {
  if (sendCheckInFlight) return;
  sendCheckInFlight = true;
  try {
    const settings = settingsCache;
    const entities = await checkNerWithPage(text, 2500);
    const ner = evaluateNer(text, entities, settings);
    if (ner.action === 'block') {
      applyVerdict(el, 'block', source, 'bert', text, ner.category);
      return;
    }
    if (ner.action === 'warn') {
      applyVerdict(el, 'warn', source, 'bert', text, ner.category);
      resumeSend(adapter);
      return;
    }
    resumeSend(adapter);
  } catch {
    resumeSend(adapter);
  } finally {
    sendCheckInFlight = false;
  }
}

function guardOutgoing(event, el, text, source, adapter) {
  if (passThroughSend) return false;
  if (Date.now() - lastSendGuardAt < 250 && sendCheckInFlight) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }

  const sync = regexDecision(text);
  if (sync.action === 'skip') return false;

  if (sync.action === 'block') {
    event.preventDefault();
    event.stopImmediatePropagation();
    lastSendGuardAt = Date.now();
    applyVerdict(el, 'block', source, 'regex', text, sync.category);
    return true;
  }

  if (sync.action === 'warn') {
    if (Date.now() - lastSendGuardAt > 400) {
      applyVerdict(el, 'warn', source, 'regex', text, sync.category);
      lastSendGuardAt = Date.now();
    }
    return false;
  }

  // Regex clean: only hold send for NER when the text looks like a disclosure.
  if (!adapter || !shouldRunNer(text)) return false;

  event.preventDefault();
  event.stopImmediatePropagation();
  lastSendGuardAt = Date.now();
  holdForBertThenSend(el, text, source, adapter);
  return true;
}

function onKeydownCapture(event) {
  if (passThroughSend || !isSendKey(event)) return;

  const adapter = getAdapter();
  if (adapter) {
    const composer = adapter.composerFromEvent(event) || adapter.getComposer();
    if (!composer) return;
    const active = document.activeElement;
    if (active && composer !== active && !composer.contains(active) && !active.contains(composer)) return;
    guardOutgoing(event, composer, adapter.getText(composer), 'send', adapter);
    return;
  }

  const el = event.target;
  if (!el || !el.dataset || !el.dataset.llmMonitorAttached) return;
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return;

  const text = getFieldText(el);
  const sync = regexDecision(text);
  if (sync.action === 'block') {
    event.preventDefault();
    event.stopImmediatePropagation();
    applyVerdict(el, 'block', 'send', 'regex', text, sync.category);
  }
}

function onPointerCapture(event) {
  if (passThroughSend) return;
  if (event.type === 'pointerdown' && event.button !== 0) return;
  if (event.type === 'click' && Date.now() - lastSendGuardAt < 400) return;

  const adapter = getAdapter();
  if (!adapter) return;
  const btn = adapter.sendButtonFromEvent(event);
  if (!btn) return;
  const composer = adapter.getComposer();
  if (!composer) return;
  guardOutgoing(event, composer, adapter.getText(composer), 'send', adapter);
}

function onSubmitCapture(event) {
  if (passThroughSend) return;
  const form = event.target;
  if (!form || form.nodeName !== 'FORM') return;

  const adapter = getAdapter();
  if (adapter) {
    const composer = adapter.getComposer();
    if (composer && form.contains(composer)) {
      guardOutgoing(event, composer, adapter.getText(composer), 'submit', adapter);
      return;
    }
  }

  const fields = form.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]');
  for (const field of fields) {
    const value = getFieldText(field);
    const sync = regexDecision(value);
    if (sync.action === 'block') {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyVerdict(field, 'block', 'submit', 'regex', value, sync.category);
      return;
    }
    if (sync.action === 'warn') {
      applyVerdict(field, 'warn', 'submit', 'regex', value, sync.category);
    }
  }
}

window.addEventListener('keydown', onKeydownCapture, true);
window.addEventListener('pointerdown', onPointerCapture, true);
window.addEventListener('click', onPointerCapture, true);
window.addEventListener('submit', onSubmitCapture, true);

function getInputTargets(root) {
  if (!root) return [];

  const selectors = 'input[type="text"], input[type="email"], input[type="search"], textarea, [contenteditable="true"], [contenteditable="plaintext-only"]';

  if (root instanceof ShadowRoot) {
    return Array.from(root.querySelectorAll(selectors));
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    const ownMatch = root.matches(selectors) ? [root] : [];
    return ownMatch.concat(Array.from(root.querySelectorAll(selectors)));
  }

  return [];
}

function attachListenerToInput(element) {
  const targets = getInputTargets(element);

  targets.forEach((node) => {
    if (!node.dataset.llmMonitorAttached) {
      node.addEventListener('input', onInput);
      node.addEventListener('paste', onPaste);
      node.addEventListener('drop', onDrop);
      node.dataset.llmMonitorAttached = 'true';
    }
  });
}

function startMonitoring() {
  if (!document.body) return;
  attachListenerToInput(document.body);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        attachListenerToInput(node);
        if (node.nodeType === Node.ELEMENT_NODE) {
          node.querySelectorAll('*').forEach((el) => {
            if (el.shadowRoot) {
              attachListenerToInput(el.shadowRoot);
            }
          });
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  const adapter = getAdapter();
  if (adapter) {
    console.log(`LLM Data Leakage Monitor send adapter active: ${adapter.id}`);
  }
  console.log('LLM Data Leakage Monitor is now actively monitoring for dynamic input fields.');
}

if (document.body) {
  startMonitoring();
} else {
  document.addEventListener('DOMContentLoaded', startMonitoring, { once: true });
}
