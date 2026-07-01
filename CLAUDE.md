# Agent notes

## SuperSaiyan pipeline paths

| Artifact | Path |
|----------|------|
| Feature specs | `docs/superpowers/specs/<slug>-design.md` |
| Board tasks | `docs/superpowers/tasks/<slug>/NN-*.md` |
| Issue map | `docs/superpowers/tasks/<slug>/.issue-map.json` |
| Designs | `docs/gstack/designs/<slug>-design.md` |

When saving design docs from `/office-hours` or similar tools, also save a
copy to `docs/gstack/designs/<feature-slug>-design.md`.

<!-- agentic-dev-kit:start:agent-guidance -->
# Agentic Dev Kit: Local Token Optimization

This project uses local agent tooling installed under `/Users/banknatchapol/Desktop/Codes/Cardify/.agent-tools`.
Prefer those local binaries and project-local MCP entries over global tools.

- Use Serena for symbol search, references, and targeted code navigation before reading whole files.
- Use Context7 for external libraries, frameworks, SDKs, APIs, and configuration before guessing from memory.
- Use local RTK for noisy terminal output, especially tests, dependency installs, Git output, Docker output, and long logs.
- Use local Headroom diagnostics only through `/Users/banknatchapol/Desktop/Codes/Cardify/.agent-tools/headroom-venv/bin/headroom`.
- Use local ccusage through `npx ccusage@latest` or `/Users/banknatchapol/Desktop/Codes/Cardify/node_modules/.bin/ccusage` to measure token/cost usage.
- Preserve exact failing test names, error messages, file paths, and stack frames when summarizing compressed output.
- Do not use global installs, global hooks, `rtk init -g`, or global Headroom wrapping for this project.

<!-- agentic-dev-kit:end:agent-guidance -->
