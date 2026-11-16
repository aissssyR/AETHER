import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { analyzeCodeWithAI, type AIAnalysisResult } from "../services/ai";

// ─── Spooky ASCII banner ───────────────────────────────────────────────────────
const COFFIN_BANNER = `
  ░░░░░░░░░░░░░░░░░░░░░
  ░  ⚰️  INTO THE COFFIN  ⚰️  ░
  ░░░░░░░░░░░░░░░░░░░░░
`;

// ─── Types ─────────────────────────────────────────────────────────────────────
interface GitAnalysis {
  isGitRepo: boolean;
  changedFiles: ChangedFile[];
  diff: string;
  hasChanges: boolean;
}

interface ChangedFile {
  status: string; // M = modified, A = added, D = deleted, ?? = untracked
  file: string;
  label: string; // human-readable label
}

// ─── Smart Local Analyzer ──────────────────────────────────────────────────────

/**
 * Runs a shell command and returns stdout as a string.
 * Returns an empty string if the command fails (e.g. not a git repo).
 */
function runCommand(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

/**
 * Parses the output of `git status --short` into a structured list of changed files.
 * Each line from git status looks like: " M src/index.ts" or "?? newfile.ts"
 */
function parseGitStatus(statusOutput: string): ChangedFile[] {
  if (!statusOutput) return [];

  const statusLabels: Record<string, string> = {
    M: "Modified",
    A: "Added (staged)",
    D: "Deleted",
    R: "Renamed",
    C: "Copied",
    U: "Updated (unmerged)",
    "??": "Untracked (new file)",
    "!!": "Ignored",
  };

  return statusOutput
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      // git status --short format: XY filename  (XY are two status chars + space)
      const rawStatus = line.substring(0, 2).trim();
      const file = line.substring(3).trim();
      const label = statusLabels[rawStatus] ?? `Changed (${rawStatus})`;
      return { status: rawStatus, file, label };
    });
}

/**
 * Groups changed files by their extension to infer what kind of work was done.
 * e.g. ".ts" files → "TypeScript source", ".css" → "Styles", etc.
 */
function inferWorkContext(files: ChangedFile[]): string[] {
  const extMap: Record<string, string> = {
    ".ts": "TypeScript source code",
    ".tsx": "React/TSX components",
    ".js": "JavaScript source code",
    ".jsx": "React/JSX components",
    ".css": "CSS styles",
    ".scss": "SCSS styles",
    ".json": "configuration or data files",
    ".md": "documentation",
    ".html": "HTML templates",
    ".env": "environment variables",
    ".yml": "YAML config / CI pipeline",
    ".yaml": "YAML config / CI pipeline",
    ".sql": "database queries or migrations",
    ".test.ts": "test files",
    ".spec.ts": "test/spec files",
  };

  const foundContexts = new Set<string>();
  files.forEach(({ file }) => {
    const ext = path.extname(file).toLowerCase();
    if (extMap[ext]) foundContexts.add(extMap[ext]);
  });

  return Array.from(foundContexts);
}

/**
 * AI INTEGRATION POINT — Smart Local Analyzer
 *
 * This function replaces the placeholder AI call. It uses `git diff` and
 * `git status --short` to analyze the current state of the repository and
 * generates a structured, spooky-but-helpful summary.
 *
 * FUTURE UPGRADE: Replace `generateNextSteps()` with a real LLM call:
 *   1. Pass `diff` to OpenAI/Claude/Gemini with a prompt like:
 *      "Summarize what this developer was working on and suggest 3 next steps."
 *   2. Replace the heuristic next steps below with the AI response.
 */
function analyzeGitState(cwd: string): GitAnalysis {
  // Check if this is a git repository
  const gitCheck = runCommand("git rev-parse --is-inside-work-tree", cwd);
  if (gitCheck !== "true") {
    return { isGitRepo: false, changedFiles: [], diff: "", hasChanges: false };
  }

  // Get short status (staged + unstaged + untracked)
  const statusOutput = runCommand("git status --short", cwd);
  const changedFiles = parseGitStatus(statusOutput);

  // Get the actual diff of tracked changed files (unstaged + staged)
  const diff = runCommand("git diff HEAD", cwd) || runCommand("git diff --cached", cwd);

  return {
    isGitRepo: true,
    changedFiles,
    diff,
    hasChanges: changedFiles.length > 0,
  };
}

