---
title: Build card review and edit UI before Anki push
order: 4
depends_on_task: 03-claude-card-generation
feature: cardify
design: docs/superpowers/specs/cardify-design.md
plan:
plan_task: Requirements 7, 9
skills: test-driven-development, verification-before-completion
---

## Goal

A Review screen shows all generated flashcards with inline editing and delete per card, a deck name input defaulting to the uploaded filename, and a Push to Anki button that passes the final confirmed card list to the next step.

## Acceptance Criteria

- [ ] After generation, the app navigates to `src/screens/Review.jsx` showing the full card list; each Basic card displays front and back fields, each Cloze card displays the cloze text field
- [ ] Every card has an inline edit mode: clicking a field makes it a `<textarea>` that saves on blur; edited content is reflected immediately in the card list without a page reload
- [ ] Every card has a Delete button; clicking it removes the card from the list with an undo snackbar (5 s timeout) that restores it; the card count in the header updates immediately
- [ ] A deck name input at the top of the Review screen is pre-populated with the uploaded filename (without extension) and is editable; the Push to Anki button is disabled when the deck name is empty
- [ ] Clicking "Back to Upload" from the Review screen returns to the Upload screen with the previous file and context prompt still populated (no data loss on back-navigation)

## Implementation notes

**Files:**
- Create: `src/screens/Review.jsx` — receives `{ cards: Array<{front,back,type}|{text,type}>, fileName }` as props from `App.jsx`; manages local `cards` state for edits and deletes; renders deck name input and Push to Anki button (wired up in Task 5); shows card count in header
- Create: `src/components/CardEditor.jsx` — renders one card; props: `card`, `onUpdate(updatedCard)`, `onDelete()`; Basic shows two textareas (front/back), Cloze shows one textarea (text); edit-on-click with save-on-blur
- Create: `src/components/DeckNameInput.jsx` — controlled input with label "Deck name"; props: `value`, `onChange`; trims whitespace on blur
- Create: `src/components/UndoSnackbar.jsx` — shows "Card deleted. Undo?" with 5 s countdown; props: `onUndo`, `onDismiss`
- Modify: `src/App.jsx` — pass `cards` array and `fileName` to Review screen; handle back-navigation state (keep Upload form values in App state)

**Interfaces:**
- Consumes: `cards` array from Task 3 `generate-cards` IPC result; `fileName` from Upload screen state
- Produces: confirmed `{ deckName: string, cards: Array }` passed to Push to Anki handler (Task 5) via `onPush(deckName, cards)` prop callback

## Out of scope

- Regenerating individual cards via Claude (manual editing only)
- Reordering cards via drag-and-drop
- Card preview in Anki format / HTML rendering
- Bulk delete or select-all
