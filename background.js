import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.10.0/dist/transformers.min.js';

env.allowRemoteModels = false;
env.localModelPath = chrome.runtime.getURL('web_model/');
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('wasm/');

let nerPipeline = null;

async function loadModel() {
  if (!nerPipeline) {
    nerPipeline = await pipeline('token-classification', 'bert-tiny-ner', { quantized: true });
  }
  return nerPipeline;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'checkPII') {
    (async () => {
      try {
        const model = await loadModel();
        const result = await model(message.text, { aggregation_strategy: 'simple' });

        // Common PII entity groups from BERT model
        const piiTags = ['PER', 'ORG', 'LOC', 'MISC', 'DATE', 'NOC'];
        let hasPII = result.some(ent => piiTags.includes(ent.entity_group));

        // Additional keyword-based checks for general PII that BERT might miss
        const lowerText = message.text.toLowerCase();
        const additionalPiiKeywords = [
          'my full name is', 'i live at', 'my date of birth is', 'my mother\'s maiden name is',
          'my current location is', 'my medical condition is', 'my office password is',
          'my personal password is', 'my system password is', 'my database password is',
          'my server password is', 'my secret phrase is', 'my secret is'
        ];
        const containsAdditionalPii = additionalPiiKeywords.some(keyword => lowerText.includes(keyword));

        if (containsAdditionalPii) {
          hasPII = true; 
        }

        sendResponse({ pii: hasPII });
      } catch (e) {
        console.error('NER inference error:', e);
        sendResponse({ pii: false, error: e.message });
      }
    })();

    return true; // keep channel open for async response
  }
});
