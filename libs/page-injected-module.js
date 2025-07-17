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

  // Disable internal cache to avoid stale model data issues
  env.cache = false;

  // Load quantized MobileBERT tiny NER model offline
  const ner = await pipeline('token-classification', 'bert-tiny-ner', { quantized: true });
  window.ner = ner;

  let lastText = '';
  let lastResult = false;

  window.addEventListener('llm-pii-check', async (event) => {
    const { id, text } = event.detail;
    
    // Avoid re-processing if text hasn't changed significantly
    if (text === lastText) {
      window.dispatchEvent(new CustomEvent('llm-pii-result', { detail: { id, hasPII: lastResult } }));
      return;
    }

    try {
      const result = await ner(text, { aggregation_strategy: 'simple' });
      console.log('Full NER result:', result);

      // Treat any entity label except 'LABEL_0' with score > 0.5 as PII
      const hasPII = result.some(ent => ent.entity !== 'LABEL_0' && ent.score > 0.5);
      
      lastText = text;
      lastResult = hasPII;

      window.dispatchEvent(new CustomEvent('llm-pii-result', { detail: { id, hasPII } }));
    } catch (e) {
      console.error('NER error:', e);
      // Fallback to previous result on error to avoid flickering
      window.dispatchEvent(new CustomEvent('llm-pii-result', { detail: { id, hasPII: lastResult } }));
    }
  });
})();
