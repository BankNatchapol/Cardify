# Document (README)

**Mode:** Quick fix
**Date:** 2026-06-27

## Change

Add a `README.md` to the repo root that gives any new contributor or user enough context to understand what Cardify is, how to run it, and how to contribute.

## Affected Files

- `README.md` (new) — root of repo
- `package.json:1` — app name, description, scripts
- `electron/main.js:1` — entry point, IPC surface
- `electron-builder.config.js:1` — build targets (macOS dmg/zip)
- `src/App.jsx:1` — screen routing (Upload, Settings)
- `src/screens/Upload.jsx:1` — file upload + parse + generate flow
- `src/screens/Settings.jsx:1` — Claude API key management

## Out of Scope

- Documentation beyond the README (changelogs, ADRs, wikis)
- Badges, CI status indicators
- API reference docs
