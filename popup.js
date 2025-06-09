document.addEventListener('DOMContentLoaded', function() {
  const statusDiv = document.getElementById('status');
  const toggleButton = document.getElementById('toggleProtection');
  const detectionCount = document.getElementById('detectionCount');

  // Load initial state
  chrome.storage.local.get(['protectionEnabled', 'detectionCount'], function(result) {
    const isEnabled = result.protectionEnabled !== undefined ? result.protectionEnabled : true;
    updateUI(isEnabled);
    detectionCount.textContent = result.detectionCount || 0;
  });

  // Toggle protection
  toggleButton.addEventListener('click', function() {
    chrome.storage.local.get(['protectionEnabled'], function(result) {
      const newState = !result.protectionEnabled;
      chrome.storage.local.set({ protectionEnabled: newState });
      updateUI(newState);
      
      // Notify content script
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'toggleProtection',
          enabled: newState
        });
      });
    });
  });

  function updateUI(isEnabled) {
    if (isEnabled) {
      statusDiv.textContent = 'Protection: Active';
      statusDiv.className = 'status active';
      toggleButton.textContent = 'Disable Protection';
    } else {
      statusDiv.textContent = 'Protection: Inactive';
      statusDiv.className = 'status inactive';
      toggleButton.textContent = 'Enable Protection';
    }
  }
}); 