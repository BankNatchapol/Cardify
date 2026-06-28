# Cardify

Automatic flashcard generation for Anki.

Cardify is a desktop app that turns PDFs and plain-text files into editable Anki cards. It uses your local Claude Code login by default, generates a deck overview plus flashcards, saves each generation as a reusable project, and pushes reviewed cards to Anki through AnkiConnect.

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

Large decks can take several minutes. Cardify waits up to 10 minutes for each Claude Code generation by default.

Override it with:

```bash
CARDIFY_CLAUDE_CODE_TIMEOUT_MS=900000 npm run dev
```

The value is in milliseconds.

## Notes

- Build output in `dist/` is ignored.
- Local Claude helper folders under `.claude/bin`, `.claude/skills`, and `.claude/workflows` are ignored.
- The app currently supports `.pdf` and `.txt` uploads.

## License

MIT
