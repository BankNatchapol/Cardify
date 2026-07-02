# Cardify

Automatic flashcard generation for Anki.

Cardify is a desktop app that turns PDFs and plain-text files into editable Anki cards. It uses your local Claude Code login by default, generates a deck overview plus flashcards, saves each generation as a reusable project, and pushes reviewed cards to Anki through AnkiConnect.

Generated card fields use concise markdown by default. Cardify previews that markdown during review and converts it to safe HTML when pushing to Anki, so bold text, lists, tables, code, quotes, and limited semantic color highlights render visually instead of appearing as raw markdown.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron 31 |
| UI | React 18 + Vite |
| AI | Claude Code CLI, with optional Anthropic API-key fallback |
| PDF parsing | `pdf-parse` |
| Flashcard export | AnkiConnect local HTTP API |
| Tests | Jest 29 |

## Prerequisites

- Node.js 18+
- Claude Code installed and authenticated:

```bash
claude auth login
```

- Anki desktop, if you want to push cards into Anki.
- AnkiConnect add-on installed in Anki:
  - Add-on code: `2055492159`
  - Anki must stay open while Cardify pushes cards.
  - Verify AnkiConnect at `http://localhost:8765`; it should show `AnkiConnect v.5`.

An Anthropic API key can be saved in Settings as a fallback, but it is not required when Claude Code is connected.

## Install

```bash
npm install
```

## Run in Development

```bash
npm run dev
```

This starts Vite and Electron together.

## Build

```bash
npm run build
```

This builds the renderer and packages the Electron app with `electron-builder`.

## Test

```bash
npm test
```

## Workflow

1. Open Cardify.
2. Upload a `.pdf` or `.txt` file.
3. Add a context prompt describing the study goal and level.
4. Choose a card format:
   - Basic: front/back cards.
   - Cloze: fill-in-the-blank cards.
5. Generate flashcards with Claude Code.
6. Review the generated deck overview.
7. Expand the generated cards section when you want to inspect or edit individual cards.
8. Push reviewed cards to Anki.

Cardify saves generated cards before Anki push, so projects can be reopened later from the Projects tab.

## Settings

Settings shows whether Claude Code is connected. If it is not connected, run:

```bash
claude auth login
```

Then return to Cardify and click Refresh in Settings.

Settings also supports an optional Claude API key fallback. API keys are encrypted with Electron `safeStorage` and are never displayed back to the renderer after saving.

## Projects

The Projects tab lists saved generations. Each project stores:

- source file metadata
- extracted text
- context prompt
- card format
- generated deck description
- generated cards

Opening a project restores the deck overview and card review state so cards can be edited, reused, or pushed later.

## Markdown Cards

Cardify asks Claude to make backs visually structured with markdown where useful while keeping fronts concise. Supported generated formatting includes:

```markdown
**Key idea:** enzymes lower activation energy.

- <span class="cf-key">Important</span>: active sites are shape-specific.
- <span class="cf-warning">Watch out</span>: enzymes are not consumed.
```

Allowed semantic color tags are `<mark>`, `<span class="cf-key">`, `<span class="cf-warning">`, `<span class="cf-success">`, and `<span class="cf-muted">`. Unsafe HTML and arbitrary styling are stripped before previewing or pushing to Anki.

## External Thai Refinement

Cardify includes an external Gemini-based utility for polishing Thai wording in generated card JSON. It is not wired into the desktop UI yet and does not store Gemini API keys.

```bash
GEMINI_API_KEY=... npm run refine:thai -- --input deck.json --output deck.refined.json
```

You can also put Gemini settings in `.env.local`:

```bash
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_CHUNK_SIZE=10
GEMINI_STYLE_EXAMPLES=3
GEMINI_RECENT_EXAMPLES=3
GEMINI_THINKING_LEVEL=minimal
GEMINI_RETRY_ATTEMPTS=4
GEMINI_RETRY_BASE_MS=1000
GEMINI_RETRY_MAX_MS=30000
```

`GEMINI_THINKING_LEVEL` is optional for Gemini 3+ models. Use `minimal`, `low`, `medium`, or `high`. `minimal` is usually enough for Thai wording cleanup. `GEMINI_THINKING_BUDGET` is still supported for legacy Gemini 2.5 models only.

Gemini requests retry transient failures such as rate limits (`429`) and server overloads (`503`). If Gemini sends `Retry-After`, Cardify respects it; otherwise it uses exponential backoff from `GEMINI_RETRY_BASE_MS` up to `GEMINI_RETRY_MAX_MS`.

While running, the CLI prints progress to stderr without logging card content or API keys:

```text
Gemini Thai refinement: 150 cards in 15 chunks (10/chunk) using gemini-3.1-flash-lite
Gemini chunk 1/15: refining cards 1-10 of 150
Gemini chunk 1/15: complete (10/150 cards, 12.4s)
```

Use `--quiet` to hide progress logs.

