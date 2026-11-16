import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { callAI } from "../services/ai";

// ─── Spooky ASCII banner ───────────────────────────────────────────────────────
const SWEEP_BANNER = chalk.gray(`
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░  🧹  GRAVEYARD DETECTIVE  🧹  ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
`);

// ─── System prompt ─────────────────────────────────────────────────────────────
const SWEEP_SYSTEM_PROMPT =
  "You are a Graveyard Detective. Look at this list of files/code snippets. " +
  "Identify which ones look like \"dead code\" (unused functions, empty files, or deprecated variables). " +
  "Return a spooky \"Graveyard Report\" listing the dead items and why they should be buried (deleted). " +
  "Format your response as plain text with sections. " +
  "Use '💀 DEAD:' to prefix each dead item and '⚰️  BURY IT:' to prefix each reason/suggestion.";

// ─── File extensions we care about ─────────────────────────────────────────────
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".cs",
  ".vue", ".svelte", ".css", ".scss", ".json",
]);

// ─── Directories to always skip ────────────────────────────────────────────────
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out",
  ".next", ".nuxt", ".cache", "coverage",
]);

// ─── File scanner ──────────────────────────────────────────────────────────────

interface FileInfo {
  relativePath: string;
  sizeBytes: number;
  isEmpty: boolean;
  snippet: string; // first ~300 chars of the file
}

/**
 * Reads a single file and returns a FileInfo summary.
 */
function readFileInfo(filePath: string, cwd: string): FileInfo {
  const relativePath = path.relative(cwd, filePath).replace(/\\/g, "/");
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    // unreadable file — treat as empty
  }
  return {
    relativePath,
    sizeBytes: Buffer.byteLength(content, "utf-8"),
    isEmpty: content.trim().length === 0,
    snippet: content.slice(0, 300).replace(/\r\n/g, "\n"),
  };
}

/**
 * Recursively collects all code files under `dir`, skipping ignored folders.
 * Returns at most `limit` files so we don't flood the AI with too much context.
 */
function collectFiles(dir: string, limit = 40): FileInfo[] {
  const results: FileInfo[] = [];

  function walk(current: string): void {
    if (results.length >= limit) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) break;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          results.push(readFileInfo(fullPath, dir));
        }
      }
    }
  }

  walk(dir);
  return results;
}

// ─── Local fallback (no API key) ──────────────────────────────────────────────

function localSweep(files: FileInfo[]): void {
  const empty = files.filter((f) => f.isEmpty);
  const tiny = files.filter((f) => !f.isEmpty && f.sizeBytes < 50);

  if (empty.length === 0 && tiny.length === 0) {
    console.log(chalk.gray("   No obviously dead files found (empty or near-empty)."));
    console.log(chalk.gray("   Add your NEBIUS_API_KEY to .env for a full AI deep-dive.\n"));
    return;
  }

  if (empty.length > 0) {
    console.log(chalk.gray.bold("💀 EMPTY FILES (prime burial candidates):"));
    empty.forEach((f) => {
      console.log(chalk.gray(`   💀 DEAD: ${f.relativePath}`));
      console.log(chalk.red(`   ⚰️  BURY IT: This file is completely empty — it serves no purpose.\n`));
    });
  }

  if (tiny.length > 0) {
    console.log(chalk.gray.bold("💀 SUSPICIOUSLY TINY FILES:"));
    tiny.forEach((f) => {
      console.log(chalk.gray(`   💀 DEAD: ${f.relativePath} (${f.sizeBytes} bytes)`));
      console.log(chalk.red(`   ⚰️  BURY IT: Under 50 bytes — likely a stub or forgotten placeholder.\n`));
    });
  }
}

// ─── Report printer ────────────────────────────────────────────────────────────

function printReport(report: string): void {
  const lines = report.split("\n");
  for (const line of lines) {
    if (line.startsWith("💀 DEAD:") || line.includes("DEAD:")) {
      console.log(chalk.gray(`   ${line.trim()}`));
    } else if (line.startsWith("⚰️") || line.includes("BURY IT:")) {
      console.log(chalk.red(`   ${line.trim()}`));
    } else if (line.trim()) {
      console.log(chalk.gray.dim(`   ${line.trim()}`));
    } else {
      console.log();
    }
  }
}

// ─── Command definition ────────────────────────────────────────────────────────

export const sweepCommand = new Command("sweep")
  .description("🧹 Scan for dead code — unused files, empty stubs, and forgotten functions")
  .argument("[target]", "File or directory to scan (defaults to current directory)")
  .action(async (target: string | undefined) => {
    const cwd = process.cwd();
    const scanPath = target ? path.resolve(cwd, target) : cwd;

    console.log(SWEEP_BANNER);

    // ── Determine if we're scanning a single file or a whole directory ──────────
    let files: FileInfo[] = [];

    try {
      const stat = fs.statSync(scanPath);
      if (stat.isFile()) {
        files = [readFileInfo(scanPath, cwd)];
        console.log(chalk.gray(`🔍 Scanning file: ${path.relative(cwd, scanPath) || scanPath}\n`));
      } else {
        files = collectFiles(scanPath);
        console.log(chalk.gray(`🔍 Scanning ${files.length} code file(s) in: ${path.relative(cwd, scanPath) || "."}\n`));
      }
    } catch {
      console.log(chalk.red(`❌ Cannot access: ${scanPath}\n`));
      process.exit(1);
    }

    if (files.length === 0) {
      console.log(chalk.gray("   No code files found to analyze.\n"));
      process.exit(0);
    }

    // ── Build the context string for the AI ────────────────────────────────────
    const context = files
      .map((f) => {
        const header = `### ${f.relativePath} (${f.sizeBytes} bytes)${f.isEmpty ? " [EMPTY]" : ""}`;
        const body = f.isEmpty ? "(empty file)" : f.snippet + (f.sizeBytes > 300 ? "\n... [truncated]" : "");
        return `${header}\n${body}`;
      })
      .join("\n\n");

    const hasApiKey =
      process.env.NEBIUS_API_KEY &&
      process.env.NEBIUS_API_KEY !== "your_nebius_api_key_here";

    console.log(chalk.gray("─".repeat(52)));

    if (hasApiKey) {
      // ── AI path ──────────────────────────────────────────────────────────────
      console.log(chalk.gray("\n👻 The Graveyard Detective is inspecting the corpses...\n"));
      try {
        const report = await callAI(SWEEP_SYSTEM_PROMPT, context, 0.5);

        if (report) {
          console.log(chalk.gray.bold("\n📋 GRAVEYARD REPORT:\n"));
          printReport(report);
        } else {
          console.log(chalk.yellow("⚠️  The detective found nothing to report.\n"));
          localSweep(files);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`⚠️  The ghost went silent (${reason}). Using local scan.\n`));
        localSweep(files);
      }
    } else {
      // ── Local fallback path ───────────────────────────────────────────────────
      console.log(
        chalk.gray("💡 No NEBIUS_API_KEY — running local heuristic scan.\n") +
        chalk.gray("   Add your key to .env for a full AI-powered Graveyard Report.\n")
      );
      localSweep(files);
    }

    console.log();
    console.log(chalk.gray("─".repeat(52)));
    console.log(chalk.gray.dim("\n🪦 The sweep is complete. Bury the dead and let the living code breathe.\n"));

    process.exit(0);
  });
