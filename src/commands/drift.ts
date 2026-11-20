import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { callAI, extractJson } from "../services/ai";
import { collect } from "../lib/scan";
import { keysUsedIn, parseEnv, analyzeDrift, buildExample, BUILTIN, exampleValue, type EnvFile } from "../core/drift";
import { theme, header, ok, warn, fail, note, step, rule, hasAI, type ExitCode } from "../lib/ui";

// ─── .env parsing ──────────────────────────────────────────────────────────────

const EXAMPLE_NAMES = [".env.example", ".env.sample", ".env.template", "example.env", ".env.dist"];
const isEnvName = (n: string) => n === ".env" || n.startsWith(".env.") || n.endsWith(".env");

function loadEnvFiles(dir: string): EnvFile[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isEnvName(e.name))
    .map((e) => ({ name: e.name, keys: parseEnv(fs.readFileSync(path.join(dir, e.name), "utf-8")) }));
}

// ─── Keys referenced from code ─────────────────────────────────────────────────

function keysUsedInCode(dir: string): Map<string, string> {
  return keysUsedIn(collect(dir, new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".php", ".rb", ".go"])));
}

// ─── Core ──────────────────────────────────────────────────────────────────────

export interface DriftOptions { fix?: boolean; ai?: boolean; ci?: boolean; json?: boolean }

export async function runDrift(dir: string | undefined, opts: DriftOptions = {}): Promise<ExitCode> {
  const root = dir ? path.resolve(process.cwd(), dir) : process.cwd();
  if (!fs.existsSync(root)) { fail(`Cannot access ${root}`); return 1; }

  const all = loadEnvFiles(root);
  const exampleFile = EXAMPLE_NAMES.map((n) => all.find((f) => f.name === n)).find(Boolean);
  const envs = all.filter((f) => f !== exampleFile);
  const used = keysUsedInCode(root);

  if (!opts.json) header("📊", "CONFIG DRIFT DETECTOR", "Keeping every environment in agreement", theme.info);

  if (!all.length) {
    if (opts.json) console.log(JSON.stringify({ files: [], issues: [] }));
    else { warn("No .env files found."); if (used.size) note(`Your code reads ${used.size} variable(s) — run with --fix to generate a .env.example.`); }
    if (!(opts.fix && used.size)) return 0;
  }

  const { union, unique } = analyzeDrift(all, exampleFile, used);
  if (opts.json) { console.log(JSON.stringify({ files: all.map((f) => f.name), used: [...used.keys()], issues: unique }, null, 2)); return unique.some((i) => i.level === "error") && opts.ci ? 1 : 0; }

  note(`Compared: ${all.map((f) => f.name).join(", ") || "(none)"}  ·  ${used.size} variable(s) read in code`);
  console.log();

  // Matrix
  if (all.length) {
    const keys = [...union].sort();
    const cols = all.slice(0, 6);
    const w = Math.min(34, Math.max(12, ...keys.map((k) => k.length)) + 2);
    const labels = cols.map((c) => (c.name.replace(/^\.env\.?/, "") || "env").slice(0, 10));
    const cw = 12;
    console.log("  " + theme.dim("VARIABLE".padEnd(w)) + labels.map((l) => theme.dim(l.padEnd(cw))).join(""));
    keys.slice(0, 40).forEach((k) =>
      console.log("  " + theme.text(k.padEnd(w)) + cols.map((c) => (c.keys.has(k) ? theme.ok("●") : theme.bad("○")) + " ".repeat(cw - 1)).join(""))
    );
    if (keys.length > 40) note(`… ${keys.length - 40} more`);
    console.log();
  }

  if (!unique.length) ok(theme.ok.bold("No drift. Every environment agrees."));
  else {
    unique.forEach((i) => (i.level === "error" ? fail(i.msg) : warn(i.msg)));
  }

  if (opts.fix) {
    console.log();
    const target = path.join(root, exampleFile?.name ?? ".env.example");
    const known = new Map<string, string>();
    all.forEach((f) => f.keys.forEach((v, k) => { if (!known.has(k) || (!known.get(k) && v)) known.set(k, v); }));
    const existing = exampleFile?.keys ?? new Map<string, string>();
    const missing = [...union].filter((k) => !existing.has(k)).sort();

    let descriptions: Record<string, string> = {};
    if (opts.ai && hasAI() && missing.length) {
      step("Asking the AI ghost to document the new variables (key names only — values are never sent)…");
      try {
        const raw = await callAI('For each environment variable name, write a short description (max 8 words). Reply RAW JSON only: {"KEY":"description"}', missing.join("\n"), 0.2);
        descriptions = (raw ? extractJson<Record<string, string>>(raw) : null) ?? {};
      } catch (err) { warn(`AI unavailable (${err instanceof Error ? err.message : String(err)}).`); }
    }

    const body = buildExample(fs.existsSync(target) ? fs.readFileSync(target, "utf-8") : null, missing, known, descriptions);
    fs.writeFileSync(target, body);
    ok(`${path.basename(target)} ${missing.length ? `updated with ${missing.length} variable(s)` : "is already complete"}  ${theme.dim("(secret values are always blanked)")}`);
  } else if (unique.some((i) => /missing from \.env\.|not documented|no \.env\.example/i.test(i.msg) || i.msg.includes("missing from"))) {
    console.log();
    note("Fix automatically:  aether drift --fix   (add --ai to document each variable)");
  }

  console.log();
  rule();
  console.log();
  return opts.ci && unique.some((i) => i.level === "error") ? 1 : 0;
}

export const driftCommand = new Command("drift")
  .description("📊 Compare every .env file + code usage; generate a safe .env.example")
  .argument("[dir]", "project directory (default: current)")
  .option("--fix", "create/update .env.example (secret values are always blanked)")
  .option("--ai", "with --fix: AI writes a one-line description per new variable (names only)")
  .option("--ci", "exit 1 when real drift is found")
  .option("--json", "machine-readable output")
  .action(async (dir: string | undefined, o: DriftOptions) => {
    process.exitCode = await runDrift(dir, o);
  });
