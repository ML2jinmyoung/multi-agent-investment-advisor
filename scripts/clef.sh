#!/usr/bin/env bash
# Starts a self-hosted Cloudflare Clef server (SGLang, /v1/systemone) that the app talks to via CLEF_BASE_URL.
# Clef is 27B BF16 and was tested on one H200; CLEF_MODEL_PATH=Cloudflare/clef-flash is the smaller, faster variant.
# Run on the GPU host, then set CLEF_BASE_URL=http://<host>:${CLEF_PORT} (and CLEF_MODEL to the same model path) for the app.
set -euo pipefail
CLEF_MODEL_PATH="${CLEF_MODEL_PATH:-Cloudflare/clef}"
CLEF_PORT="${CLEF_PORT:-30000}"
CLEF_IMAGE="${CLEF_IMAGE:-lmsysorg/sglang:dev-clef}"
# SGLang's --api-key makes the server require "Authorization: Bearer <key>"; the app sends CLEF_API_KEY
AUTH=()
[ -n "${CLEF_API_KEY:-}" ] && AUTH=(--api-key "$CLEF_API_KEY")
exec docker run --gpus all --shm-size 32g --ipc=host \
  -p "${CLEF_PORT}:30000" \
  -v "${HF_HOME:-$HOME/.cache/huggingface}:/root/.cache/huggingface" \
  "$CLEF_IMAGE" \
  sglang serve --model-path "$CLEF_MODEL_PATH" --host 0.0.0.0 --port 30000 "${AUTH[@]}"
