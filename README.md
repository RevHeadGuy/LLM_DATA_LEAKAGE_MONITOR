# LLM Data Leakage Monitor

A Chrome browser extension that prevents accidental sensitive data leakage into LLM tools and AI chat interfaces by intercepting text before it is submitted.

Detection runs in two layers — fast regex patterns followed by a local offline BERT-tiny ONNX model — entirely inside the browser. No data is ever sent to an external server.

---

## Features

### Detection
- Monitors text inputs, textareas, and contenteditable elements in real time
- Intercepts typing, paste, drag-and-drop, and form submission
- **Layer 1 — Regex** — 26 patterns covering 15+ categories:
  - Email addresses, phone numbers, SSNs
  - Credit card numbers (Visa, MC, Amex, Discover)
  - AWS / Google API keys, JWTs, PEM private keys
  - Database connection strings (MongoDB, PostgreSQL, MySQL, Redis…)
  - OAuth / bearer tokens, secret keys, access tokens
  - Medical record numbers, employee IDs, driver's licenses, passports
  - "My name is…" / "My password is…" phrase patterns
- **Layer 2 — BERT NER** — offline TinyBERT ONNX model detects named entities (persons, locations, organisations) that regex would miss
- On detection: **Block** mode clears and resets the field; **Warn** mode highlights it amber

### Dashboard (full-page UI)
Open via the popup or directly at the extension's `dashboard.html`:
- **Impressive animated header** with a shimmer sweep, gradient title, and "Protection Active" pill
- **6 live stat cards** — each with a 7-day sparkline trend chart and animated number counter:
  - Total Blocked, Total Warned, Today (last 24 h), Sites Protected, BERT Detections, Top Category
- **Activity timeline** — smooth Bézier area chart for the last 24 hours (hourly buckets)
- **Top Categories bar chart** — shows which data types are most frequently detected
- **Detection Method donut** — Regex vs BERT split with percentages
- **Top Targeted Domains bar chart**
- **Event Log page** — full history (up to 200 events) with:
  - Color-coded rows (red border = blocked, amber = warned)
  - Click-to-expand row detail (timestamp, method, category, domain, source)
  - Filters by action, method, category, domain
  - CSV export with "Exporting… → Done ✓" feedback
  - Clear all button
- **Settings page** — mode selector, domain allowlist, extension status card
- **About page** — architecture info and numbered detection pipeline walkthrough
- **Last-updated timestamp** refreshes every 30 seconds
- **Sidebar event count badge** shows total events without opening the log
- **Quick on/off toggle** in sidebar — switch detection on/off without opening Settings

### Popup
Compact quick-access panel:
- Model status indicator (Loaded ✓ / Loading… / Failed ✗)
- Blocked / Warned / Today stat counters
- One-click mode toggle buttons (Block / Warn / Off)
- 5 most recent detections mini-list with time-ago labels
- **Open Full Dashboard** button

---

## Project Structure

```
manifest.json               Chrome MV3 extension manifest
background.js               Service worker — lifecycle + model status relay
content.js                  Content script — detection, blocking, event logging
popup.html / popup.js       Compact popup UI
dashboard.html              Full-page dashboard (HTML structure + CSS)
dashboard.js                Dashboard logic — charts, table, settings, animations
test_page.html              Demo page for manual testing
test_regex_detection.js     Node.js automated test runner (regex + BERT)
test_questions.json         200 labelled test cases
download_model.py           Downloads the quantized BERT ONNX model from HuggingFace
web_model/bert-tiny-ner/    Local ONNX model files
wasm/                       ONNX Runtime WebAssembly binaries
libs/
  transformers.min.js       Bundled local copy of @xenova/transformers v2
  page-injected-module.js   ES module injected into page context to run BERT inference
```

---

## Requirements

- Google Chrome or any Chromium-based browser
- Node.js and npm (for the automated test script)
- Python 3 and pip (for downloading the BERT model)

---

## Installation

**1. Clone or download the repository**

**2. Install JavaScript dependencies**
```bash
npm install
```

**3. Install the Python model downloader dependency**
```bash
python -m pip install huggingface_hub
```

