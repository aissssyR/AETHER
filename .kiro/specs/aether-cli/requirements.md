# Requirements — AETHER CLI

## R1 Cryostasis (coffin / resurrect)
1. WHEN the user runs `aether coffin "<note>"` THE SYSTEM SHALL record branch, HEAD, changed files and the first changed line of each file, and write `COFFIN.md` + `.aether/coffin.json`.
2. WHEN uncommitted tracked changes exist THE SYSTEM SHALL preserve them with `git stash create`/`store` WITHOUT modifying the working tree.
3. WHEN an API key is configured THE SYSTEM SHALL ask the model for a 2–3 sentence summary and 3 next steps; OTHERWISE it SHALL derive them locally.
4. WHEN the user runs `aether resurrect` THE SYSTEM SHALL show the summary, next steps and files in flight, and warn if the branch or HEAD changed.
5. WHEN `--open` is given THE SYSTEM SHALL reopen files at their last-edit line (`code -g`, `kiro -g` or `$EDITOR`).
6. WHEN `--apply` is given AND the working tree is clean THE SYSTEM SHALL restore the stash; OTHERWISE it SHALL refuse.

## R2 DeadCode Hunter (sweep)
1. THE SYSTEM SHALL index every identifier across the project (comments removed) and report functions/classes with zero references, with `file:line`.
2. THE SYSTEM SHALL report JS/TS files that are never imported, excluding entry points.
3. THE SYSTEM SHALL label findings `high` (not exported) or `medium` (exported/orphan) and state that analysis is textual.
4. WHEN `--fail-on-dead` is set AND a high finding exists THE SYSTEM SHALL exit 1.

## R3 Zombie Dependency Exorcist (exorcise)
1. THE SYSTEM SHALL read `package.json` and `requirements.txt` and match a built-in zombie database (deprecated / legacy / security).
2. THE SYSTEM SHALL show every import site (`file:line`) of each zombie.
3. WHEN `--online` is set THE SYSTEM SHALL query the npm registry for deprecation flags and packages unpublished for ≥ 3 years.
4. WHEN `--rewrite` is set THE SYSTEM SHALL have the model rewrite each importing file and a test file, saved under `.aether/exorcism/`.
5. WHEN `--apply` is set THE SYSTEM SHALL overwrite only files that are clean in git (or `--force`) and pass `node --check`.

## R4 Error Translator (whisper)
1. THE SYSTEM SHALL accept the error as an argument or from piped stdin.
2. THE SYSTEM SHALL translate common PHP/JS/Python/TS/git/npm/network errors offline, extracting names from the message.

## R5 Cursed Commit Hook (oath)
1. THE SYSTEM SHALL reject messages whose *meaningful* words are missing ("fix bug", "wip") and accept specific ones ("fix: resolve null pointer in AuthController").
2. WHEN rejected THE SYSTEM SHALL offer 3 alternatives (AI from the diff, or local from changed files), each of which passes the validator.
3. THE SYSTEM SHALL NEVER interpret the message as shell syntax.
4. `--install-hook` SHALL install a `commit-msg` hook; `--force` SHALL commit with a `Cursed-By:` trailer.

## R6 Config Drift Detector (drift)
1. THE SYSTEM SHALL compare all `.env*` files and the variables read from code, and report keys missing from `.env.example`.
2. THE SYSTEM SHALL flag real-looking secrets inside `.env.example`.
3. WHEN `--fix` is set THE SYSTEM SHALL add missing keys to `.env.example`, always blanking secret values.
4. WHEN `--ci` is set AND drift errors exist THE SYSTEM SHALL exit 1.

## R7 Natural language (ask)
1. THE SYSTEM SHALL map plain English to one ritual via the model, and via a weighted offline router when no key or on failure.

## R8 MCP server (mcp)
1. WHEN the user runs `aether mcp` THE SYSTEM SHALL speak MCP over stdio (newline-delimited JSON-RPC 2.0) and answer `initialize`, `ping`, `tools/list` and `tools/call`.
2. THE SYSTEM SHALL expose seven tools (`aether_coffin`, `_resurrect`, `_sweep`, `_drift`, `_exorcise`, `_whisper`, `_oath`), each executed with an argv array — never a shell string.
3. THE SYSTEM SHALL NOT respond to notifications, and SHALL return JSON-RPC errors for unknown tools and methods.

## R9 Browser playground
1. THE SYSTEM SHALL bundle the pure engines in `src/core` for the browser (`docs/engine.js`) so the playground runs the same code as the CLI.
2. THE SYSTEM SHALL run entirely client-side and upload nothing.
3. THE SYSTEM SHALL provide an interactive terminal (`docs/terminal.html`): a virtual shell over an in-memory project supporting `aether <ritual>`, natural language, `git status/add/commit/log` (with the oath hook), `ls`, `cat`, `echo >>`, history, Tab completion; output SHALL be HTML-escaped.

## R10 Property-based testing
1. THE SYSTEM SHALL check with fast-check that: validators are total; every `oath` suggestion passes the validator; `parseEnv` round-trips; no secret value ever reaches a generated `.env.example`; a referenced function is never reported dead.
