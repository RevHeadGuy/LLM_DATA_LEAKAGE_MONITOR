console.log("LLM Data Leakage Monitor content script loaded!");

// Regex patterns to detect sensitive data
const regexPatterns = [
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,                 // SSN-like
  /\b\d{16}\b/g,                                    // 16 digit sequences
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Emails
  /\b\d{10}\b/g,                                    // 10 digit phone numbers
  /AKIA[0-9A-Z]{16}/g,                             // AWS keys
  /AIza[0-9A-Za-z\-_]{35}/g,                       // Google API keys
  /sk[-_][a-zA-Z0-9]{32,}/g,                       // Secret keys
  /(?<![A-Za-z0-9])[A-Za-z0-9]{32}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{40}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9]{64}(?![A-Za-z0-9])/g,
  /api[_-]?key\s*[:=]\s*[A-Za-z0-9\-_]{16,}/gi,
  /secret[_-]?key\s*[:=]\s*[A-Za-z0-9\-_]{16,}/gi,
  /access[_-]?token\s*[:=]\s*[A-Za-z0-9\-_]{16,}/gi
];

// Check if text contains any sensitive regex pattern
function containsSensitiveRegex(text) {
  return regexPatterns.some(p => p.test(text));
}

// Toast notification to alert user
function showToast(msg) {
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
    background: '#d32f2f',
    color: '#fff',
    padding: '12px 24px',
    borderRadius: '6px',
    fontSize: '16px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    zIndex: 99999,
    opacity: 0.95,
  });

  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Visual and functional blocking of input containing sensitive data
function blockInput(el) {
  el.style.backgroundColor = '#ffcccc';
  if (el.isContentEditable) {
    el.innerText = ''; // Clear sensitive data immediately for contenteditable
  } else {
    el.value = '';     // Clear input/textarea
  }
  el.setCustomValidity?.('Sensitive data detected! Input cleared.');
  showToast('Sensitive data detected! Input cleared.');
}

// Clear blocking state from input
function clearBlock(el) {
  el.style.backgroundColor = '';
  el.setCustomValidity?.('');
}

// Debounce utility to limit function calls
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Inject the model runner module script into the page
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

// Ask the injected model script if text contains PII
function checkPIIWithPage(text) {
  return new Promise(resolve => {
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

// Minimum length before running PII checks (to avoid short phrases like "time")
const MIN_INPUT_LENGTH = 6;

// Debounced input handler to check for sensitive data
const onInput = debounce(async e => {
  const el = e.target;

  // Get text depending on input type
  let val;
  if (el.isContentEditable) {
    val = el.innerText.trim();  // Get plain text from contenteditable
  } else {
    val = el.value.trim();       // Normal input/textarea
  }

  if (val.length < MIN_INPUT_LENGTH) {
    clearBlock(el);
    return;
  }

  if (containsSensitiveRegex(val)) {
    blockInput(el);
    return;
  }

  try {
    const hasPII = await checkPIIWithPage(val);
    console.log("PII check result for input:", val, hasPII);
    hasPII ? blockInput(el) : clearBlock(el);
  } catch {
    clearBlock(el);
  }
}, 700);

// Attaches listener to an element if it's a valid input target.
function attachListenerToInput(element) {
  if (element.nodeType !== Node.ELEMENT_NODE) return;

  const targets = element.matches('input[type="text"], textarea, [contenteditable="true"]')
    ? [element]
    : element.querySelectorAll('input[type="text"], textarea, [contenteditable="true"]');

  targets.forEach(node => {
    if (!node.dataset.llmMonitorAttached) {
      node.addEventListener('input', onInput);
      node.dataset.llmMonitorAttached = 'true';
    }
  });
}

// Use MutationObserver to detect dynamically added inputs
function startMonitoring() {
  // Initial scan of the document
  attachListenerToInput(document.body);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        attachListenerToInput(node);
        // Check for shadow roots in newly added elements
        if (node.nodeType === Node.ELEMENT_NODE) {
          node.querySelectorAll('*').forEach(el => {
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
    subtree: true,
  });

  console.log("LLM Data Leakage Monitor is now actively monitoring for dynamic input fields.");
}

startMonitoring();
