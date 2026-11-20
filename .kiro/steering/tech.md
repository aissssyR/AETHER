---
inclusion: always
---
# Tech rules

- Node ≥ 18, TypeScript strict, CommonJS output. **chalk must stay on v4** (v5 is ESM-only and breaks CJS on Node < 22).
- Never build shell strings. Use `execFileSync` / `spawnSync` with argv arrays (see `src/lib/git.ts`). User text is never interpreted by a shell.
- Every command exports a pure `run<Name>(...) => Promise<ExitCode>`; the Commander wrapper only sets `process.exitCode`. No `process.exit()` inside commands (the entrypoint exits once).
- AI calls go through `src/services/ai.ts` only: 25 s timeout, zero retries, `<think>` stripped, JSON parsed defensively. **Any AI failure must fall back to the local engine** — never crash.
- Secrets: values from `.env` files are never printed, logged or sent to the model (only key *names*).
- Destructive actions (`--apply`) require a clean git file or `--force`, and JS output must pass `node --check`.
- Tests: `npm test` runs end-to-end tests against throw-away git repos with `NEBIUS_API_KEY` empty.
