console.log("LLM Data Leakage Monitor content script loaded!");

const DEFAULT_SETTINGS = {
  mode: 'block',
  allowlist: []
};

const regexPatterns = [
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
  /\b(?:\d[ -]?){15}\d\b/g,
  /(?:3[47]\d{13}|(?:4|5|6)\d{15}|3(?:0[0-5]|[68]\d)\d{11}|(?:2131|1800)\d{11})\b/g,
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  /\b(?:\+?\d{1,3}\s?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{12,}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /sk[-_][a-zA-Z0-9]{32,}/g,
  /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /(?:mongodb(?:\+srv)?://|postgres(?:ql)?://|mysql://|redis://|amqp://|ssh://)[^\s'"<>]+/gi,
  /(?:client[_-]?secret|oauth[_-]?token|refresh[_-]?token|jwt|bearer)[\s:=]+['"]?[A-Za-z0-9._~+\/-]+=*['"]?/gi,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{40}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g,
  /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  /secret[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  /access[_-]?token\s*[:=]\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  /(?:office|personal|system|database|server)\s+password\s+is\s+['"]?[A-Za-z0-9!@#$%^&*()_+=\-]{3,}['"]?/gi,
  /(?:medical record number|MRN)[-\.\s]?[A-Za-z0-9]{3,}/gi,
  /(?:employee id|EMP)[-\.\s]?[A-Za-z0-9]{3,}/gi,
  /(?:driver['’]s license number|D)[-\.\s]?[A-Za-z0-9]{7,}/gi,
  /(?:passport number|P)[-\.\s]?[A-Za-z0-9]{7,}/gi
];

function resetRegexState(regex) {
  if (regex.global) {
    regex.lastIndex = 0;
  }
}

function containsSensitiveRegex(text) {
  return regexPatterns.some((p) => {
    const result = p.test(text);
    resetRegexState(p);
    return result;
  });
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['llmLeakageSettings'], (result) => {
      const settings = result.llmLeakageSettings || DEFAULT_SETTINGS;
      resolve({
        ...DEFAULT_SETTINGS,
        ...settings,
        allowlist: Array.isArray(settings.allowlist) ? settings.allowlist : []
      });
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

function saveBlockedEvent(action, source = 'input', domain = window.location.hostname) {
  chrome.storage.local.get(['llmBlockedEvents'], (result) => {
    const prior = Array.isArray(result.llmBlockedEvents) ? result.llmBlockedEvents : [];
    const next = [
      {
        action,
        source,
        domain,
        time: Date.now()
      },
      ...prior
    ].slice(0, 20);

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
    zIndex: 99999,
    opacity: 0.95
  });

  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function blockInput(el, source = 'input') {
  el.style.backgroundColor = '#ffcccc';
  if (el.isContentEditable) {
    el.innerText = '';
  } else {
    el.value = '';
  }
  el.setCustomValidity?.('Sensitive data detected! Input cleared.');
  saveBlockedEvent('Blocked', source, window.location.hostname);
  showToast('Sensitive data detected! Input cleared.');
}

function warnOnly(el, source = 'input') {
  el.style.backgroundColor = '#fff3cd';
  el.setCustomValidity?.('Sensitive data detected. Warning mode enabled.');
  saveBlockedEvent('Warning', source, window.location.hostname);
  showToast('Sensitive data detected. Warning mode enabled.', true);
}

function clearBlock(el) {
  el.style.backgroundColor = '';
  el.setCustomValidity?.('');
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function injectModuleScript() {
  const moduleScript = document.createElement('script');
  moduleScript.type = 'module';
  moduleScript.src = chrome.runtime.getURL('libs/page-injected-module.js');
  moduleScript.setAttribute('data-model-path', chrome.runtime.getURL('web_model/'));
  moduleScript.setAttribute('data-wasm-path', chrome.runtime.getURL('wasm/'));
  (document.head || document.documentElement).appendChild(moduleScript);
  moduleScript.onload = () => moduleScript.remove();
}

injectModuleScript();

function checkPIIWithPage(text) {
  return new Promise((resolve) => {
    const id = 'llm-pii-check-' + Math.random().toString(36).slice(2);

    function handler(e) {
      if (e.detail.id === id) {
        window.removeEventListener('llm-pii-result', handler);
        resolve(e.detail.hasPII);
      }
    }

    window.addEventListener('llm-pii-result', handler);
    window.dispatchEvent(new CustomEvent('llm-pii-check', { detail: { id, text } }));
  });
}

const MIN_INPUT_LENGTH = 6;

async function processSensitiveText(el, text, source = 'input') {
  const settings = await getSettings();

  if (isAllowedDomain(settings)) {
    clearBlock(el);
    return false;
  }

  if (settings.mode === 'off') {
    clearBlock(el);
    return false;
  }

  if (text.length < MIN_INPUT_LENGTH) {
    clearBlock(el);
    return false;
  }

  if (containsSensitiveRegex(text)) {
    if (settings.mode === 'warn') {
      warnOnly(el, source);
      return true;
    }

    blockInput(el, source);
    return true;
  }

  try {
    const hasPII = await checkPIIWithPage(text);
    if (hasPII) {
      if (settings.mode === 'warn') {
        warnOnly(el, source);
      } else {
        blockInput(el, source);
      }
      return true;
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

  let val = '';
  if (el.isContentEditable) {
    val = el.innerText.trim();
  } else {
    val = el.value.trim();
  }

  await processSensitiveText(el, val, 'input');
}, 700);

async function onPaste(e) {
  const el = e.target;
  if (!el) return;

  const pastedText = e.clipboardData?.getData('text/plain') || '';
  if (!pastedText) return;

  const textToCheck = pastedText.trim();
  if (textToCheck.length < MIN_INPUT_LENGTH) return;

  const isSensitive = await processSensitiveText(el, textToCheck, 'paste');
  if (isSensitive) {
    e.preventDefault();
  }
}

async function onDrop(e) {
  const el = e.target;
  const droppedText = e.dataTransfer?.getData('text/plain') || '';
  if (!droppedText) return;

  const textToCheck = droppedText.trim();
  if (textToCheck.length < MIN_INPUT_LENGTH) return;

  const isSensitive = await processSensitiveText(el, textToCheck, 'drop');
  if (isSensitive) {
    e.preventDefault();
  }
}

async function onFormSubmit(e) {
  const form = e.currentTarget;
  const fields = form.querySelectorAll('input, textarea, [contenteditable="true"]');

  for (const field of fields) {
    const value = field.isContentEditable ? field.innerText.trim() : field.value.trim();
    if (value.length >= MIN_INPUT_LENGTH) {
      const isSensitive = await processSensitiveText(field, value, 'submit');
      if (isSensitive) {
        e.preventDefault();
        return;
      }
    }
  }
}

function attachListenerToInput(element) {
  if (element.nodeType !== Node.ELEMENT_NODE) return;

  const targets = element.matches('input[type="text"], input[type="email"], textarea, [contenteditable="true"]')
    ? [element]
    : element.querySelectorAll('input[type="text"], input[type="email"], textarea, [contenteditable="true"]');

  targets.forEach((node) => {
    if (!node.dataset.llmMonitorAttached) {
      node.addEventListener('input', onInput);
      node.addEventListener('paste', onPaste);
      node.addEventListener('drop', onDrop);
      node.dataset.llmMonitorAttached = 'true';

      const form = node.form;
      if (form && !form.dataset.llmMonitorAttached) {
        form.addEventListener('submit', onFormSubmit);
        form.dataset.llmMonitorAttached = 'true';
      }
    }
  });
}

function startMonitoring() {
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

  console.log('LLM Data Leakage Monitor is now actively monitoring for dynamic input fields.');
}

startMonitoring();
