import { Command } from "commander";
import chalk from "chalk";
import { callAI } from "../services/ai";

// ─── Spooky ASCII banner ───────────────────────────────────────────────────────
const WHISPER_BANNER = chalk.cyan(`
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░  👂  THE GHOST LISTENS...  👂  ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░
`);

// ─── System prompt ─────────────────────────────────────────────────────────────
const WHISPER_SYSTEM_PROMPT =
  "You are a spooky senior developer ghost. Translate this cryptic error message " +
  "into plain English. Explain exactly what caused it and how to fix it in 1-2 sentences. " +
  "Keep the tone hauntingly helpful.";

// ─── Heuristic fallback (no API key) ──────────────────────────────────────────

/**
 * Pattern-based error hints for the most common errors.
 * Runs entirely locally when no API key is set.
 */
function localWhisper(errorMessage: string): string {
  const msg = errorMessage.toLowerCase();

  if (msg.includes("cannot read propert") || msg.includes("cannot read properties")) {
    return "You're trying to access a property on something that is null or undefined. " +
      "Add a null check (e.g. `if (obj)`) or use optional chaining (`obj?.property`) before accessing it.";
  }
  if (msg.includes("enoent") || msg.includes("no such file")) {
    return "A file or directory doesn't exist at the path you specified. " +
      "Double-check the path, make sure the file was created, and watch out for case-sensitivity on Linux/macOS.";
  }
  if (msg.includes("eaddrinuse") || msg.includes("address already in use")) {
    return "Something else is already listening on that port. " +
      "Kill the other process (`npx kill-port <port>`) or change your app's port in the config.";
  }
  if (msg.includes("syntaxerror") || msg.includes("unexpected token")) {
    return "Your code has a syntax error — a missing bracket, comma, or quote. " +
      "Check the line number in the stack trace and look for mismatched parentheses or braces.";
  }
  if (msg.includes("typeerror")) {
    return "You passed the wrong type to a function or operation (e.g. calling a method on undefined). " +
      "Check what value you're passing and what the function expects.";
  }
  if (msg.includes("module not found") || msg.includes("cannot find module")) {
    return "Node can't find the module you're importing. " +
      "Run `npm install` to restore dependencies, or check that the import path and file name are correct.";
  }
  if (msg.includes("cors")) {
    return "Your browser is blocking the request because the server didn't send the right CORS headers. " +
      "Add `Access-Control-Allow-Origin` to your server's response or use a CORS middleware like `cors` for Express.";
  }
  if (msg.includes("401") || msg.includes("unauthorized")) {
    return "The request was rejected because authentication failed. " +
      "Check that your token or API key is valid, correctly formatted, and being sent in the right header.";
  }
  if (msg.includes("403") || msg.includes("forbidden")) {
    return "You're authenticated but don't have permission for this action. " +
      "Check the resource's access control settings or your user's role/scopes.";
  }
  if (msg.includes("504") || msg.includes("timeout") || msg.includes("timed out")) {
    return "The request took too long and was cut off. " +
      "Check if the downstream service is healthy, and consider increasing timeout limits or adding a retry.";
  }

  return "This error didn't match any known pattern. " +
    "Set your NEBIUS_API_KEY in .env to get an AI-powered explanation.";
}

// ─── Command definition ─────────────────────────────────────────────────────────

export const whisperCommand = new Command("whisper")
  .description("👂 Translate a cryptic error message into plain, spooky English")
  .argument("<error>", "The error message you want explained")
  .action(async (error: string) => {
    console.log(WHISPER_BANNER);
    console.log(chalk.cyan(`📜 Error received:\n`));
    console.log(chalk.gray.italic(`   "${error}"\n`));

    const hasApiKey =
      process.env.NEBIUS_API_KEY &&
      process.env.NEBIUS_API_KEY !== "your_nebius_api_key_here";

    if (hasApiKey) {
      // ── AI path ───────────────────────────────────────────────────────────────
      console.log(chalk.cyan("👻 The ghost is deciphering the curse...\n"));
      try {
        const explanation = await callAI(WHISPER_SYSTEM_PROMPT, error, 0.5);

        if (explanation) {
          console.log(chalk.cyan("─".repeat(52)));
          console.log();
          console.log(chalk.cyan.bold("💬 The Ghost Speaks:"));
          console.log();

          // Print each sentence on its own line for readability
          explanation
            .split(/(?<=[.!?])\s+/)
            .forEach((sentence) => {
              console.log(chalk.cyan(`   ${sentence.trim()}`));
            });

          console.log();
          console.log(chalk.cyan("─".repeat(52)));
          console.log(chalk.gray("\n🕯️  May your bugs be banished to the shadow realm.\n"));
        } else {
          printFallback(error);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`⚠️  The ghost went silent (${reason}).\n`));
        console.log(chalk.gray("   Falling back to local knowledge...\n"));
        printFallback(error);
      }
    } else {
      // ── Local fallback path ────────────────────────────────────────────────────
      console.log(
        chalk.gray("💡 No NEBIUS_API_KEY — using local pattern matching.\n") +
        chalk.gray("   Add your key to .env for AI-powered explanations.\n")
      );
      printFallback(error);
    }

    // The OpenAI SDK (undici-based fetch) keeps an internal connection pool
    // that holds a libuv handle open. For a short-lived CLI this prevents a
    // clean natural exit on Windows, producing the async.c assertion.
    // Calling process.exit() after all async work is fully awaited is the
    // correct fix — there is nothing left to clean up at this point.
    process.exit(0);
  });
// ─── Helpers ───────────────────────────────────────────────────────────────────

function printFallback(error: string): void {
  const hint = localWhisper(error);
  console.log(chalk.cyan("─".repeat(52)));
  console.log();
  console.log(chalk.cyan.bold("💬 Local Spirit Knowledge:"));
  console.log();
  console.log(chalk.cyan(`   ${hint}`));
  console.log();
  console.log(chalk.cyan("─".repeat(52)));
  console.log(chalk.gray("\n🕯️  May your bugs be banished to the shadow realm.\n"));
}
