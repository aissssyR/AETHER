import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";

// ─── Spooky ASCII art ──────────────────────────────────────────────────────────
const GHOST_ART = chalk.white(`
        .-.
       (o o)   boo!
       | O |
       '~~~'
`);

const TOMBSTONE_ART = chalk.gray(`
       _______
      |       |
      | R.I.P |
      | ~dev~ |
      |_______|
      |       |
 _____|       |_____
`);

const RESURRECT_BANNER = chalk.red(`
  ╔══════════════════════════════════════╗
  ║   💀  THE DEAD HAVE RISEN  💀        ║
  ║      Your context awakens...         ║
  ╚══════════════════════════════════════╝
`);

// ─── Content renderer ──────────────────────────────────────────────────────────

/**
 * AI INTEGRATION POINT — Resurrect Renderer
 *
 * Currently reads COFFIN.md and renders it with spooky Chalk formatting.
 *
 * FUTURE UPGRADE: Before printing, send the COFFIN.md content to an LLM:
 *   1. Read COFFIN.md content (already done below)
 *   2. POST to OpenAI/Claude: "Based on this dev context, give a 3-sentence
 *      motivational briefing on what to tackle first today."
 *   3. Print the AI's response as a "Spirit Message" section above the raw content.
 */
function renderCoffinContent(content: string): void {
  const lines = content.split("\n");

  lines.forEach((line) => {
    // ── Headings ────────────────────────────────────────────────────────────
    if (line.startsWith("# ")) {
      console.log(chalk.red.bold(line));

    } else if (line.startsWith("## ")) {
      console.log("\n" + chalk.magenta.bold(line));

    // ── Block quotes (spooky whispers) ──────────────────────────────────────
    } else if (line.startsWith("> ")) {
      console.log(chalk.gray.italic(line));

    // ── Numbered list items (next steps) → highlight the number in green ───
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+\.\s)(.*)/);
      if (match) {
        process.stdout.write(chalk.green.bold(match[1]));
        console.log(chalk.white(match[2]));
      } else {
        console.log(chalk.white(line));
      }

    // ── Bullet list items ───────────────────────────────────────────────────
    } else if (line.startsWith("- ")) {
      // File names inside backticks → cyan; rest → gray
      const formatted = line.replace(/`([^`]+)`/g, chalk.cyan("`$1`"));
      console.log(chalk.gray(formatted));

    // ── Code fences ─────────────────────────────────────────────────────────
    } else if (line.startsWith("```")) {
      console.log(chalk.gray.dim(line));

    // ── Diff lines inside a code fence ──────────────────────────────────────
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      console.log(chalk.green(line));

    } else if (line.startsWith("-") && !line.startsWith("---")) {
      console.log(chalk.red(line));

    } else if (line.startsWith("@@")) {
      console.log(chalk.cyan(line));

    // ── Horizontal rules ────────────────────────────────────────────────────
    } else if (line.startsWith("---")) {
      console.log(chalk.gray.dim("─".repeat(50)));

    // ── Italic/bold markers ─────────────────────────────────────────────────
    } else if (line.startsWith("*") || line.startsWith("_")) {
      console.log(chalk.gray.italic(line));

    // ── Everything else ─────────────────────────────────────────────────────
    } else {
      console.log(chalk.white(line));
    }
  });
}

// ─── Command definition ─────────────────────────────────────────────────────────

export const resurrectCommand = new Command("resurrect")
  .description("💀 Rise from the dead — read your saved COFFIN.md context")
  .action(() => {
    const coffinPath = path.join(process.cwd(), "COFFIN.md");

    // Print spooky ASCII art header
    console.log(TOMBSTONE_ART);
    console.log(GHOST_ART);
    console.log(RESURRECT_BANNER);

    // ── Guard: no COFFIN.md found ────────────────────────────────────────────
    if (!fs.existsSync(coffinPath)) {
      console.log(chalk.red.bold("🕸️  No spirits found in the graveyard.\n"));
      console.log(
        chalk.gray(
          "The grave is empty. No COFFIN.md was found in this directory.\n"
        )
      );
      console.log(
        chalk.gray(
          '💡 Seal your context first: luvsean coffin "what you were doing"\n'
        )
      );
      process.exit(1);
    }

    // ── Read and render COFFIN.md ────────────────────────────────────────────
    try {
      const content = fs.readFileSync(coffinPath, "utf-8");
      const stats = fs.statSync(coffinPath);
      const sealedAgo = getTimeAgo(stats.mtime);

      console.log(chalk.magenta(`🪦 Unsealing the coffin... (sealed ${sealedAgo})\n`));
      console.log(chalk.gray("─".repeat(50)) + "\n");

      renderCoffinContent(content);

      console.log("\n" + chalk.gray("─".repeat(50)));
      console.log(
        chalk.green.bold(
          "\n🌑 You have been resurrected. Now go build something hauntingly great.\n"
        )
      );
    } catch (err) {
      console.error(chalk.red("💀 Failed to open the coffin:"), err);
      process.exit(1);
    }
  });

// ─── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns a human-friendly "X ago" string from a Date object.
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
