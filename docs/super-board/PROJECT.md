# Cardify

## What it is

Cardify is an automatic flashcard generator powered by Agentic AI. Users provide source material (text, documents, URLs, or topics) and the system autonomously generates high-quality, structured flashcards — handling extraction, summarization, and formatting without manual effort.

## Stack

TBD — project is in early setup. Expected: a modern web stack (frontend + API) with an AI backbone using the Anthropic Claude API for agentic flashcard generation.

## Conventions

- Feature branches cut from `main`, squash-merged back via PR
- All features tracked as GitHub Issues on the Cardify Project board
- Specs live in `docs/superpowers/specs/<slug>-design.md`
- Task files live in `docs/superpowers/tasks/<slug>/NN-*.md`

## Success criteria

- Given any input (text, document, URL, or topic), the system generates a coherent set of flashcards
- Cards are well-structured: clear question on one side, concise answer on the other
- The agentic pipeline runs end-to-end without manual intervention
- A user can review, export, or study the generated flashcards
