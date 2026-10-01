"""
Downloads the quantized TinyBERT NER ONNX model from HuggingFace and places it
under web_model/bert-tiny-ner/ where the Chrome extension expects to find it.

@xenova/transformers v2.x looks for the model file at:
  web_model/bert-tiny-ner/onnx/model_quantized.onnx  (underscore separator)

HuggingFace Hub delivers the file with that exact name, so no rename is needed
as long as you use the allow_patterns list below.  If you already have a file
named model.quantized.onnx (dot separator) from an older download, this script
will also rename it automatically.
"""

import os
import shutil
from huggingface_hub import snapshot_download

LOCAL_DIR = "web_model/bert-tiny-ner"
ONNX_DIR = os.path.join(LOCAL_DIR, "onnx")
EXPECTED_NAME = os.path.join(ONNX_DIR, "model_quantized.onnx")   # what transformers.js expects
LEGACY_NAME   = os.path.join(ONNX_DIR, "model.quantized.onnx")   # old dot-separator name

snapshot_download(
    repo_id="onnx-community/TinyBERT-finetuned-NER-ONNX",
    local_dir=LOCAL_DIR,
    allow_patterns=[
        "onnx/model_quantized.onnx",
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "vocab.txt"
    ]
)

# ── Compatibility fix ──────────────────────────────────────────────────────────
# If the repo delivered the file with the old dot-separator name (or a previous
# download left that file behind), rename it so transformers.js can find it.
if not os.path.exists(EXPECTED_NAME) and os.path.exists(LEGACY_NAME):
    shutil.move(LEGACY_NAME, EXPECTED_NAME)
    print(f"Renamed {LEGACY_NAME} → {EXPECTED_NAME}")

if os.path.exists(EXPECTED_NAME):
    print(f"Model ready at: {EXPECTED_NAME}")
else:
    print("WARNING: model file not found after download. Check the repo or try again.")
