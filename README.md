# AETHER — the haunted terminal

> Resurrect your context. Bury the dead code.

AETHER is a command-line toolkit of seven small rituals for the chores every codebase postpones. It is **offline-first**: every ritual has a deterministic local engine, and the optional AI layer (Nebius, any OpenAI-compatible model) only improves the answer. Built for **Kiroween**.

**Try it in your browser** (no install): open [`docs/terminal.html`](docs/terminal.html) for an interactive terminal (a real shell over an in-memory project: type `help`), or [`docs/playground.html`](docs/playground.html) to paste your own errors, commits, `.env` files and code. Both run the real engines client-side. Landing page: [`docs/index.html`](docs/index.html). Both are static and deploy to GitHub Pages from `/docs`.

## Install

Requires Node 18+.

```bash
git clone https://github.com/YOUR-USERNAME/AETHER.git && cd AETHER
npm install && npm run build && npm link
cp .env.example .env        # optional: add NEBIUS_API_KEY for the AI layer
```

## The rituals

| Command | What it does |
|---|---|
| `aether "<anything>"` | Natural language → picks the right ritual (`--dry-run` to preview) |
| `aether coffin "<note>"` | **Cryostasis.** Saves branch, files, the exact line you last edited, a non-destructive git stash and a summary → `COFFIN.md` |
| `aether resurrect [--open] [--apply]` | Shows where you stopped and what to do next; `--open` reopens files at those lines, `--apply` restores the stash |
| `aether sweep [path] [--ai] [--json] [--fail-on-dead]` | **DeadCode Hunter.** Unreferenced functions/classes and orphan files (JS/TS/Python/PHP) with `file:line` and confidence |
| `aether exorcise [--online] [--rewrite] [--apply]` | **Zombie Dependency Exorcist.** Dead deps in `package.json`/`requirements.txt`, every import site; AI rewrites the code and a test |
| `aether whisper "<error>"` or `cmd 2>&1 \| aether whisper` | **Error Translator.** Cause + fix, 25+ patterns offline |
| `aether oath "<msg>"` · `--install-hook` | **Cursed Commit Hook.** Rejects "fix bug", offers 3 better messages, installs as a git `commit-msg` hook |
| `aether drift [--fix] [--ai] [--ci]` | **Config Drift Detector.** Compares all `.env*` files and variables read in code; generates a safe `.env.example` |
| `aether mcp` | **MCP server.** Exposes the rituals as 7 tools so Kiro can freeze/restore its own session, hunt dead code, judge commits |

## Safety

- Git is invoked without a shell — commit messages can never inject commands.
- `coffin` uses `git stash create` + `store`: your working tree is never touched.
- `exorcise --apply` only overwrites files that are clean in git (or `--force`) and that pass `node --check`; proposals always land in `.aether/exorcism/` first.
- `drift` never prints secret values, always blanks them in `.env.example`, and sends only variable *names* to the AI.
- `sweep` is textual analysis: dynamic calls and reflection can hide usages, so findings carry `high`/`medium` confidence.

## Use AETHER inside Kiro (MCP)

`.kiro/settings/mcp.json` registers the server for this workspace:

```json
{ "mcpServers": { "aether": { "command": "node", "args": ["dist/index.js", "mcp"] } } }
```

`.kiro/steering/session.md` tells Kiro to call `aether_resurrect` at the start of a session and `aether_coffin` when you stop, and `.kiro/hooks/seal-coffin.kiro.hook` is a one-click "seal the coffin" hook.

## Built with Kiro

Specs, steering, hooks and MCP config live in [`.kiro/`](.kiro): acceptance criteria in EARS format (`specs/aether-cli/requirements.md`), design decisions, tasks, four steering files and two hooks.

## Design

The site is an abstract Halloween poster: drifting aurora blobs, blood-red slash streaks, cracks at the very back, and artwork that moves (pulsing moon, swaying branch, bats crossing the sky, a spider on its thread, claw marks that slash the terminal on every click). Motion is choreographed with [GSAP](https://gsap.com) + ScrollTrigger (vendored in `docs/vendor/`, so it works offline): a word-by-word headline intro, a navigation dock whose highlight glides between links, scroll reveals and parallax, a swaying tree in section 2, and a balloon in Quick start that slowly swells, then bursts into beads (click it to pop it early). All motion respects `prefers-reduced-motion`. Artwork credits live in [`docs/assets/CREDITS.md`](docs/assets/CREDITS.md).

## Architecture

`src/core/*` holds **pure** engines (whisper, oath, drift, sweep). The CLI, the MCP server and the browser playground (`docs/engine.js`, bundled with esbuild) all run that same code.

## Development

```bash
npm run build     # tsc + bundles docs/engine.js for the browser
npm test          # 13 end-to-end + 7 property-based (fast-check) + 5 browser-terminal tests, all offline
```

MIT licensed.
