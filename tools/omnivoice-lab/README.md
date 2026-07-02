# Cardify OmniVoice Lab

Standalone local tester for [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice). This is not wired into Cardify Desktop yet.

## Setup

```bash
tools/omnivoice-lab/setup.sh
```

The setup script:

- clones OmniVoice into `tools/omnivoice-lab/OmniVoice`
- creates `.venv` with Python 3.12 through `uv`
- installs Apple Silicon PyTorch, torchaudio, OmniVoice, Gradio, and audio helpers
- keeps caches, outputs, the virtualenv, and the clone ignored by Git

## Run the UI

```bash
tools/omnivoice-lab/run-ui.sh
```

Open `http://127.0.0.1:8001`.

The first generation downloads the model from Hugging Face and may take a while. Generated WAV files are saved in `tools/omnivoice-lab/outputs/`.

## Smoke Test

```bash
cd tools/omnivoice-lab
source .venv/bin/activate
python smoke_test.py --sample zh --num-step 16
python smoke_test.py --sample th --num-step 16
python smoke_test.py --sample cardify --num-step 16
```

For quality comparison:

```bash
python smoke_test.py --sample zh --num-step 32
```

## Notes

- Default device is `mps` for Apple Silicon.
- Default dtype is `float16`.
- Voice design does not need reference audio.
- Voice design instructions must use OmniVoice-supported tags such as `female`, `male`, `moderate pitch`, `low pitch`, `high pitch`, `american accent`, or `british accent`.
- Voice cloning needs a 3-10 second reference audio clip and optionally a transcript.
- CPU fallback is possible with `--device cpu --dtype float32`, but it is expected to be much slower.
