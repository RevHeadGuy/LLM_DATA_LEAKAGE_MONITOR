// Background service worker for LLM Data Leakage Monitor.
//
// IMPORTANT: Do NOT load @xenova/transformers or any ONNX pipeline here.
// Chrome MV3 service workers cannot spawn blob: Web Workers, which ONNX
// Runtime requires for multi-threaded WASM. Attempting to do so produces
// "Failed to execute 'importScripts' on 'WorkerGlobalScope'" errors.
//
// All NER/BERT inference runs in page-injected-module.js (page context).
// content.js relays the model status here via chrome.runtime.sendMessage.

importScripts('detection-core.js');

// The static content_scripts entry in manifest.json only covers known LLM
// hosts. "All sites" scope is opt-in: it requires the <all_urls> optional
// host permission and a dynamically registered content script. This id is
// used to register/unregister that script.
const ALL_SITES_SCRIPT_ID = 'ldlm-all-sites';

// Keep the dynamically registered "all sites" content script in sync with the
// current scope setting and whether the broad host permission is granted.
async function syncAllSitesScript(settings) {
  const scope = settings && settings.scope === 'all' ? 'all' : 'llm';

  let hasPermission = false;
  try {
    hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  } catch (_) {
    hasPermission = false;
  }

  let registered = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts({ ids: [ALL_SITES_SCRIPT_ID] });
  } catch (_) {
    registered = [];
  }
  const isRegistered = registered.length > 0;

  if (scope === 'all' && hasPermission) {
    if (!isRegistered) {
      try {
        await chrome.scripting.registerContentScripts([{
          id: ALL_SITES_SCRIPT_ID,
          matches: ['<all_urls>'],
          js: ['detection-core.js', 'site-adapters.js', 'content.js'],
          runAt: 'document_start',
          allFrames: false
        }]);
      } catch (err) {
        console.warn('Failed to register all-sites content script:', err);
      }
    }
  } else if (isRegistered) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [ALL_SITES_SCRIPT_ID] });
    } catch (err) {
      console.warn('Failed to unregister all-sites content script:', err);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['llmLeakageSettings'], (result) => {
    const settings = self.LdlmDetection.mergeSettings(result.llmLeakageSettings);
    chrome.storage.local.set({ llmLeakageSettings: settings });
    syncAllSitesScript(settings);
  });
  // Reset model status on install/update so the badge reflects reality
  chrome.storage.local.set({ llmModelStatus: 'loading' });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['llmLeakageSettings'], (result) => {
    syncAllSitesScript(self.LdlmDetection.mergeSettings(result.llmLeakageSettings));
  });
});

// Re-sync the dynamic script whenever the scope setting changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.llmLeakageSettings) {
    syncAllSitesScript(self.LdlmDetection.mergeSettings(changes.llmLeakageSettings.newValue));
  }
});

// content.js sends { type: 'modelStatus', status: 'ready' | 'error' }
// when page-injected-module.js fires the llm-model-status CustomEvent.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'modelStatus') {
    chrome.storage.local.set({ llmModelStatus: message.status });
    sendResponse({ ok: true });
  }
});
