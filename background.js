// Background service worker for LLM Data Leakage Monitor.
//
// IMPORTANT: Do NOT load @xenova/transformers or any ONNX pipeline here.
// Chrome MV3 service workers cannot spawn blob: Web Workers, which ONNX
// Runtime requires for multi-threaded WASM. Attempting to do so produces
// "Failed to execute 'importScripts' on 'WorkerGlobalScope'" errors.
//
// All NER/BERT inference runs in page-injected-module.js (page context).
// content.js relays the model status here via chrome.runtime.sendMessage.

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['llmLeakageSettings'], (result) => {
    if (!result.llmLeakageSettings) {
      chrome.storage.local.set({
        llmLeakageSettings: { mode: 'block', allowlist: [] }
      });
    }
  });
  // Reset model status on install/update so the badge reflects reality
  chrome.storage.local.set({ llmModelStatus: 'loading' });
});

// content.js sends { type: 'modelStatus', status: 'ready' | 'error' }
// when page-injected-module.js fires the llm-model-status CustomEvent.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'modelStatus') {
    chrome.storage.local.set({ llmModelStatus: message.status });
    sendResponse({ ok: true });
  }
});
