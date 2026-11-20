import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import nodeFetch from "node-fetch";
import { spawnSync } from "child_process";
import { callAI, extractCodeBlocks } from "../services/ai";
import { collect, type SourceFile } from "../lib/scan";
import { escapeRegExp } from "../core/util";
import { NPM, PYPI, parseManifests, findUsages, type Dep, type Usage, type Zombie, type Severity } from "../core/exorcise";
import * as G from "../lib/git";
import { theme, header, ok, warn, fail, note, step, rule, hasAI, noAIHint, type ExitCode } from "../lib/ui";

// ─── Manifest readers ──────────────────────────────────────────────────────────

function readManifests(dir: string): { deps: Dep[]; files: string[] } {
  const read = (n: string) => (fs.existsSync(path.join(dir, n)) ? fs.readFileSync(path.join(dir, n), "utf-8") : undefined);
  const r = parseManifests(read("package.json"), read("requirements.txt"));
  r.errors.forEach((e) => warn(`${e} — skipping.`));
  return r;
}

// ─── Optional live registry check (--online) ───────────────────────────────────

interface RegistryInfo { deprecated?: string; modified?: string }

async function registryInfo(name: string): Promise<RegistryInfo | null> {
  try {
    const enc = name.replace("/", "%2f");
    const ctl = { timeout: 8000 };
    const latest = await nodeFetch(`https://registry.npmjs.org/${enc}/latest`, ctl);
    if (!latest.ok) return null;
    const lj = (await latest.json()) as { deprecated?: string };
    const full = await nodeFetch(`https://registry.npmjs.org/${enc}`, { ...ctl, headers: { Accept: "application/vnd.npm.install-v1+json" } });
    const fj = full.ok ? ((await full.json()) as { modified?: string }) : {};
    return { deprecated: lj.deprecated, modified: fj.modified };
  } catch { return null; }
}

// ─── AI rewrite ritual ─────────────────────────────────────────────────────────

const REWRITE_SYSTEM =
  "You are a careful senior engineer migrating code off a dead dependency. Rewrite the given file so it no longer imports the dependency, " +
  "using the named replacement (prefer native APIs). Preserve behaviour, exports, formatting and comments. " +
  "Reply with EXACTLY two fenced code blocks and nothing else: first the complete rewritten file, second a small test file for the migrated logic " +
  "(use node:test + node:assert for JS/TS, pytest for Python).";

function syntaxOk(file: string, code: string): boolean {
  if (!/\.(m|c)?js$/.test(file)) return true; // only JS can be checked without extra tooling
  const tmp = path.join(require("os").tmpdir(), `aether-check-${Date.now()}${path.extname(file)}`);
  fs.writeFileSync(tmp, code);
  const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf-8" });
  fs.rmSync(tmp, { force: true });
  return r.status === 0;
}

async function rewriteUsages(root: string, dep: Dep, z: Zombie, usages: Usage[], src: SourceFile[], apply: boolean, force: boolean): Promise<void> {
  const byFile = [...new Set(usages.map((u) => u.file))].slice(0, 5);
  for (const rel of byFile) {
    const f = src.find((s) => s.rel === rel)!;
    if (f.text.length > 20_000) { warn(`${rel} is too large for a safe automatic rewrite — skipped.`); continue; }
    step(`Rewriting ${theme.text(rel)} off ${dep.name}…`);
    let raw: string | null = null;
    try { raw = await callAI(REWRITE_SYSTEM, `Dependency to remove: ${dep.name}\nReplacement: ${z.alt}\nMigration hint: ${z.tip}\nFile: ${rel}\n\n${f.text}`, 0.2); }
    catch (err) { warn(`AI unavailable (${err instanceof Error ? err.message : String(err)}).`); return; }
    const blocks = raw ? extractCodeBlocks(raw) : [];
    if (!blocks.length) { warn(`The model returned no code for ${rel}.`); continue; }
    const [code, tests] = blocks;
    if (!syntaxOk(rel, code)) { fail(`Rewritten ${rel} failed a syntax check — discarded.`); continue; }

    const outDir = path.join(root, ".aether", "exorcism");
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, code);
    if (tests) {
      const ext = path.extname(rel);
      fs.writeFileSync(dest.replace(new RegExp(`${escapeRegExp(ext)}$`), `.migrated.test${ext}`), tests);
    }
    const before = f.text.split("\n").length;
    const after = code.split("\n").length;
    ok(`Proposal saved → ${theme.dim(path.relative(root, dest))}  ${theme.dim(`(${before} → ${after} lines${tests ? ", + tests" : ""})`)}`);

    if (apply) {
      const dirty = G.isRepo(root) && G.changedFiles(root).some((c) => c.file === rel);
      if (dirty && !force) { warn(`${rel} has uncommitted changes — not overwritten (use --force).`); continue; }
      fs.writeFileSync(path.join(root, rel), code);
      ok(`Applied to ${rel}  ${theme.dim("(review with git diff; undo with git checkout)")}`);
    }
  }
}

// ─── Command ───────────────────────────────────────────────────────────────────

export interface ExorciseOptions { rewrite?: boolean; apply?: boolean; force?: boolean; online?: boolean; only?: string }

