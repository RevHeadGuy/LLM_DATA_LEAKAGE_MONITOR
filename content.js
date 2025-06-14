import sensitiveDataModel from './model.js';

// Patterns for detecting sensitive data
const patterns = {
  'apiKey': /(api[_-]?key|apikey|api[_-]?token|apitoken)[\s]*[=:]\s*['"]?([a-zA-Z0-9_\-\.]{20,})['"]?/gi,
  'awsKey': /(aws[_-]?access[_-]?key[_-]?id|aws[_-]?secret[_-]?access[_-]?key)[\s]*[=:]\s*['"]?([A-Z0-9]{20,})['"]?/gi,
  'privateKey': /(-----BEGIN[_-]?PRIVATE[_-]?KEY-----[\s\S]*?-----END[_-]?PRIVATE[_-]?KEY-----)/gi,
  'password': /(password|passwd|pwd)[\s]*[=:]\s*['"]?([a-zA-Z0-9_\-\.@#$%^&*]{8,})['"]?/gi,
  'jwt': /(eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)/g,
  'standaloneApiKey': /(gsk_[a-zA-Z0-9]{32,}|sk_[a-zA-Z0-9]{32,}|pk_[a-zA-Z0-9]{32,}|[a-zA-Z0-9_\-\.]{20,})/g,
  'creditCard': /\b(?:\d[ -]*?){13,16}\b/g,
  'ssn': /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  'email': /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  'phone': /\b(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  'ipAddress': /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  'base64': /(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?/g
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
function containsSensitiveData(text) {
  if (!text || typeof text !== 'string') return false;
  
  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      console.log(`Detected ${type} in text`);
      return true;
    }
  }
  return false;
}

// Function to create and show toast notification
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
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
  element.classList.add('sensitive-data-highlight');
  
  // Add warning icon
  const warning = document.createElement('span');
  warning.className = 'sensitive-data-warning';
  warning.textContent = '⚠️';
  warning.title = 'Sensitive data detected';
  element.appendChild(warning);
}

// Function to handle input events
function handleInput(event) {
    if (!protectionEnabled || !event || !event.target) return;
    
    const input = event.target;
    const text = input.value || '';
    
    console.log('Checking input:', text);
    
    const isSensitive = containsSensitiveData(text);
    if (isSensitive) {
        console.log('Sensitive data found in input');
        // Show toast notification
        showToast('⚠️ Sensitive data detected in input field');
        
        // Add warning styles to input
        input.classList.add('input-warning');
        
        // Add warning icon
        let warningIcon = input.parentElement.querySelector('.sensitive-data-warning');
        if (!warningIcon && input.parentElement) {
            warningIcon = document.createElement('span');
            warningIcon.className = 'sensitive-data-warning';
            warningIcon.textContent = '⚠️';
            input.parentElement.style.position = 'relative';
            input.parentElement.appendChild(warningIcon);
        }
        
        // Increment detection count
        detectionCount++;
        chrome.storage.local.set({ detectionCount });
    } else {
        // Remove highlighting if no sensitive data
        input.classList.remove('input-warning');
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
            const textNode = textNodes.snapshotItem(i);
            if (containsSensitiveData(textNode.textContent)) {
              const parent = textNode.parentNode;
              highlightSensitiveData(parent);
            }
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