/**
 * Heuristic next-step generator based on file types and statuses.
 * This runs locally with zero API calls — the "smart" part before AI is wired in.
 *
 * FUTURE UPGRADE: Replace this entire function with an LLM call.
 */
function generateNextSteps(files: ChangedFile[], message: string): string[] {
  const steps: string[] = [];
  const fileNames = files.map((f) => f.file.toLowerCase());
  const hasTests = fileNames.some((f) => f.includes(".test.") || f.includes(".spec."));
  const hasConfig = fileNames.some((f) => f.endsWith(".json") || f.endsWith(".yml") || f.endsWith(".yaml"));
  const hasDeletedFiles = files.some((f) => f.status === "D");
  const hasUntrackedFiles = files.some((f) => f.status === "??");

  // Always include the developer's own message as first context
  steps.push(`Continue from where you left off: "${message}"`);

  if (hasTests) {
    steps.push("Run your test suite — you had test files in progress (`npm test` or `npx jest`).");
  }
  if (hasConfig) {
    steps.push("Review config/JSON changes before running — something in the setup may have shifted.");
  }
  if (hasDeletedFiles) {
    steps.push("Double-check the deleted files — make sure no important logic was lost.");
  }
  if (hasUntrackedFiles) {
    steps.push("You have new untracked files — decide if they need to be committed or added to .gitignore.");
  }
  if (files.length > 5) {
    steps.push(`Large change set (${files.length} files). Consider splitting into smaller commits.`);
  }
  if (!hasTests && files.some((f) => f.file.endsWith(".ts") || f.file.endsWith(".js"))) {
    steps.push("No test files changed — consider writing tests for the new logic before moving on.");
  }

  steps.push("Run `git status` and review your changes before committing.");

  return steps;
}

// ─── COFFIN.md content builder ─────────────────────────────────────────────────

function generateCoffinContent(
  message: string,
  analysis: GitAnalysis,
  aiResult: AIAnalysisResult | null
): string {
  const timestamp = new Date().toISOString();
  const cwd = process.cwd();

  // ── Changed files section ────────────────────────────────────────────────────
  let changedFilesSection: string;
  if (!analysis.isGitRepo) {
    changedFilesSection = `> ⚠️ This directory is not a Git repository. No file changes were detected automatically.`;
  } else if (!analysis.hasChanges) {
    changedFilesSection = `> 🕊️ No uncommitted changes detected. Working tree is clean.`;
  } else {
    changedFilesSection = analysis.changedFiles
      .map((f) => `- \`${f.file}\` — **${f.label}**`)
      .join("\n");
  }

  // ── Context summary: AI or heuristic fallback ────────────────────────────────
  const contextSummary = aiResult
    ? aiResult.context_summary
    : inferWorkContext(analysis.changedFiles)
        .map((c) => `- ${c}`)
        .join("\n") || "> No specific context inferred.";

  // ── Next steps: AI or heuristic fallback ─────────────────────────────────────
  const nextStepsList: string[] = aiResult
    ? aiResult.next_steps
    : generateNextSteps(analysis.changedFiles, message);

  const nextStepsSection = nextStepsList
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");

  // ── AI source label ──────────────────────────────────────────────────────────
  const analysisLabel = aiResult
    ? `🤖 AI Analysis *(powered by Nebius · ${NEBIUS_MODEL_LABEL})*`
    : `🧠 Inferred Work Context *(local heuristics — set NEBIUS_API_KEY to enable AI)*`;

  // ── Diff snippet (first 50 lines to keep COFFIN.md readable) ────────────────
  const diffLines = analysis.diff.split("\n").slice(0, 50);
  const diffSection =
    analysis.diff.length > 0
      ? "```diff\n" +
        diffLines.join("\n") +
        (analysis.diff.split("\n").length > 50 ? "\n... (truncated)" : "") +
        "\n```"
      : "> No diff available.";

  return `# 🪦 COFFIN.md

> *"Here lies the context of a developer, sealed until the next session."*

## 📅 Sealed At
${timestamp}

## 📁 Project Directory
\`${cwd}\`

## 💬 Developer's Last Words
> ${message}

---

## 📂 What Was Changed (${analysis.changedFiles.length} file${analysis.changedFiles.length !== 1 ? "s" : ""})
${changedFilesSection}

## ${analysisLabel}
${contextSummary}

## 👣 Suggested Next Steps
${nextStepsSection}

## 🔍 Git Diff Snapshot
${diffSection}

---
*Sealed with \`luvsean coffin\` · Resurrected with \`luvsean resurrect\`*
`;
}

