import sensitiveDataModel from './model.js';

// Patterns for detecting sensitive data
const patterns = {
  'apiKey': /(api[_-]?key|apikey|api[_-]?token|apitoken)[\s]*[=:]\s*['"]?([a-zA-Z0-9_\-\.]{20,})['"]?/gi,
  'awsKey': /(aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)[\s]*[=:]\s*['"]?([A-Z0-9]{20,})['"]?/gi,
  'privateKey': /(-----BEGIN[_-]?PRIVATE[_-]?KEY-----[\s\S]*?-----END[_-]?PRIVATE[_-]?KEY-----)/gi,
  'password': /(password|passwd|pwd)[\s]*[=:]\s*['"]?([a-zA-Z0-9_\-\.@#$%^&*]{8,})['"]?/gi,
  'jwt': /(eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)/g,
  'standaloneApiKey': /(gsk_[a-zA-Z0-9]{32,}|sk_[a-zA-Z0-9]{32,}|pk_[a-zA-Z0-9]{32,}|[a-zA-Z0-9_\-\.]{20,})/g
};

let protectionEnabled = true;
let detectionCount = 0;

// Initialize protection state
chrome.storage.local.get(['protectionEnabled', 'detectionCount'], function(result) {
  protectionEnabled = result.protectionEnabled !== undefined ? result.protectionEnabled : true;
  detectionCount = result.detectionCount || 0;
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'toggleProtection') {
    protectionEnabled = request.enabled;
  }
});

// Function to mask sensitive data
function maskSensitiveData(text) {
  if (typeof text !== 'string') {
    console.log('Warning: maskSensitiveData received non-string input:', text);
    return text;
  }
  return text.replace(/[a-zA-Z0-9]/g, '*');
}

// Function to check if text contains sensitive data
async function containsSensitiveData(text) {
    try {
        // Try to use the ML model first
        const prediction = await sensitiveDataModel.predict(text);
        if (prediction > 0.7) { // Threshold for sensitive data
            console.log('ML model detected sensitive data:', prediction);
            return true;
        }
    } catch (error) {
        console.log('Falling back to rule-based detection');
        // Fall back to rule-based detection if ML model fails
        return sensitiveDataModel.fallbackDetection(text);
    }
    return false;
}

// Function to create and show toast notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: #ff4444;
    color: white;
    padding: 15px 25px;
    border-radius: 4px;
    z-index: 10000;
    font-family: Arial, sans-serif;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    animation: slideIn 0.5s ease-out;
  `;
  
  // Add animation keyframes
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Remove toast after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.5s ease-out';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// Function to highlight sensitive data
function highlightSensitiveData(element) {
  element.style.cssText = `
    background-color: rgba(255, 0, 0, 0.1);
    border-bottom: 2px solid red;
    padding: 2px;
    position: relative;
  `;
  
  // Add warning icon
  const warning = document.createElement('span');
  warning.textContent = '⚠️';
  warning.style.cssText = `
    position: absolute;
    top: -20px;
    right: 0;
    font-size: 16px;
    cursor: pointer;
  `;
  warning.title = 'Sensitive data detected';
  element.appendChild(warning);
}

// Function to handle input events
async function handleInput(event) {
    if (!protectionEnabled || !event || !event.target) return;
    
    const input = event.target;
    const text = input.value || '';
    
    console.log('Checking input:', text);
    
    const isSensitive = await containsSensitiveData(text);
    if (isSensitive) {
        console.log('Sensitive data found in input');
        // Show toast notification
        showToast('⚠️ Sensitive data detected in input field');
        
        // Add red underline to input
        input.style.cssText = `
            border-bottom: 2px solid red !important;
            background-color: rgba(255, 0, 0, 0.1) !important;
            outline: none !important;
        `;
        
        // Add warning icon
        let warningIcon = input.parentElement.querySelector('.sensitive-data-warning');
        if (!warningIcon && input.parentElement) {
            warningIcon = document.createElement('span');
            warningIcon.className = 'sensitive-data-warning';
            warningIcon.textContent = '⚠️';
            warningIcon.style.cssText = `
                position: absolute;
                right: 10px;
                top: 50%;
                transform: translateY(-50%);
                font-size: 16px;
                cursor: pointer;
                z-index: 1000;
            `;
            input.parentElement.style.position = 'relative';
            input.parentElement.appendChild(warningIcon);
        }
    } else {
        // Remove highlighting if no sensitive data
        input.style.cssText = '';
        const warningIcon = input.parentElement?.querySelector('.sensitive-data-warning');
        if (warningIcon) {
            warningIcon.remove();
        }
    }
}

// Add input event listeners to all input and textarea elements
function addInputListeners() {
  const inputs = document.querySelectorAll('input, textarea');
  inputs.forEach(input => {
    input.addEventListener('input', handleInput);
    input.addEventListener('change', handleInput);
  });
}

// Create a MutationObserver to watch for DOM changes
const observer = new MutationObserver(function(mutations) {
  mutations.forEach(function(mutation) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Add listeners to new input elements
          const inputs = node.querySelectorAll('input, textarea');
          inputs.forEach(input => {
            input.addEventListener('input', handleInput);
            input.addEventListener('change', handleInput);
          });
          
          // Check text content
          const textNodes = document.evaluate(
            './/text()',
            node,
            null,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            null
          );
          
          for (let i = 0; i < textNodes.snapshotLength; i++) {
            handleTextContent(textNodes.snapshotItem(i));
          }
        }
      });
    }
  });
});

// Start observing the document
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Initial setup
addInputListeners();

// Function to handle text content
async function handleTextContent(node) {
    if (!protectionEnabled || !node || !node.textContent) return;

    const text = node.textContent;
    const isSensitive = await containsSensitiveData(text);
    
    if (isSensitive) {
        detectionCount++;
        chrome.storage.local.set({ detectionCount: detectionCount });
        
        // Show toast notification
        showToast('⚠️ Sensitive data detected and masked');
        
        // Create a wrapper element
        const wrapper = document.createElement('span');
        wrapper.className = 'sensitive-data-wrapper';
        
        // Mask the sensitive data
        let maskedText = text;
        for (const [type, pattern] of Object.entries(sensitiveDataModel.fallbackDetection.patterns)) {
            maskedText = maskedText.replace(pattern, (match, p1, p2) => {
                if (p2) {
                    return p1 + '=' + maskSensitiveData(p2);
                }
                return maskSensitiveData(match);
            });
        }
        
        // Set the masked text
        wrapper.textContent = maskedText;
        
        // Highlight the wrapper
        highlightSensitiveData(wrapper);
        
        // Replace the original node
        const parent = node.parentNode;
        if (parent) {
            parent.insertBefore(wrapper, node);
            node.remove();
        }
    }
}

// Initial scan of the page
document.querySelectorAll('*').forEach(function(element) {
  const textNodes = document.evaluate(
    './/text()',
    element,
    null,
    XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
    null
  );
  
  for (let i = 0; i < textNodes.snapshotLength; i++) {
    handleTextContent(textNodes.snapshotItem(i));
  }
}); 