const SEV_COLOR: Record<Severity, (s: string) => string> = { security: theme.bad, deprecated: theme.warn, legacy: theme.info };

export async function runExorcise(dir: string | undefined, opts: ExorciseOptions = {}): Promise<ExitCode> {
  const root = dir ? path.resolve(process.cwd(), dir) : process.cwd();
  header("🧿", "ZOMBIE DEPENDENCY EXORCIST", "Finding the undead in your manifests", theme.bad);

  const { deps, files } = readManifests(root);
  if (!files.length) { fail(`No package.json or requirements.txt in ${root}`); return 1; }
  note(`Read ${deps.length} dependencies from ${files.join(" + ")}`);
  console.log();

  const src = collect(root, new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".py"]));
  const found: { dep: Dep; z: Zombie; usages: Usage[]; live?: RegistryInfo | null }[] = [];

  for (const dep of deps) {
    const z = dep.eco === "npm" ? NPM[dep.name] : PYPI[dep.name];
    if (z && (!opts.only || opts.only === dep.name)) found.push({ dep, z, usages: findUsages(src, dep) });
  }

  // Live registry signals for the npm packages NOT in our database
  const liveFindings: { dep: Dep; live: RegistryInfo }[] = [];
  if (opts.online) {
    step("Querying the npm registry for deprecation flags and last publish dates…");
    const candidates = deps.filter((d) => d.eco === "npm" && !NPM[d.name]).slice(0, 60);
    for (let i = 0; i < candidates.length; i += 6) {
      const batch = await Promise.all(candidates.slice(i, i + 6).map(async (d) => ({ d, info: await registryInfo(d.name) })));
      for (const { d, info } of batch) {
        if (!info) continue;
        const years = info.modified ? (Date.now() - new Date(info.modified).getTime()) / 3.15576e10 : 0;
        if (info.deprecated || years >= 3) liveFindings.push({ dep: d, live: info });
      }
    }
    console.log();
  }

  if (!found.length && !liveFindings.length) {
    ok(theme.ok.bold("No zombies detected.") + theme.dim(opts.online ? "" : "  (add --online to check the live npm registry)"));
    console.log();
    return 0;
  }

  for (const { dep, z, usages } of found) {
    console.log(`  🧟 ${theme.text.bold(dep.name)}${theme.dim("@" + dep.version)}  ${SEV_COLOR[z.severity](`[${z.severity}]`)}`);
    console.log(theme.dim(`     ${z.reason}`));
    console.log(`     ${theme.ok("✨ replace with")} ${theme.ok.bold(z.alt)}`);
    console.log(theme.dim(`     tip: ${z.tip}`));
    if (usages.length) {
      console.log(theme.dim(`     used in ${new Set(usages.map((u) => u.file)).size} file(s):`));
      usages.slice(0, 4).forEach((u) => console.log(theme.dim(`       ${u.file}:${u.line}  ${u.text}`)));
      if (usages.length > 4) console.log(theme.dim(`       … +${usages.length - 4} more`));
    } else console.log(theme.dim("     not imported anywhere in source — likely safe to simply uninstall"));
    console.log();
  }

  for (const { dep, live } of liveFindings) {
    console.log(`  🧟 ${theme.text.bold(dep.name)}${theme.dim("@" + dep.version)}  ${theme.warn("[registry]")}`);
    if (live.deprecated) console.log(theme.dim(`     deprecated: ${live.deprecated.slice(0, 120)}`));
    if (live.modified) console.log(theme.dim(`     last published: ${live.modified.slice(0, 10)}`));
    console.log();
  }

  if (opts.rewrite || opts.apply) {
    rule();
    if (!hasAI()) warn("--rewrite needs NEBIUS_API_KEY in .env (the exorcism is performed by the AI).");
    else {
      for (const f of found.filter((x) => x.usages.length)) await rewriteUsages(root, f.dep, f.z, f.usages, src, !!opts.apply, !!opts.force);
      note("Next: install the replacement, run your tests, then remove the zombie from your manifest.");
    }
    console.log();
  } else if (found.some((f) => f.usages.length)) {
    if (!hasAI()) noAIHint("migration tips only");
    note("Let the AI rewrite the code for you:  aether exorcise --rewrite   (proposals go to .aether/exorcism/)");
  }

  rule();
  console.log(`  ${theme.bad.bold(String(found.length + liveFindings.length))} zombie(s) found.`);
  console.log();
  return 0;
}

export const exorciseCommand = new Command("exorcise")
  .description("🧿 Find zombie dependencies (package.json, requirements.txt) and migrate off them")
  .argument("[dir]", "project directory (default: current)")
  .option("--rewrite", "AI rewrites the files that use each zombie (saved to .aether/exorcism/)")
  .option("--apply", "also overwrite the original files (refuses dirty files)")
  .option("--force", "with --apply: overwrite even files with uncommitted changes")
  .option("--online", "check the live npm registry for deprecation / abandonment")
  .option("--only <pkg>", "only exorcise one package")
  .action(async (dir: string | undefined, o: ExorciseOptions) => {
    process.exitCode = await runExorcise(dir, o);
  });
