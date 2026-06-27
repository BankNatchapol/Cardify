---
title: Add README.md with project overview and dev setup instructions
order: 1
depends_on_task: null
feature: document
design: docs/gstack/designs/document-design.md
plan_task: null
skills: test-driven-development, verification-before-completion
---

## Goal

A `README.md` exists at the repo root so that anyone cloning the repo can understand what Cardify is, install dependencies, run the app in dev mode, build it, and run tests — without reading source code.

## Acceptance Criteria

- [ ] `README.md` exists at the repository root
- [ ] README includes: project name and one-line description ("Automatic flashcard generator using Agentic AI"), prerequisite list (Node.js 18+, a Claude API key), installation step (`npm install`), dev command (`npm run dev`), build command (`npm run build`), test command (`npm test`), and a brief feature overview (file upload for PDF/.txt, context prompt, card format selection, encrypted API key storage)
- [ ] All commands in the README match the scripts in `package.json` exactly
- [ ] Verified: `npm test` passes without errors after the README is added

## Implementation notes

**Files:**
- Create: `README.md` (repo root)

## Out of scope

- Changelog, ADR, or wiki documentation
- CI/CD badges or status shields
- Contribution guidelines (CONTRIBUTING.md)
- API reference or architecture docs
