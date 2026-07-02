#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .venv/bin/activate ]]; then
  echo "Missing .venv. Run tools/omnivoice-lab/setup.sh first." >&2
  exit 1
fi

source .venv/bin/activate
export HF_HOME="${HF_HOME:-$SCRIPT_DIR/.cache/huggingface}"
export TORCH_HOME="${TORCH_HOME:-$SCRIPT_DIR/.cache/torch}"

python tts_lab.py \
  --host "${HOST:-127.0.0.1}" \
  --port "${PORT:-8001}" \
  "$@"
