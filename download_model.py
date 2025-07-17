from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="onnx-community/TinyBERT-finetuned-NER-ONNX",
    local_dir="web_model/bert-tiny-ner",
    allow_patterns=[
        "onnx/model_quantized.onnx",
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "vocab.txt"
    ]
)