**4. Download the local BERT ONNX model**
```bash
python download_model.py
```

This downloads the quantized TinyBERT NER model from HuggingFace and places it under `web_model/bert-tiny-ner/onnx/model_quantized.onnx`. The script also automatically renames the file if an older dot-separator version (`model.quantized.onnx`) is present.

**5. Load the extension in Chrome**
1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select this project folder
5. The extension icon appears in your toolbar

---

## Usage

Once loaded the extension monitors every page automatically.

- **Type** sensitive text into any input field — it will be blocked or warned immediately
- **Paste** or **drag** sensitive content — blocked synchronously for regex hits; field is cleared for BERT-only hits after inference
- **Submit a form** — all fields are checked before submission proceeds

Click the extension icon to open the popup. From there click **Open Full Dashboard** to see the full analytics view.

### Detection modes

| Mode | Behaviour |
|---|---|
| **Block** (default) | Clears the field and shows a red toast |
| **Warn** | Highlights the field amber and shows a warning toast |
| **Off** | Disables all detection |

Switch modes from the popup, the sidebar quick toggle, or the Settings page.

### Domain allowlist

Add trusted domains (e.g. `localhost`, `internal.corp`) in Settings → Domain Allowlist. The extension stays silent on those domains.

---

## Testing

**Manual** — open `test_page.html` in Chrome and type sensitive values:
- `test@example.com` — email
- `AKIA1234567890ABCDEF` — AWS key
- `My SSN is 123-45-6789`
- `sk-abcdefghijklmnopqrstuvwxyz123456` — secret key

**Automated** — runs all 200 labelled test cases through regex + BERT:
```bash
node test_regex_detection.js
```

The script prints a full accuracy report. Results reflect the same regex patterns and BERT logic used in the live extension.

If you see a model-not-found error, re-run:
```bash
python download_model.py
```

---

## Architecture

```
User types / pastes text
        │
        ▼
  content.js  ──►  Regex check (26 patterns, instant)
        │                │
        │          Match found?  ──► block / warn
        │
        ▼  (if regex clean)
  CustomEvent 'llm-pii-check'
        │
        ▼
  page-injected-module.js  ──►  TinyBERT ONNX inference (offline, in page context)
        │
  CustomEvent 'llm-pii-result'
        │
        ▼
  content.js  ──►  block / warn  ──►  saveBlockedEvent → chrome.storage.local
                                              │
                                    ┌─────────┴──────────┐
                              popup.js              dashboard.js
                         (quick stats)        (full analytics UI)
```

**Why page-injected-module.js and not background.js for inference?**
Chrome MV3 service workers cannot spawn `blob:` Web Workers, which ONNX Runtime WebAssembly requires for multi-threaded inference. The model therefore runs in the page's JS context where blob workers are fully supported. The background service worker only handles lifecycle events and model status storage.

---

## Bug fixes applied (v1.6)

| Issue | Fix |
|---|---|
| `background.js` imported from CDN URL — forbidden in MV3 | Replaced with local `./libs/transformers.min.js` |
| Service worker crashed on load | Removed all model loading from service worker |
| Wrong entity group tags (`PER`, `ORG`…) | Model uses `LABEL_0`–`LABEL_8`; detection logic updated |
| Over-broad driver's license / passport regex | Patterns now require full label prefix |
| API key patterns didn't match `"is"` keyword | Updated to accept `:`, `=`, or `is` |
| Async `e.preventDefault()` too late for paste/drop | Regex hits cancel synchronously; BERT hits clear field after inference |
| `env.cache = false` was a no-op | Replaced with `env.useBrowserCache = false` |
| `libs/set-globals.js` was dead code | Deleted |
| Popup inline `<script>` violated MV3 CSP | Extracted to `popup.js` |
| ONNX model filename mismatch (`model.quantized.onnx` vs `model_quantized.onnx`) | Renamed on disk; `download_model.py` handles it automatically |

---

## Privacy

- No data is uploaded to any external API
- All inference runs locally via ONNX Runtime WebAssembly
- Event history is stored only in `chrome.storage.local` on your machine
- The extension makes zero outbound network requests during normal operation
