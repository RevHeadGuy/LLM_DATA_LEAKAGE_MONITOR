'use strict';

/**
 * ChatGPT / Claude composer adapters.
 * Selectors are ordered from more specific to more generic and tolerate UI churn.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.LdlmAdapters = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function isDisplayed(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.disabled) return false;
    const style = el.ownerDocument && el.ownerDocument.defaultView
      ? el.ownerDocument.defaultView.getComputedStyle(el)
      : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return el.getClientRects().length > 0;
  }

  function queryAll(selectors, root) {
    const scope = root || document;
    const found = [];
    for (const sel of selectors) {
      try {
        found.push(...scope.querySelectorAll(sel));
      } catch (_) {
        // invalid selector in this document
      }
    }
    return found;
  }

  function lastVisible(selectors, root) {
    const nodes = queryAll(selectors, root).filter(isDisplayed);
    if (nodes.length) return nodes[nodes.length - 1];
    const attached = queryAll(selectors, root);
    return attached.length ? attached[attached.length - 1] : null;
  }

  function closestMatch(el, selectors) {
    if (!el || !el.closest) return null;
    for (const sel of selectors) {
      try {
        const hit = el.closest(sel);
        if (hit) return hit;
      } catch (_) {
        // ignore
      }
    }
    return null;
  }

  function controlLabel(el) {
    if (!el) return '';
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-testid'),
      el.id
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function isBlockedControl(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.getAttribute('data-disabled') === 'true') return true;
    const label = controlLabel(el);
    return /stop|cancel|voice|microphone|mic\b|upload|attach|search|share|copy|dictate/.test(label);
  }

  function isLikelySendButton(el) {
    if (!el) return false;
    const btn = el.closest ? (el.closest('button, [role="button"]') || el) : el;
    if (isBlockedControl(btn)) return false;
    const label = controlLabel(btn);
    if (/send/.test(label)) return true;
    if (btn.id === 'composer-submit-button') return true;
    if ((btn.getAttribute('data-testid') || '') === 'send-button') return true;
    if (btn.getAttribute('type') === 'submit' && /composer|prompt|chat/.test(label + (btn.closest('form') ? ' composer' : ''))) {
      return true;
    }
    return false;
  }

  function hostMatches(hostname, hosts) {
    const host = String(hostname || '').toLowerCase();
    return hosts.some((h) => host === h || host.endsWith('.' + h));
  }

  function getFieldText(node) {
    if (!node) return '';
    if (node.isContentEditable) return (node.innerText || node.textContent || '').trim();
    return String(node.value || '').trim();
  }

  function decorate(def) {
    const adapter = {
      id: def.id,
      hosts: def.hosts,
      composerSelectors: def.composerSelectors,
      sendSelectors: def.sendSelectors,

      getComposer(root) {
        return lastVisible(def.composerSelectors, root);
      },

      getSendButton(root) {
        const nodes = queryAll(def.sendSelectors, root);
        return nodes.find((n) => isLikelySendButton(n) && isDisplayed(n))
          || nodes.find((n) => isLikelySendButton(n))
          || null;
      },

      composerFromEvent(event) {
        const target = event.target;
        if (!(target instanceof Element) && !(target instanceof Text)) return this.getComposer();
        const el = target instanceof Text ? target.parentElement : target;
        if (!el) return this.getComposer();
        const direct = closestMatch(el, def.composerSelectors);
        if (direct) return direct;
        const composer = this.getComposer();
        if (composer && composer.contains(el)) return composer;
        return null;
      },

      sendButtonFromEvent(event) {
        const target = event.target;
        if (!(target instanceof Element)) return null;
        const btn = target.closest('button, [role="button"]');
        if (!btn || isBlockedControl(btn)) return null;
        if (closestMatch(btn, def.sendSelectors) && isLikelySendButton(btn)) return btn;
        const composer = this.getComposer();
        if (!composer) return null;
        const toolbar = composer.closest('form') || composer.parentElement;
        if (toolbar && toolbar.contains(btn) && isLikelySendButton(btn)) return btn;
        return null;
      },

      getText(el) {
        return getFieldText(el || this.getComposer());
      },

      submit() {
        const btn = this.getSendButton();
        if (btn && typeof btn.click === 'function') {
          btn.click();
          return true;
        }
        return false;
      }
    };
    return adapter;
  }

  const adapters = [
    decorate({
      id: 'chatgpt',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      composerSelectors: [
        'div.ProseMirror#prompt-textarea',
        '#prompt-textarea',
        '[data-testid="prompt-textarea"]',
        'textarea[name="prompt-textarea"]',
        'textarea#mobile-composer-prompt',
        'div#prompt-textarea[contenteditable="true"]',
        'div#prompt-textarea[contenteditable="plaintext-only"]'
      ],
      sendSelectors: [
        '#composer-submit-button',
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]'
      ]
    }),
    decorate({
      id: 'claude',
      hosts: ['claude.ai'],
      composerSelectors: [
        '[aria-label="Send a message"][contenteditable="true"]',
        '[aria-label="Enter your turn"][contenteditable="true"]',
        '[aria-label="Message Claude"][contenteditable="true"]',
        '[aria-label*="Write your prompt"][contenteditable="true"]',
        '[data-testid="composer-input"]',
        '.tiptap[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]'
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]'
      ]
    })
  ];

  const LLM_HOSTS = [
    'chatgpt.com',
    'chat.openai.com',
    'claude.ai',
    'gemini.google.com',
    'bard.google.com',
    'copilot.microsoft.com',
    'copilot.cloud.microsoft',
    'grok.com',
    'grok.x.ai',
    'perplexity.ai',
    'poe.com',
    'you.com',
    'phind.com',
    'character.ai',
    'chat.deepseek.com',
    'chat.mistral.ai',
    'meta.ai'
  ];

  function isLlmHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return LLM_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  }

  function isLlmContext(hostname) {
    if (getAdapter(hostname)) return true;
    const host = hostname || (typeof location !== 'undefined' ? location.hostname : '');
    if (isLlmHost(host)) return true;
    if (typeof document !== 'undefined' && document.documentElement) {
      return Boolean(document.documentElement.getAttribute('data-ldlm-adapter'));
    }
    return false;
  }

  function getAdapter(hostname) {
    const host = hostname || (typeof location !== 'undefined' ? location.hostname : '');
    const matched = adapters.find((a) => hostMatches(host, a.hosts));
    if (matched) return matched;

    if (typeof document !== 'undefined' && document.documentElement) {
      const forced = document.documentElement.getAttribute('data-ldlm-adapter');
      if (forced) return adapters.find((a) => a.id === forced) || null;
    }
    return null;
  }

  function isSendKey(event) {
    if (!event || event.isComposing || event.keyCode === 229) return false;
    if (event.key !== 'Enter') return false;
    if (event.shiftKey) return false;
    return true;
  }

  return {
    getAdapter,
    adapters,
    isSendKey,
    isLikelySendButton,
    getFieldText,
    isLlmHost,
    isLlmContext,
    LLM_HOSTS
  };
});
