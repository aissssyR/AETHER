import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { callAI, extractJson } from "../services/ai";
import { collect } from "../lib/scan";
import { analyzeFiles, USAGE_EXTS, type DeadItem } from "../core/sweep";
import { theme, header, ok, warn, fail, note, step, rule, hasAI, type ExitCode } from "../lib/ui";

export { analyzeFiles, type DeadItem };

/** Reads the project from disk and runs the pure analysis. */
export function analyze(root: string, scopeRel: string | null): { items: DeadItem[]; scanned: number } {
  const files = collect(root, USAGE_EXTS);
  let pkgJson: string | undefined;
  try { pkgJson = fs.readFileSync(path.join(root, "package.json"), "utf-8"); } catch { /* none */ }
  return analyzeFiles(files, scopeRel, { pkgJson, orphans: !scopeRel || pkgJson !== undefined });
}

// ─── Optional AI review ────────────────────────────────────────────────────────

async function aiReview(root: string, items: DeadItem[]): Promise<void> {
  const subset = items.filter((i) => i.kind !== "file").slice(0, 12);
  if (!subset.length) return;
  step("Asking the AI ghost to double-check for dynamic or framework usage…");
  const blocks = subset.map((i) => {
    let snippet = "";
    try { snippet = fs.readFileSync(path.join(root, i.file), "utf-8").split("\n").slice(i.line - 1, i.line + 7).join("\n"); } catch { /* ignore */ }
    return `### ${i.name} (${i.kind}) in ${i.file}:${i.line}\n${snippet}`;
  }).join("\n\n");
  try {
    const raw = await callAI(
      "You review dead-code candidates found by static analysis (0 textual references). For each, decide if it is truly safe to delete " +
        "or risky (called dynamically, by a framework convention, reflection, a public API, or from another repo). " +
        'Reply RAW JSON only: {"reviews":[{"name":"…","verdict":"safe|risky","reason":"max 15 words"}]}',
      blocks, 0.2);
    const obj = raw ? extractJson<{ reviews?: { name: string; verdict: string; reason: string }[] }>(raw) : null;
    if (!obj?.reviews?.length) return;
    console.log();
    console.log(theme.brand.bold("  AI second opinion"));
    obj.reviews.forEach((r) => {
      const safe = String(r.verdict).toLowerCase() === "safe";
      console.log(`  ${safe ? theme.ok("✔ safe ") : theme.warn("▲ risky")} ${theme.text(r.name)} ${theme.dim("— " + r.reason)}`);
    });
  } catch (err) {
    warn(`AI review unavailable (${err instanceof Error ? err.message : String(err)}).`);
  }
}

// ─── Command ───────────────────────────────────────────────────────────────────

export interface SweepOptions { json?: boolean; ai?: boolean; all?: boolean; failOnDead?: boolean }

export async function runSweep(target: string | undefined, opts: SweepOptions = {}): Promise<ExitCode> {
  const root = process.cwd();
  const abs = target ? path.resolve(root, target) : root;
  if (!fs.existsSync(abs)) { fail(`Cannot access: ${abs}`); return 1; }
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  const scope = rel && rel !== "" ? rel : null;

  const { items, scanned } = analyze(root, scope);

  if (opts.json) {
    console.log(JSON.stringify({ scanned, dead: items }, null, 2));
    return opts.failOnDead && items.some((i) => i.confidence === "high") ? 1 : 0;
  }

  header("🧹", "DEADCODE HUNTER", "The Graveyard Detective traces every call", theme.accent);
  note(`Scanned ${scanned} files · tracing function/class references across the whole project`);
  console.log();

  if (scanned === 0) { warn("No source files found here."); return 0; }
  if (items.length === 0) {
    ok(theme.ok.bold("The graveyard is empty.") + theme.dim(" No unreferenced functions, classes or orphan files found."));
    console.log();
    return 0;
  }

  const limit = opts.all ? items.length : 40;
  let lastFile = "";
  items.slice(0, limit).forEach((i) => {
    if (i.file !== lastFile) { console.log(theme.info.bold(`  ${i.file}`)); lastFile = i.file; }
    const tag = i.confidence === "high" ? theme.bad("[high]  ") : theme.warn("[medium]");
    const label = i.kind === "file" ? "orphan file" : `${i.kind} ${theme.text.bold(i.name + (i.kind === "function" || i.kind === "method" ? "()" : ""))}`;
    console.log(`   ${tag} ${theme.dim(`L${i.line}`.padEnd(6))} ${label}`);
    console.log(theme.dim(`            ${i.why}`));
  });
  if (items.length > limit) note(`… and ${items.length - limit} more (use --all)`);

  const high = items.filter((i) => i.confidence === "high").length;
  console.log();
  rule();
  console.log(`  ${theme.bad.bold(String(high))} high-confidence · ${theme.warn.bold(String(items.length - high))} medium-confidence candidates`);
  note("high = not exported and never referenced → safe to delete. medium = exported/orphan → verify nothing outside this repo uses it.");
  note("Static analysis is textual: dynamic calls (obj[name]()), reflection and string-based routing may hide usages.");

  if (opts.ai) {
    if (hasAI()) await aiReview(root, items);
    else warn("--ai needs NEBIUS_API_KEY in .env");
  }
  console.log();
  return opts.failOnDead && high > 0 ? 1 : 0;
}

export const sweepCommand = new Command("sweep")
  .description("🧹 Find dead code: unreferenced functions, classes and orphan files (JS/TS/Python/PHP)")
  .argument("[target]", "file or directory to report on (the whole project is still used to count references)")
  .option("--json", "machine-readable output")
  .option("--ai", "ask the AI for a second opinion on risky candidates")
  .option("--all", "show every finding (default: first 40)")
  .option("--fail-on-dead", "exit 1 if high-confidence dead code exists (CI)")
  .action(async (target: string | undefined, o: SweepOptions) => {
    process.exitCode = await runSweep(target, o);
  });
