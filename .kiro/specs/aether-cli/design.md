# Design — AETHER CLI

```
src/index.ts            Commander root, default action = natural language
src/commands/*.ts       one file per ritual: run<Name>() + thin Commander wrapper
src/commands/aether.ts  router (AI → offline weighted keywords) + direct dispatch
src/services/ai.ts      the only network code: timeout, retries=0, JSON/fence extraction
src/lib/git.ts          shell-free git helpers, diff → first changed line, stash snapshot
src/lib/scan.ts         project walker (skips node_modules, dist, .git …)
src/lib/ui.ts           theme + header/ok/warn/fail helpers
src/core/*.ts           PURE engines (whisper, oath, drift, sweep): no I/O, shared by CLI, MCP and browser
src/commands/mcp.ts     MCP stdio server; every tool spawns this CLI with an argv array
src/web.ts              browser entry → esbuild → docs/engine.js (16 KB)
docs/                   landing page + playground (static, GitHub Pages)
```

## Key decisions
- **Offline-first.** AI is a layer on top; every command works with no key and degrades silently on timeout.
- **No shell.** All process spawning uses argv arrays → message text can't inject commands (this was a real bug in v2).
- **Non-destructive snapshots.** `git stash create` + `stash store` keeps the tree untouched.
- **Honest static analysis.** `sweep` counts textual references with comments stripped; string mentions keep code alive (conservative), and findings carry a confidence level.
- **Safe rewrites.** AI output is written to `.aether/exorcism/` first; `--apply` is gated by git cleanliness and a syntax check.
- **Privacy.** `drift` sends only variable *names* to the model.
- **One engine, three surfaces.** Logic lives in `src/core` so the terminal, Kiro (via MCP) and the browser can never disagree.
- **Property-based tests on the core** found a real bug (very short file names produced suggestions our own validator rejected).
