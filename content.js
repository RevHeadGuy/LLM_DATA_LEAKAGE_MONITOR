console.log("LLM Data Leakage Monitor content script loaded!");

const DEFAULT_SETTINGS = {
  mode: 'block',
  allowlist: []
};

const regexPatterns = [
  // SSN
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
  // Generic 16-digit card-like numbers
  /\b(?:\d[ -]?){15}\d\b/g,
  // Credit card numbers (Visa, MC, Amex, Discover, etc.)
  /(?:3[47]\d{13}|(?:4|5|6)\d{15}|3(?:0[0-5]|[68]\d)\d{11}|(?:2131|1800)\d{11})\b/g,
  // Email
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone number
  /\b(?:\+?\d{1,3}\s?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,
  // AWS access key IDs
  /AKIA[0-9A-Z]{16}/g,
  // AWS temporary access key IDs
  /ASIA[0-9A-Z]{12,}/g,
  // Google API key
  /AIza[0-9A-Za-z\-_]{35}/g,
  // Generic secret key (sk-... style)
  /sk[-_][a-zA-Z0-9]{32,}/g,
  // JWT
  /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
  // PEM private key block
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  // Connection strings
  /(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|redis:\/\/|amqp:\/\/|ssh:\/\/)[^\s<>]+/gi,
  // OAuth / bearer tokens
  /(?:client[_-]?secret|oauth[_-]?token|refresh[_-]?token|bearer)[\s:=]+['"]?[A-Za-z0-9._~+\/-]+=*['"]?/gi,
  // Bare hashes / tokens by length
  /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{40}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g,
  // API / secret / access-token assignments — accept ":", "=", OR "is"
  /api[_-]?key\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  /secret[_-]?key\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  /access[_-]?token\s*(?:[:=]|is)\s*['"]?[A-Za-z0-9\-_]{16,}['"]?/gi,
  // Passwords with context label (is / : / =)
  /(?:office|personal|system|database|server)\s+password\s+(?:is|:|=)\s*['"]?[A-Za-z0-9!@#$%^&*()_+=\-]{3,}['"]?/gi,
  // "My <field> is ..." catch-all for common PII disclosures
  /\b(?:my|i)\s+(?:full\s+name|name|address|date\s+of\s+birth|birthdate|mother['']s\s+maiden\s+name|current\s+location|medical\s+condition|medical\s+record\s+number|employee\s+id|passport\s+number|driver['']s\s+license\s+number|secret\s+phrase|secret[_\s-]?key|api[_\s-]?key|access[_\s-]?token|ssn|social\s+security|credit\s+card|aws\s+key|google\s+api\s+key|password)\s+(?:is|:|=)/gi,
  // Medical record number
  /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi,
  // Employee ID
  /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi,
  // Driver's license — only match when full label is present (avoids matching every word starting with D)
  /driver['']s\s+license\s+(?:number\s+)?(?:is\s+)?[A-Za-z0-9]{7,}/gi,
  // Passport — only match when full label is present (avoids matching every word starting with P)
  /passport\s+(?:number\s+)?(?:is\s+)?[A-Za-z0-9]{7,}/gi
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
    ].slice(0, 200); // keep up to 200 events for the dashboard

    chrome.storage.local.set({ llmBlockedEvents: next });
  });
}

// Map a text sample to the category of the first regex that matched it
function detectCategory(text) {
  const categoryMap = [
    { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,                                                                   label: 'SSN' },
    { pattern: /\b(?:\d[ -]?){15}\d\b/g,                                                                            label: 'Credit Card' },
    { pattern: /(?:3[47]\d{13}|(?:4|5|6)\d{15}|3(?:0[0-5]|[68]\d)\d{11}|(?:2131|1800)\d{11})\b/g,                 label: 'Credit Card' },
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,                                                  label: 'Email' },
    { pattern: /\b(?:\+?\d{1,3}\s?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g,                                            label: 'Phone Number' },
    { pattern: /AKIA[0-9A-Z]{16}/g,                                                                                 label: 'AWS Key' },
    { pattern: /ASIA[0-9A-Z]{12,}/g,                                                                                label: 'AWS Key' },
    { pattern: /AIza[0-9A-Za-z\-_]{35}/g,                                                                           label: 'Google API Key' },
    { pattern: /sk[-_][a-zA-Z0-9]{32,}/g,                                                                           label: 'Secret Key' },
    { pattern: /(?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,                                          label: 'JWT Token' },
    { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,                                           label: 'Private Key' },
    { pattern: /(?:mongodb(?:\+srv)?:\/\/|postgres(?:ql)?:\/\/|mysql:\/\/|redis:\/\/|amqp:\/\/|ssh:\/\/)/gi,        label: 'Connection String' },
    { pattern: /(?:client[_-]?secret|oauth[_-]?token|refresh[_-]?token|bearer)[\s:=]+/gi,                          label: 'OAuth Token' },
    { pattern: /api[_-]?key\s*(?:[:=]|is)\s*/gi,                                                                   label: 'API Key' },
    { pattern: /secret[_-]?key\s*(?:[:=]|is)\s*/gi,                                                                label: 'Secret Key' },
    { pattern: /access[_-]?token\s*(?:[:=]|is)\s*/gi,                                                              label: 'Access Token' },
    { pattern: /(?:office|personal|system|database|server)\s+password\s+(?:is|:|=)/gi,                             label: 'Password' },
    { pattern: /\b(?:my|i)\s+(?:full\s+name|name)\s+(?:is|:|=)/gi,                                                 label: 'Full Name' },
    { pattern: /\b(?:my|i)\s+(?:address)\s+(?:is|:|=)/gi,                                                          label: 'Address' },
    { pattern: /\b(?:my|i)\s+(?:ssn|social\s+security)\s+(?:is|:|=)/gi,                                            label: 'SSN' },
    { pattern: /\b(?:my|i)\s+(?:password)\s+(?:is|:|=)/gi,                                                         label: 'Password' },
    { pattern: /\b(?:my|i)\s+(?:credit\s+card)\s+(?:is|:|=)/gi,                                                    label: 'Credit Card' },
    { pattern: /(?:medical record number|MRN)[-.\s]?[A-Za-z0-9]{3,}/gi,                                            label: 'Medical Record' },
    { pattern: /(?:employee id|EMP)[-.\s]?[A-Za-z0-9]{3,}/gi,                                                      label: 'Employee ID' },
    { pattern: /driver['']s\s+license/gi,                                                                           label: "Driver's License" },
    { pattern: /passport\s+(?:number\s+)?/gi,                                                                       label: 'Passport' },
    { pattern: /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g,                                                  label: 'Hash / Token' },
    { pattern: /(?<![A-Za-z0-9])[A-Za-z0-9]{40}(?![A-Za-z0-9])/g,                                                  label: 'Hash / Token' },
    { pattern: /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g,                                                  label: 'Hash / Token' },
  ];

  for (const { pattern, label } of categoryMap) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      pattern.lastIndex = 0;
      return label;
    }
  }
  return 'Sensitive Data';
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

function blockInput(el, source = 'input', detectionMethod = 'regex', category = 'Sensitive Data') {
  el.style.backgroundColor = '#ffcccc';
  if (el.isContentEditable) {
    el.innerText = '';
  } else {
    el.value = '';
  }
  el.setCustomValidity?.('Sensitive data detected! Input cleared.');
  saveBlockedEvent('Blocked', source, window.location.hostname, detectionMethod, category);
  showToast('Sensitive data detected! Input cleared.');
}

function warnOnly(el, source = 'input', detectionMethod = 'regex', category = 'Sensitive Data') {
  el.style.backgroundColor = '#fff3cd';
  el.setCustomValidity?.('Sensitive data detected. Warning mode enabled.');
  saveBlockedEvent('Warning', source, window.location.hostname, detectionMethod, category);
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

// Relay model load status from page context → background service worker → storage
// so the popup and dashboard can display an accurate model status badge.
window.addEventListener('llm-model-status', (e) => {
  const status = e.detail?.status || 'error';
  chrome.runtime.sendMessage({ type: 'modelStatus', status });
});

function checkPIIWithPage(text, timeoutMs = 3000) {
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
        resolve(Boolean(e.detail.hasPII));
      }
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

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
    const category = detectCategory(text);
    if (settings.mode === 'warn') {
      warnOnly(el, source, 'regex', category);
      return true;
    }
    blockInput(el, source, 'regex', category);
    return true;
  }

  try {
    const hasPII = await checkPIIWithPage(text);
    if (hasPII) {
      if (settings.mode === 'warn') {
        warnOnly(el, source, 'bert', 'PII (NER)');
      } else {
        blockInput(el, source, 'bert', 'PII (NER)');
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

// Paste: synchronously block using regex; for BERT-only hits, clear the field after inference.
// Browser paste events cannot be cancelled asynchronously, so we preventDefault immediately
// for regex hits and rely on field-clearing for late BERT detections.
function onPaste(e) {
  const el = e.target;
  if (!el) return;

  const pastedText = e.clipboardData?.getData('text/plain') || '';
  if (!pastedText) return;

  const textToCheck = pastedText.trim();
  if (textToCheck.length < MIN_INPUT_LENGTH) return;

  // Synchronous regex check — can still cancel the event here
  if (containsSensitiveRegex(textToCheck)) {
    e.preventDefault();
    // Run the full handler to show toast, save event, apply styling
    processSensitiveText(el, textToCheck, 'paste');
    return;
  }
  // For BERT-only detection we can't cancel the paste synchronously.
  // After the paste lands in the field, the async check will clear it if sensitive.
  processSensitiveText(el, textToCheck, 'paste');
}

// Drop: same strategy as paste — prevent synchronously on regex hit; clear async for BERT.
function onDrop(e) {
  const el = e.target;
  const droppedText = e.dataTransfer?.getData('text/plain') || '';
  if (!droppedText) return;

  const textToCheck = droppedText.trim();
  if (textToCheck.length < MIN_INPUT_LENGTH) return;

  // Synchronous regex check — can still cancel the event here
  if (containsSensitiveRegex(textToCheck)) {
    e.preventDefault();
    processSensitiveText(el, textToCheck, 'drop');
    return;
  }

  // For BERT-only hits, let the drop land then clear the field
  processSensitiveText(el, textToCheck, 'drop');
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
