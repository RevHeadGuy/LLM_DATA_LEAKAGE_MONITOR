// Initialize extension state
chrome.runtime.onInstalled.addListener(function() {
  chrome.storage.local.set({
    protectionEnabled: true,
    detectionCount: 0
  });
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'updateDetectionCount') {
    chrome.storage.local.set({ detectionCount: request.count });
  }
}); 