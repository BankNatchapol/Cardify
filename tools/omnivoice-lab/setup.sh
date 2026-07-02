#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_VERSION="${PYTHON_VERSION:-3.12}"
OMNIVOICE_REPO="${OMNIVOICE_REPO:-https://github.com/k2-fsa/OmniVoice.git}"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it first: https://docs.astral.sh/uv/" >&2
  exit 1
fi

if [[ ! -d OmniVoice/.git ]]; then
  git clone "$OMNIVOICE_REPO" OmniVoice
else
  echo "OmniVoice repo already exists; leaving it as-is."
fi

uv python install "$PYTHON_VERSION"
if [[ -d .venv && ! -x .venv/bin/pip ]]; then
  echo "Existing .venv is missing pip; recreating it."
  rm -rf .venv
fi
uv venv --python "$PYTHON_VERSION" --seed .venv

source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install torch==2.8.0 torchaudio==2.8.0
python -m pip install -e ./OmniVoice
python -m pip install gradio soundfile numpy

mkdir -p outputs ref-audio .cache

python - <<'PY'
import torch
print("torch:", torch.__version__)
print("mps available:", torch.backends.mps.is_available())
print("mps built:", torch.backends.mps.is_built())
PY

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo
  echo "Optional warning: ffmpeg was not found. WAV output works, but voice-cloning reference audio in mp3/m4a may fail."
  echo "Install with Homebrew if needed: brew install ffmpeg"
fi

echo
echo "Setup complete. Run: tools/omnivoice-lab/run-ui.sh"
