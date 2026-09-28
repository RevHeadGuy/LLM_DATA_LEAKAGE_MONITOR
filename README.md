# LLM Data Leakage Monitor

A Chrome browser extension that helps prevent accidental data leakage into LLM tools and AI chat interfaces by detecting sensitive content before it is submitted.

It combines:
- regex-based detection for common secrets and PII
- local ML-based entity detection using a BERT-tiny ONNX model
- real-time blocking and alerting in text inputs and contenteditable fields
- user configuration for allowed domains and warning/block modes

This project runs entirely in the browser and does not send user input to a remote server.

## Features

- Detects sensitive data in real time while typing
- Monitors text inputs, textareas, and contenteditable elements
- Blocks common secret formats such as:
  - email addresses
  - SSNs and phone numbers
  - AWS and Google API keys
  - JWTs and private keys
  - database connection strings
  - password/secret-like patterns
- Uses an offline BERT-tiny model for additional PII detection
- Allows users to configure:
  - block vs warn-only mode
  - allowlist for specific domains
  - recent blocked-event log from the popup
- Protects against paste, drag/drop, and form submission leakage

## Project Structure

- `manifest.json` — Chrome extension manifest
- `background.js` — background service worker logic
- `content.js` — real-time detection and input blocking
- `popup.html` — popup UI for settings and blocked-events log
- `test_page.html` — demo page for testing detection
- `test_regex_detection.js` — Node-based detection evaluation script
- `test_questions.json` — sample inputs for testing
- `web_model/bert-tiny-ner/` — local ONNX model files
- `wasm/` — WebAssembly runtime files
- `package.json` — npm dependency list

## Requirements

- Google Chrome or Chromium-based browser
- Node.js and npm for development/testing
- Python 3 and pip for downloading the local TinyBERT model files

## Installation

1. Clone or download this repository.
2. Open a terminal in the project folder.
3. Install JavaScript dependencies:

```bash
npm install
```

4. Install the Python helper used by the model downloader:

```bash
python -m pip install huggingface_hub
```

5. Download the local ONNX model used by the extension:

```bash
python download_model.py
```

> If the model is missing or the runtime complains about `model_quantized.onnx`, re-run the command above. The repo includes a compatibility step that normalizes the downloaded file name when needed.

## Running the Extension

1. Open Chrome.
2. Go to `chrome://extensions/`.
3. Turn on Developer mode.
4. Click Load unpacked.
5. Select this project folder.
6. The extension will activate automatically on webpages.

## Usage

Once enabled:
- type into chat inputs, forms, or contenteditable fields
- if sensitive content is detected, the extension either:
  - clears the field in block mode, or
  - warns in warn-only mode
- a toast alert appears when a leak is detected

You can open the popup to:
- switch between block / warn / off modes
- add allowed domains
- review recent blocked events

## Testing

A demo page is included for manual testing:

```bash
# open the demo page directly in Chrome
```

Open `test_page.html` in your browser and try entering sensitive values.

For automated validation:

```bash
node test_regex_detection.js
```

This script loads the local TinyBERT model and evaluates the regex-based and ML-assisted detection logic against the sample questions in `test_questions.json`.

If you see a model-not-found error, make sure the local model is present under `web_model/bert-tiny-ner/onnx/` and re-run:

```bash
python download_model.py
```

## Privacy Model

The extension is designed to keep processing local:
- no data is uploaded to an external API
- model inference runs locally in the browser
- detection logic is performed on the client machine

## Notes

This project is intended as a browser-side privacy guard for AI interfaces and other web-based tools. It is best used as a proactive defense layer, not a replacement for enterprise data-loss prevention systems.

## License

This project is provided as-is for educational and security-focused usage.
