// Patch Cache.prototype.put to silently ignore chrome-extension scheme errors
(function() {
  const originalPut = Cache.prototype.put;
  Cache.prototype.put = function(request, response) {
    try {
      return originalPut.call(this, request, response).catch(err => {
        if (!err.message.includes("Request scheme 'chrome-extension'")) {
          return Promise.reject(err);
        }
        // Silently ignore this specific error
        return Promise.resolve();
      });
    } catch (err) {
      if (!err.message.includes("Request scheme 'chrome-extension'")) {
        throw err;
      }
      // Silently ignore this specific error
      return Promise.resolve();
    }
  };
})();

import { pipeline, env } from './transformers.min.js';


function getInjectedScriptTag() {
  const scripts = [...document.querySelectorAll('script[type="module"]')];
  return scripts.reverse().find(
    s => s.hasAttribute('data-model-path') && s.hasAttribute('data-wasm-path')
  );
}

(async () => {
  const scriptTag = getInjectedScriptTag();
  if (!scriptTag) {
    throw new Error('Injected module script tag with data attributes not found');
  }

  const modelPath = scriptTag.getAttribute('data-model-path');
  const wasmPath = scriptTag.getAttribute('data-wasm-path');

  env.allowRemoteModels = false;
  env.localModelPath = modelPath;
  env.backends.onnx.wasm.wasmPaths = wasmPath;

  // Disable browser Cache API to avoid stale model data issues
  // env.cache is not a valid property; the correct flag is useBrowserCache
  env.useBrowserCache = false;

  // Load quantized MobileBERT tiny NER model offline
  let ner;
  try {
    ner = await pipeline('token-classification', 'bert-tiny-ner', { quantized: true });
    window.ner = ner;
    // Notify content.js that the model is ready so it can relay to the background
    window.dispatchEvent(new CustomEvent('llm-model-status', { detail: { status: 'ready' } }));
  } catch (loadErr) {
    console.error('Failed to load BERT model:', loadErr);
    window.dispatchEvent(new CustomEvent('llm-model-status', { detail: { status: 'error' } }));
    return; // nothing more to do without a model
  }

  let lastText = '';
  let lastResult = [];

  window.addEventListener('llm-pii-check', async (event) => {
    const { id, text } = event.detail;
    
    if (text === lastText) {
      window.dispatchEvent(new CustomEvent('llm-pii-result', { detail: { id, entities: lastResult } }));
      return;
    }

    try {
      const result = await ner(text, { aggregation_strategy: 'simple' });
      const entities = Array.isArray(result) ? result : [];

      lastText = text;
      lastResult = entities;

      window.dispatchEvent(new CustomEvent('llm-pii-result', { detail: { id, entities } }));
    } catch (e) {
      console.error('NER error:', e);
      window.dispatchEvent(new CustomEvent('llm-pii-result', { detail: { id, entities: lastResult } }));
    }
  });
})();