// ─── Model label (for display only) ────────────────────────────────────────────
const NEBIUS_MODEL_LABEL =
  process.env.NEBIUS_MODEL ?? "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";

// ─── Command definition ─────────────────────────────────────────────────────────

export const coffinCommand = new Command("coffin")
  .description("⚰️  Seal your current coding context into a COFFIN.md file")
  .argument("<message>", "Your last words before you close the lid")
  .action(async (message: string) => {
    console.log(chalk.magenta(COFFIN_BANNER));
    console.log(chalk.gray(`📂 Working directory: ${process.cwd()}\n`));
    console.log(chalk.gray("🔍 Analyzing your graveyard... (reading git state)\n"));

    // ── Step 1: Git analysis (always local, always fast) ───────────────────────
    const analysis = analyzeGitState(process.cwd());

    if (!analysis.isGitRepo) {
      console.log(chalk.yellow("⚠️  Not a Git repo — skipping file change analysis.\n"));
    } else if (!analysis.hasChanges) {
      console.log(chalk.gray("🕊️  Working tree is clean. No changes to analyze.\n"));
    } else {
      console.log(chalk.magenta(`📜 Found ${analysis.changedFiles.length} changed file(s):\n`));
      analysis.changedFiles.forEach(({ file, label }) => {
        console.log(chalk.gray(`   ${chalk.white(file)} — ${label}`));
      });
      console.log();
    }

    // ── Step 2: AI analysis (async, with graceful fallback) ────────────────────
    let aiResult: AIAnalysisResult | null = null;
    const hasApiKey =
      process.env.NEBIUS_API_KEY &&
      process.env.NEBIUS_API_KEY !== "your_nebius_api_key_here";

    if (hasApiKey) {
      console.log(chalk.magenta("🤖 Summoning the AI ghost for analysis...\n"));
      try {
        aiResult = await analyzeCodeWithAI(analysis.diff, message);
        if (aiResult) {
          console.log(chalk.green("✨ The spirit has spoken. AI analysis complete.\n"));
        }
      } catch (err) {
        // API failed — log the reason and fall through to heuristics
        const reason = err instanceof Error ? err.message : String(err);
        console.log(
          chalk.yellow(`⚠️  AI ghost went silent (${reason}).\n`) +
          chalk.gray("   Falling back to local heuristics...\n")
        );
      }
    } else {
      console.log(
        chalk.gray("💡 No NEBIUS_API_KEY found — using local analysis.\n") +
        chalk.gray("   Add your key to .env to enable AI-powered summaries.\n")
      );
    }

    // ── Step 3: Write COFFIN.md ────────────────────────────────────────────────
    const coffinPath = path.join(process.cwd(), "COFFIN.md");
    const content = generateCoffinContent(message, analysis, aiResult);

    try {
      fs.writeFileSync(coffinPath, content, "utf-8");

      console.log(chalk.green("✅ The coffin has been sealed.\n"));
      console.log(
        chalk.magenta("🪦 Your context has been buried in:"),
        chalk.white.bold(coffinPath)
      );
      console.log(
        chalk.gray('\n💡 When you return, run "luvsean resurrect" to wake it up.\n')
      );
    } catch (err) {
      console.error(chalk.red("💀 Failed to seal the coffin:"), err);
      process.exit(1);
    }
  });
