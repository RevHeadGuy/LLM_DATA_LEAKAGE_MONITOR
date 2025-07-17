# LLM_DATA_LEAKAGE_MONITOR


A Chrome extension that detects and blocks sensitive data (PII, secrets, credentials, etc.) in real time using both advanced regex patterns and an offline BERT-tiny NER model, running entirely in your browser.
It helps prevent accidental data leakage when using LLMs (like ChatGPT) or any web-based ML model interface.

# Features

1. Real-time detection: Monitors all text inputs, textareas, and contenteditable fields on every web page.

2. Regex & ML-based detection: Uses both regex patterns and a quantized BERT-tiny NER model for robust detection of PII and secrets.

3. Blocks sensitive data: Automatically clears and blocks input fields containing detected sensitive data, and notifies the user.

4. Works everywhere: Functions on any website, including ChatGPT, Google Bard, and other LLM/ML web UIs.

5. Offline & private: All detection runs locally in your browser; no data is sent to any server.

6. Test & demo page: Includes a test page and scripts for evaluating detection accuracy.

# Installation

1. Clone or Download the Repository

2. Install Dependencies :

If you want to develop or test locally: npm install

3. Load the Extension in Chrome
   
i) Open Chrome and go to chrome://extensions/

ii) Enable Developer mode (top right)

iii) Click Load unpacked

iv) Select the project folder (llm-data-leakage-monitor)

v)The extension is now active and will monitor all web pages.

# Usage

1.Just use your browser as usual!

2. If you type sensitive data (PII, secrets, etc.) into any text field, the extension will:

i)Clear the input

ii)Show a red toast notification: "Sensitive data detected! Input cleared."

3. Works on all sites, including ChatGPT and other LLM/ML web UIs.
