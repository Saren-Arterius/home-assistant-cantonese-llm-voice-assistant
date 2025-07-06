#!/bin/bash

set -o pipefail

if [ ! -f "/models/download-ggml-model.sh" ]; then
    wget https://raw.githubusercontent.com/ggerganov/whisper.cpp/refs/heads/master/models/download-ggml-model.sh -O /models/download-ggml-model.sh && chmod +x /models/download-ggml-model.sh
fi

if [ -z "$MODEL" ]; then
    echo "Model name not set" >&2
    exit 1
fi

if [ ! -f "/models/ggml-$MODEL.bin" ]; then
    cd /models || { echo "Could not open /models"; exit 1; }
    if ! ./download-ggml-model.sh ${MODEL}; then
        echo "Failed to download $MODEL model" >&2
        exit 1
    fi
fi
