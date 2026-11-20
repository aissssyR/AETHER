import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { spawnSync } from "child_process";
import { suggestCommitMessages } from "../services/ai";
import * as G from "../lib/git";
import { theme, header, ok, warn, fail, note, step, rule, hasAI, noAIHint, type ExitCode } from "../lib/ui";

import { validateCommit, suggestFromFiles, type Verdict } from "../core/oath";
export { validateCommit, suggestFromFiles, type Verdict };

// ─── Local suggestions (diff-aware, no AI needed) ──────────────────────────────

function localSuggestions(weak: string): string[] {
  return suggestFromFiles(weak, G.isRepo() ? G.changedFiles() : []);
}

async function getSuggestions(weak: string): Promise<string[]> {
  if (hasAI()) {
    step("Summoning the AI ghost for better offerings…");
    try {
      const diff = G.isRepo() ? G.diffHead() : "";
      const ai = await suggestCommitMessages(weak, diff);
      if (ai) return ai;
    } catch (err) {
      warn(`AI unavailable (${err instanceof Error ? err.message : String(err)}) — using local suggestions.`);
    }
  } else noAIHint("suggestions derived from your changed files");
  return localSuggestions(weak);
}

// ─── Interactive prompt ────────────────────────────────────────────────────────

const CURSE = "Cursed-By: aether (weak oath — marked as technical debt)";

function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim().toLowerCase()); }));
}

type Choice = { kind: "pick"; message: string } | { kind: "force" } | { kind: "quit" };

async function choose(suggestions: string[]): Promise<Choice> {
  const a = await ask(theme.dim(`\n  Pick [1-${suggestions.length}], ${theme.warn("f")}orce (adds a curse), or ${theme.bad("q")}uit › `));
  const n = Number(a);
  if (n >= 1 && n <= suggestions.length) return { kind: "pick", message: suggestions[n - 1] };
  if (a === "f" || a === "force") return { kind: "force" };
  return { kind: "quit" };
}

function printRejection(message: string, reason: string): void {
  header("🩸", "THE OATH", "Weak oaths are rejected by the spirits", theme.bad);
  console.log(theme.bad.bold("  👻 The Code Spirits are displeased."));
  console.log(theme.bad(`     "${message}" is not an acceptable sacrifice.`));
  console.log(theme.dim(`     Reason: ${reason}`));
  console.log();
}

function printSuggestions(list: string[]): void {
  list.forEach((s, i) => console.log(`  ${theme.brand.bold(`[${i + 1}]`)} ${theme.text(s)}`));
}

function commit(message: string, curse: boolean): ExitCode {
  const args = ["commit", "-m", message];
  // A forced commit was already adjudicated here — skip our own commit-msg hook so it isn't judged twice.
  if (curse) args.push("-m", CURSE, "--no-verify");
  const r = spawnSync("git", args, { encoding: "utf-8" });
  if (r.status === 0) {
    ok(theme.ok.bold("Committed.") + theme.dim("  " + (r.stdout.split("\n")[0] ?? "")));
    return 0;
  }
  const out = `${r.stdout}${r.stderr}`;
  if (/nothing (added )?to commit|no changes added/i.test(out)) warn("Nothing staged. Run `git add <files>` first.");
  else if (/not a git repository/i.test(out)) warn("Not a git repository — nothing was committed.");
  else fail(out.trim().split("\n")[0] || "git commit failed");
  return 1;
}

// ─── Core: manual mode ─────────────────────────────────────────────────────────

export interface OathOptions {
  commit?: boolean;
  strict?: boolean;
  force?: boolean;
}

export async function runOath(message: string, opts: OathOptions = {}): Promise<ExitCode> {
  const verdict = validateCommit(message, opts.strict);
  const doCommit = opts.commit !== false;

  if (verdict.passed) {
    header("🩸", "THE OATH", "The spirits weigh your words", theme.ok);
    ok(theme.ok.bold("The spirits accept your oath.") + theme.dim(`  "${message}"`));
    return doCommit ? commit(message, false) : 0;
  }

  if (opts.force) {
    printRejection(message, verdict.reason);
    warn("Forced. The spirits will remember this.");
    return doCommit ? commit(message, true) : 0;
  }

  printRejection(message, verdict.reason);
  rule();
  const suggestions = await getSuggestions(message);
  console.log();
  console.log(theme.brand.bold("  The spirits offer these instead:\n"));
  printSuggestions(suggestions);

  if (process.stdin.isTTY && doCommit) {
    const c = await choose(suggestions);
    if (c.kind === "pick") return commit(c.message, false);
    if (c.kind === "force") return commit(message, true);
  } else {
    console.log();
    note('Re-run with a better message, or:  aether oath "<message>" --force');
  }
  console.log();
  return 1;
}

