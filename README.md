# llm-data-leakage-monitor


A Chrome extension that detects and blocks sensitive data (PII, secrets, credentials, etc.) in real time using both advanced regex patterns and an offline BERT-tiny NER model, running entirely in your browser.
It helps prevent accidental data leakage when using LLMs (like ChatGPT) or any web-based ML model interface.

#Features

1. Real-time detection: Monitors all text inputs, textareas, and contenteditable fields on every web page.

2. Regex & ML-based detection: Uses both regex patterns and a quantized BERT-tiny NER model for robust detection of PII and secrets.

3. Blocks sensitive data: Automatically clears and blocks input fields containing detected sensitive data, and notifies the user.

4. Works everywhere: Functions on any website, including ChatGPT, Google Bard, and other LLM/ML web UIs.

5. Offline & private: All detection runs locally in your browser; no data is sent to any server.

6. Test & demo page: Includes a test page and scripts for evaluating detection accuracy.
