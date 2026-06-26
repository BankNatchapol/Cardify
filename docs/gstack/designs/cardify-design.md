# Cardify

**Mode:** Builder
**Date:** 2026-06-26
**Slug:** cardify

## Problem

Turning raw study material into useful flashcards is tedious — and every AI tool that does it today treats all learners as equivalent. They extract facts from documents mechanically, with no understanding of *why* you're studying, what level you're at, or what your exam actually tests. The result is generic cards that miss the point.

## Target User

Myself — a student who uploads raw textbooks, PDFs, or notes and wants flashcards tuned to a specific learning goal (e.g. "studying pharmacology for Step 1, focus on mechanisms of action, not brand names").

## Status Quo

Manually writing flashcards from notes, or using a generic AI tool that spits out Q&A pairs without any context. The cards cover everything equally — no prioritization, no tuning to what the exam actually tests.

## Demand Evidence

Personal pain: existing tools (Revisely, Scholarly, AnkiDecks) exist but ignore the learner's context entirely. The user already uses Anki and wants the output there directly.

## Proposed Direction

A browser/desktop app where you:
1. Upload a file (PDF or plain text)
2. Describe your context — what you're studying, your goal, your level
3. Get AI-generated flashcards tuned to that context
4. Push the deck directly into Anki via AnkiConnect

## Wedge / MVP

Upload a PDF or text file → provide a context prompt → generate flashcards via Claude API → push to Anki via AnkiConnect. One clean flow, zero friction.

## Key Premises

1. AnkiConnect (local API) is the right Phase 1 integration — free, offline, no card storage layer needed.
2. The context prompt is the core UX differentiator — front and center in the UI, not buried in settings.
3. Browser/desktop app (web app with local AnkiConnect) is the right form factor since Anki runs locally.
4. Phase 1 supports PDF + plain text only. Images, video, audio are out of scope.

## Landscape

The market is crowded at the "extract content" layer — Revisely, Scholarly, ChatPDF, Limbiks, NoteGPT, AnkiDecks all do PDF-to-cards. Most export to Anki via .apkg or AnkiConnect. None ask "why are you studying this?" before generating. Anki plugins (AnkiBrain, Smart Notes) do in-app generation but require Anki itself as the UI. Cardify's differentiation is **learning fidelity**: cards shaped to your goal, not just your document.

## Out of Scope (Phase 1)

- Built-in spaced repetition / study UI (use Anki for this)
- Image, video, or audio input
- User accounts / cloud sync
- Deck editing UI beyond what AnkiConnect provides
- Multiple AI providers (Claude API only)

## Open Questions

- What card format works best for Anki integration — Basic, Cloze, or both?
- Should the user be able to preview and edit cards before pushing to Anki?
- What's the right UI framework — plain web app (React/Vite) or Electron?
- Should context be a free-text field, or guided with structured inputs (subject, goal, level)?

## Phase 2 Vision

Full self-contained flashcard app — Cardify owns the entire study loop. Anki integration becomes optional/legacy. Built-in spaced repetition, deck management, study sessions.