// ─── Core: git hook mode (commit-msg) ──────────────────────────────────────────

async function runHook(msgFile: string, strict: boolean): Promise<ExitCode> {
  let raw: string;
  try {
    raw = fs.readFileSync(msgFile, "utf-8");
  } catch {
    return 0; // never block a commit because we can't read the file
  }
  const lines = raw.split("\n");
  const idx = lines.findIndex((l) => l.trim() && !l.startsWith("#"));
  if (idx === -1) return 0;
  const message = lines[idx].trim();
  const verdict = validateCommit(message, strict);
  if (verdict.passed) return 0;

  printRejection(message, verdict.reason);
  const suggestions = await getSuggestions(message);
  console.log();
  printSuggestions(suggestions);

  if (!process.stdin.isTTY) {
    console.log();
    note("Commit blocked. Amend the message (or `git commit --no-verify` to bypass).");
    return 1;
  }
  const c = await choose(suggestions);
  if (c.kind === "quit") return 1;
  if (c.kind === "pick") lines[idx] = c.message;
  else lines.splice(idx + 1, 0, "", CURSE);
  fs.writeFileSync(msgFile, lines.join("\n"));
  return 0;
}

// ─── Hook installer ────────────────────────────────────────────────────────────

const MARKER = "# aether-oath-hook";

function hookPath(): string | null {
  const p = G.git(["rev-parse", "--git-path", "hooks/commit-msg"]);
  return p ? path.resolve(p) : null;
}

function installHook(): ExitCode {
  header("🪝", "OATH HOOK", "Guarding your git history", theme.accent);
  const target = hookPath();
  if (!target) { fail("Not inside a git repository."); return 1; }
  if (fs.existsSync(target) && !fs.readFileSync(target, "utf-8").includes(MARKER)) {
    fail(`A different commit-msg hook already exists:\n     ${target}`);
    note("Back it up or merge manually, then re-run.");
    return 1;
  }
  const cli = fs.realpathSync(process.argv[1]).replace(/\\/g, "/");
  const node = process.execPath.replace(/\\/g, "/");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `#!/bin/sh\n${MARKER}\nexec "${node}" "${cli}" oath --hook "$1"\n`, { mode: 0o755 });
  ok(`Installed ${theme.dim(target)}`);
  note('Try it:  git commit --allow-empty -m "fix bug"');
  console.log();
  return 0;
}

function uninstallHook(): ExitCode {
  const target = hookPath();
  if (target && fs.existsSync(target) && fs.readFileSync(target, "utf-8").includes(MARKER)) {
    fs.unlinkSync(target);
    ok("Oath hook removed.");
    return 0;
  }
  warn("No AETHER hook found.");
  return 0;
}

export const oathCommand = new Command("oath")
  .description("🩸 Judge a commit message; weak oaths are rejected (also a git hook)")
  .argument("[message...]", "proposed commit message")
  .option("--no-commit", "validate only, do not run git commit")
  .option("--strict", "require Conventional Commits format")
  .option("-f, --force", "commit a weak message anyway (adds a curse trailer)")
  .option("--install-hook", "install a commit-msg hook in this repo")
  .option("--uninstall-hook", "remove the hook")
  .option("--hook <file>", "internal: run as a commit-msg hook")
  .action(async (parts: string[], o: OathOptions & { installHook?: boolean; uninstallHook?: boolean; hook?: string }) => {
    if (o.installHook) { process.exitCode = installHook(); return; }
    if (o.uninstallHook) { process.exitCode = uninstallHook(); return; }
    if (o.hook) { process.exitCode = await runHook(o.hook, !!o.strict); return; }
    const message = parts.join(" ").trim();
    if (!message) { warn('Usage: aether oath "<commit message>"'); process.exitCode = 1; return; }
    process.exitCode = await runOath(message, o);
  });
