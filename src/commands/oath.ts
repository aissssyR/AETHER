import { Command } from "commander";
import chalk from "chalk";
import { execSync } from "child_process";
import { suggestCommitMessages } from "../services/ai";

// ─── Spooky ASCII art ──────────────────────────────────────────────────────────
const SKULL_ART = chalk.red(`
    ░░░░░░░░░░░░░░░░░░░
    ░   ██████████   ░
    ░  ████  ████  ░
    ░  ████  ████  ░
    ░    ████████    ░
    ░  ██  ████  ██  ░
    ░░░░░░░░░░░░░░░░░░░
`);

const GHOST_ACCEPT = chalk.green(`
    ░░░░░░░░░░░░░░░
    ░    .-.    ░
    ░   (^ ^)   ░
    ░   / | \\   ░
    ░░░░░░░░░░░░░░░
`);

// ─── Lazy word detection ────────────────────────────────────────────────────────

/**
 * Words that signal a lazy commit message.
 * Matched as whole words (case-insensitive) to avoid false positives
 * like "bugfix" or "update-schema" being blocked.
 */
const LAZY_WORDS = [
  "fix",
  "bug",
  "update",
  "wip",
  "stuff",
  "changes",
  "misc",
  "temp",
  "test",
  "asdf",
  "lol",
  "idk",
];

interface QualityCheck {
  passed: boolean;
  reason: string;
}

function checkCommitQuality(message: string): QualityCheck {
  const trimmed = message.trim();

  // Rule 1: too short
  if (trimmed.length < 10) {
    return {
      passed: false,
      reason: `Message is only ${trimmed.length} character${trimmed.length !== 1 ? "s" : ""} long — the spirits demand at least 10.`,
    };
  }

  // Rule 2: lazy words (whole-word match, case-insensitive)
  const foundLazy = LAZY_WORDS.find((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(trimmed)
  );
  if (foundLazy) {
    return {
      passed: false,
      reason: `Contains the weak word "${foundLazy}" — this oath carries no power.`,
    };
  }

  // Rule 3: all lowercase single word (e.g. "working")
  if (/^\w+$/.test(trimmed)) {
    return {
      passed: false,
      reason: `A single word is not an oath — be more specific about what changed.`,
    };
  }

  return { passed: true, reason: "" };
}

// ─── Git diff helper (reused from coffin pattern) ──────────────────────────────

function getCurrentDiff(): string {
  try {
    const diff =
      execSync("git diff HEAD", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim() ||
      execSync("git diff --cached", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    return diff;
  } catch {
    return "";
  }
}

// ─── Fallback commit suggestions (no API key) ──────────────────────────────────

function localSuggestions(weakMessage: string): string[] {
  const slug = weakMessage.toLowerCase().replace(/\s+/g, "-").slice(0, 40);
  return [
    `feat: implement ${slug} with proper validation`,
    `refactor: restructure ${slug} for clarity and maintainability`,
    `fix: resolve edge case in ${slug} and add error handling`,
  ];
}

// ─── Command definition ─────────────────────────────────────────────────────────

export const oathCommand = new Command("oath")
  .description("🩸 Validate your commit message — weak oaths are rejected by the spirits")
  .argument("<message>", "Your proposed commit message")
  .action(async (message: string) => {
    const check = checkCommitQuality(message);

    if (!check.passed) {
      // ── BLOCKED path ────────────────────────────────────────────────────────
      console.log(SKULL_ART);
      console.log(
        chalk.red.bold(
          `👻 The Code Spirits are displeased.\n`
        )
      );
      console.log(
        chalk.red(
          `   "${message}" is a weak oath.\n`
        )
      );
      console.log(chalk.red.dim(`   Reason: ${check.reason}\n`));
      console.log(
        chalk.red("   The spirits demand a better sacrifice.\n")
      );
      console.log(chalk.gray("─".repeat(52)) + "\n");

      // ── Suggest better messages ──────────────────────────────────────────────
      const diff = getCurrentDiff();
      const hasApiKey =
        process.env.NEBIUS_API_KEY &&
        process.env.NEBIUS_API_KEY !== "your_nebius_api_key_here";

      let suggestions: string[];

      if (hasApiKey) {
        console.log(chalk.magenta("🤖 Summoning the AI ghost for better offerings...\n"));
        try {
          const aiResult = await suggestCommitMessages(message, diff);
          suggestions = aiResult?.messages ?? localSuggestions(message);
          if (aiResult) {
            console.log(chalk.magenta("✨ The spirits have conjured these alternatives:\n"));
          }
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.log(chalk.yellow(`⚠️  AI ghost went silent (${reason}). Using local suggestions.\n`));
          suggestions = localSuggestions(message);
        }
      } else {
        console.log(
          chalk.gray("💡 No NEBIUS_API_KEY — using local suggestions.\n") +
          chalk.gray("   Add your key to .env for AI-generated alternatives.\n\n")
        );
        suggestions = localSuggestions(message);
      }

      // ── Print the 3 suggestions ──────────────────────────────────────────────
      suggestions.forEach((suggestion, i) => {
        const label = chalk.magenta.bold(`  [${i + 1}]`);
        console.log(`${label} ${chalk.white(suggestion)}`);
      });

      console.log();
      console.log(chalk.gray("─".repeat(52)));
      console.log(
        chalk.gray(
          "\n💀 Copy one of the above, then run:\n" +
          chalk.white(`   git commit -m "<chosen message>"\n`) +
          chalk.gray("   ...or re-run: ") +
          chalk.white(`luvsean oath "<chosen message>"\n`)
        )
      );

      // Exit with non-zero so this can be used as a git hook later.
      process.exit(1);

    } else {
      // ── PASSED path ─────────────────────────────────────────────────────────
      console.log(GHOST_ACCEPT);
      console.log(
        chalk.green.bold("👻 The spirits accept your oath.\n")
      );
      console.log(
        chalk.green(`   "${message}"\n`)
      );
      console.log(
        chalk.green("   Committing to the void...\n")
      );
      console.log(chalk.gray("─".repeat(52)));

      // ── Optionally run the actual git commit ─────────────────────────────────
      try {
        const result = execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        console.log(chalk.green("\n✅ Committed!\n"));
        console.log(chalk.gray(result.trim()));
      } catch (err) {
        // No staged changes, or not a git repo — that's fine, the validation passed
        const output = err instanceof Error && "stderr" in err
          ? (err as NodeJS.ErrnoException & { stderr: string }).stderr
          : "";
        if (output.includes("nothing to commit") || output.includes("no changes added")) {
          console.log(
            chalk.yellow(
              "\n⚠️  Nothing staged to commit. Run `git add <files>` first.\n"
            )
          );
        } else if (output.includes("not a git repository")) {
          console.log(
            chalk.yellow(
              "\n⚠️  Not a git repository. The oath was accepted but nothing was committed.\n"
            )
          );
        } else {
          console.log(
            chalk.yellow("\n⚠️  Message passed, but git commit failed:\n") +
            chalk.gray(`   ${output || String(err)}\n`)
          );
        }
      }

      console.log(chalk.gray("─".repeat(52)));
      console.log(chalk.green.bold("\n🌑 The ritual is complete.\n"));

      // Same reason as whisper: explicit exit after all async work is done.
      process.exit(0);
    }
  });
