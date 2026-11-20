---
inclusion: always
---
# Output style

- Header via `header(icon, title, subtitle)`; separators via `rule()`; messages via `ok / warn / fail / note / step` from `src/lib/ui.ts`.
- Palette: violet = brand/headers · green = success · red = danger/zombies · amber = warnings · cyan = info.
- Tone: spooky *flavour*, precise *content*. File paths always `file:line`. Never hide uncertainty — label findings `high` / `medium` confidence.
- Exit codes: 0 ok · 1 problem found / blocked (usable in CI and git hooks).