The utility reads Cardify project JSON, raw card arrays, or `{ "projects": [...] }` files. It refines cards in chunks, preserves the original JSON shape, and writes a new file unless `--in-place` is passed. Completed chunks are also checkpointed beside the output file in a sibling folder such as `deck.refined.chunks/`, including individual `chunk-001-of-015.json` files and a rolling `partial.refined.json`. Each Gemini request includes deck context, up to 3 style anchor cards, and up to 3 recently refined cards to keep Thai terminology consistent across chunks.

Options:

```bash
npm run refine:thai -- --input cardify-projects.json --output refined.json --project-id project-id
npm run refine:thai -- --input deck.json --output deck.refined.json --model gemini-3.1-flash-lite --chunk-size 10
npm run refine:thai -- --input deck.json --output deck.refined.json --style-examples 3 --recent-examples 3
npm run refine:thai -- --input deck.json --output deck.refined.json --thinking-level minimal
npm run refine:thai -- --input deck.json --output deck.refined.json --retry-attempts 4 --retry-base-ms 1000 --retry-max-ms 30000
npm run refine:thai -- --input deck.json --output deck.refined.json --chunk-output-dir deck-refinement-chunks
npm run refine:thai -- --input deck.json --output deck.refined.json --quiet
```

## External ElevenLabs Audio

Cardify includes an external ElevenLabs utility for generating Chinese audio clips from exported deck JSON. It is not wired into the desktop UI yet, and it does not mutate the input JSON.

```bash
ELEVENLABS_API_KEY=... npm run audio:elevenlabs -- --input decks/HSK1.refined.json --voice-id 5ncWmV8ucTKnJsg8AQLM --limit 3
```

You can also put settings in `.env.local`:

```bash
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=5ncWmV8ucTKnJsg8AQLM
ELEVENLABS_MODEL_ID=eleven_v3
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
ELEVENLABS_SPEED=1.0
ELEVENLABS_CONCURRENCY=2
```

The utility extracts one audio target from each card front and one target from each Chinese example sentence in the back. It strips markdown/semantic tags before sending text to ElevenLabs, skips pinyin and Thai lines, and writes MP3 files plus `manifest.json` into a sibling folder such as `decks/HSK1.refined.audio/`.

Front audio targets are sent with a trailing Chinese full stop when they do not already end with sentence punctuation, so short one-word prompts like `爱` are generated as `爱。` for more natural TTS phrasing.

`ELEVENLABS_SPEED` is optional. ElevenLabs supports `0.7` to slow speech down through `1.2` to speed it up; `1.0` is normal speed.

Useful commands:

```bash
npm run audio:elevenlabs -- --input decks/HSK1.refined.json --dry-run
npm run audio:elevenlabs -- --input decks/HSK1.refined.json --only front
npm run audio:elevenlabs -- --input decks/HSK1.refined.json --only examples --limit 10
npm run audio:elevenlabs -- --input decks/HSK1.refined.json --speed 0.9 --limit 10
npm run audio:elevenlabs -- --input decks/HSK1.refined.json --force
```

## Local OmniVoice TTS Lab

Cardify includes a standalone OmniVoice test lab for trying local text-to-speech before wiring audio into the desktop app.

```bash
npm run tts:setup
npm run tts:smoke -- --sample cardify --num-step 16
npm run tts:ui
```

The lab lives in `tools/omnivoice-lab/`, clones `k2-fsa/OmniVoice`, uses a Python 3.12 virtualenv, runs on Apple Silicon MPS by default, and saves generated WAV files under `tools/omnivoice-lab/outputs/`.

## AnkiConnect Setup

1. Open Anki desktop.
2. Go to `Tools` -> `Add-ons`.
3. Click `Get Add-ons...` or `Browse & Install`.
4. Paste the add-on code:

```text
2055492159
```

5. Restart Anki.
6. Keep Anki open.
7. Visit `http://localhost:8765` in a browser to verify AnkiConnect is running.

If Cardify says Anki is not running, this usually means Anki is closed, AnkiConnect is not installed, or Anki has not been restarted since installing the add-on.

## Claude Code Timeout

Large decks can take several minutes. Cardify waits up to 20 minutes for each Claude Code generation by default.
Normal-sized decks are sent as one source when possible; very large sources are split only when they exceed the app's larger safety budget.

Override it with:

```bash
CARDIFY_CLAUDE_CODE_TIMEOUT_MS=1800000 npm run dev
```

The value is in milliseconds.

## Notes

- Build output in `dist/` is ignored.
- Local Claude helper folders under `.claude/bin`, `.claude/skills`, and `.claude/workflows` are ignored.
- The app currently supports `.pdf` and `.txt` uploads.

## Future Work

- Thai-language output can still be awkward or inconsistent. A possible future improvement is adding an optional Gemini text-refinement pass to polish Thai explanations and translations after card generation.

## License

MIT
