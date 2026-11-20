---
inclusion: always
---
# Session rituals (via the AETHER MCP server)

When the `aether` MCP server is connected:

- **At the start of a session**, call `aether_resurrect` once and summarise "where the user stopped" and the next steps before doing anything else.
- **When the user says they are stopping** (done for today, going to a meeting, goodnight), call `aether_coffin` with a one-sentence note of what was being worked on.
- Before suggesting a commit message, call `aether_oath` with it; if it is rejected, offer the three alternatives.
- When the user pastes an error, call `aether_whisper` first, then reason about the fix.
- Never call `aether_drift` with `fix: true` or `aether_exorcise` with `--apply` without asking: those change files.
