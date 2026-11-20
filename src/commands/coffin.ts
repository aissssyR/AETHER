import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { analyzeContext, MODEL, type ContextAnalysis } from "../services/ai";
import { localAnalysis, renderCoffinMarkdown, type CoffinFile, type CoffinData } from "../core/coffin";
export { renderCoffinMarkdown };
export type { CoffinFile, CoffinData };
import * as G from "../lib/git";
import { theme, header, ok, warn, note, step, rule, hasAI, noAIHint, type ExitCode } from "../lib/ui";

// ─── Data model (shared with `resurrect`) ──────────────────────────────────────

export const COFFIN_JSON = path.join(".aether", "coffin.json");

// ─── Local (offline) analysis ──────────────────────────────────────────────────

function resumeCommands(cwd: string): string[] {
  const cmds: string[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")) as { scripts?: Record<string, string> };
    for (const s of ["dev", "start", "test", "build"]) if (pkg.scripts?.[s]) cmds.push(s === "test" || s === "start" ? `npm ${s}` : `npm run ${s}`);
  } catch {
    /* no package.json */
  }
  if (fs.existsSync(path.join(cwd, "pytest.ini")) || fs.existsSync(path.join(cwd, "tests"))) cmds.push("pytest");
  if (fs.existsSync(path.join(cwd, "artisan"))) cmds.push("php artisan test");
  return cmds.slice(0, 3);
}

// ─── Markdown renderer ─────────────────────────────────────────────────────────

// ─── Core ritual ───────────────────────────────────────────────────────────────

export interface CoffinOptions {
  stash?: boolean;
}

export async function runCoffin(message: string, opts: CoffinOptions = {}): Promise<ExitCode> {
  const cwd = process.cwd();
  header("⚰️", "CRYOSTASIS", "Freezing your mental + physical context", theme.brand);
  note(`Directory: ${cwd}`);

  const repo = G.isRepo(cwd);
  let files: CoffinFile[] = [];
  let diff = "";
  let branch: string | null = null;
  let head: string | null = null;

  if (repo) {
    branch = G.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    head = G.git(["rev-parse", "HEAD"]);
    diff = G.diffHead();
    const lines = G.firstChangedLines(diff);
    files = G.changedFiles().map((f) => ({ ...f, line: lines.get(f.file) }));
    // most recently touched first = the file you were most likely editing
    files.sort((a, b) => mtime(cwd, b.file) - mtime(cwd, a.file));
    step(`Physical snapshot: ${files.length} file(s) in flight on ${theme.info(branch ?? "?")}`);
    files.slice(0, 6).forEach((f) => note(`   ${f.file}${f.line ? ":" + f.line : ""} — ${f.label}`));
  } else {
    warn("Not a git repository — saving your note only.");
  }

  // Git snapshot (non-destructive)
  let stash: string | null = null;
  if (repo && opts.stash !== false && files.some((f) => f.status !== "??")) {
    stash = G.snapshotStash(`aether-coffin: ${message}`.slice(0, 120));
    if (stash) step(`Git snapshot: changes preserved as stash ${theme.info(stash.slice(0, 8))} (working tree untouched)`);
  }

  // AI (or local) mental summary
  let analysis: ContextAnalysis | null = null;
  let source: "ai" | "local" = "local";
  if (hasAI()) {
    step("Asking the AI ghost to write your mental summary…");
    try {
      analysis = await analyzeContext(diff, message, { branch: branch ?? undefined, files: files.map((f) => f.file).join(", ") });
      if (analysis && analysis.next_steps.length) source = "ai";
      else analysis = null;
    } catch (err) {
      warn(`AI unavailable (${err instanceof Error ? err.message : String(err)}) — using local analysis.`);
    }
  } else noAIHint("summary generated locally");
  if (!analysis) analysis = localAnalysis(files, message);

  const data: CoffinData = {
    version: 1,
    sealedAt: new Date().toISOString(),
    cwd,
    note: message,
    branch,
    head,
    stash,
    isGitRepo: repo,
    files,
    summary: analysis.context_summary,
    nextSteps: analysis.next_steps,
    resume: resumeCommands(cwd),
    source,
    model: source === "ai" ? MODEL : undefined,
  };

  try {
    fs.mkdirSync(path.join(cwd, ".aether"), { recursive: true });
    fs.writeFileSync(path.join(cwd, COFFIN_JSON), JSON.stringify(data, null, 2));
    fs.writeFileSync(path.join(cwd, "COFFIN.md"), renderCoffinMarkdown(data));
    if (repo) G.ensureLocalExclude(["COFFIN.md", ".aether/"]);
  } catch (err) {
    warn(`Could not write the coffin: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  console.log();
  rule();
  ok(theme.ok.bold("The coffin is sealed.") + theme.dim("  → COFFIN.md"));
  note(`When you return:  ${theme.text("aether resurrect")}   (add --open to reopen your files)`);
  console.log();
  return 0;
}

function mtime(cwd: string, file: string): number {
  try {
    return fs.statSync(path.join(cwd, file)).mtimeMs;
  } catch {
    return 0;
  }
}

export const coffinCommand = new Command("coffin")
  .description("⚰️  Freeze your coding context (files, cursor line, git state, AI summary)")
  .argument("<message...>", "what you were doing")
  .option("--no-stash", "skip the git stash snapshot")
  .action(async (message: string[], o: { stash: boolean }) => {
    process.exitCode = await runCoffin(message.join(" "), { stash: o.stash });
  });
