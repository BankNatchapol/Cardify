# Cardify

Automatic flashcard generator using Agentic AI.

Cardify is a desktop application that turns your study materials — PDFs, plain text files, or pasted content — into Anki flashcards powered by Claude AI. Upload a file, optionally add context, choose a card format, review and edit the generated cards, then push them straight to Anki with one click.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 31 |
| UI | React 18 + Vite |
| AI | Anthropic Claude (via `@anthropic-ai/sdk`) |
| PDF parsing | `pdf-parse` |
| Flashcard export | AnkiConnect (local HTTP API) |
| Tests | Jest 29 |

---

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **A Claude API key** — [console.anthropic.com](https://console.anthropic.com)
- **Anki** with the **AnkiConnect** add-on installed (required only for pushing cards to Anki)
  - Add-on code: `2055492159`
  - AnkiConnect must be running (Anki must be open) when you push cards

---

## Installation

```bash
npm install
```

---

## Running in Development

```bash
npm run dev
```

This starts the Vite dev server and Electron together. Hot-reload is active for the React UI.

---

## Building for Production

```bash
npm run build
```

Produces a distributable desktop application via `electron-builder`.

---

## Running Tests

```bash
npm test
```

Runs the Jest test suite.

---

## How to Use

1. **Open Cardify** — launch via `npm run dev` or the built app.
2. **Upload a file** — drag and drop or browse for a `.pdf` or `.txt` file, or paste text directly.
3. **Add context (optional)** — describe what the material is about or specify the difficulty level.
4. **Select a card format** — choose from Basic, Cloze, or Q&A styles.
5. **Generate cards** — Claude reads your content and creates flashcard candidates.
6. **Review and edit** — approve, edit, or discard individual cards in the review screen.
7. **Push to Anki** — enter a deck name and click "Push to Anki". Cards appear in Anki immediately.

---

## Settings

Open **Settings** from the sidebar to configure:

- **Claude API key** — stored encrypted on your local machine; never sent anywhere except Anthropic's API.

---

## Screenshots

_Screenshots will be added in a future update._

---

## License

MIT
