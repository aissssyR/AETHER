import { Command } from "commander";
import chalk from "chalk";
import { orchestrateWithAI, type AetherCommand } from "../services/ai";

// ─── Import the underlying command action handlers ─────────────────────────────
// We call each command's core logic directly, bypassing Commander's argv
// parser so we can pass programmatically extracted params.
import { coffinCommand } from "./coffin";
import { resurrectCommand } from "./resurrect";
import { whisperCommand } from "./whisper";
import { oathCommand } from "./oath";
import { sweepCommand } from "./sweep";
import { exorciseCommand } from "./exorcise";

// ─── AETHER boot banner ────────────────────────────────────────────────────────

const AETHER_BANNER = chalk.cyan(`
  ╔══════════════════════════════════════════════════════════╗
  ║                                                          ║
  ║        ░█████╗░███████╗████████╗██╗  ██╗███████╗██████╗ ║
  ║        ██╔══██╗██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗║
  ║        ███████║█████╗     ██║   ███████║█████╗  ██████╔╝║
  ║        ██╔══██║██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗║
  ║        ██║  ██║███████╗   ██║   ██║  ██║███████╗██║  ██║║
  ║        ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝║
  ║                                                          ║
  ║      Intelligent Terminal Operating Environment          ║
  ╚══════════════════════════════════════════════════════════╝
`);

// ─── Static keyword fallback (no API key) ─────────────────────────────────────

/**
 * Pattern-based command router for when no API key is set.
 * Not as smart as the AI path, but keeps AETHER useful offline.
 */
function localOrchestrate(
  input: string
): { command: AetherCommand; params: string | null; explanation: string } | null {
  const lower = input.toLowerCase();

  // coffin — save / seal / store / stash / put to bed / commit context
  if (
    lower.includes("save") ||
    lower.includes("seal") ||
    lower.includes("stash") ||
    lower.includes("store") ||
    lower.includes("put to bed") ||
    lower.includes("close the lid") ||
    lower.includes("coffin")
  ) {
    // Try to extract a message after trigger words
    const msgMatch = input.match(
      /(?:save|seal|stash|store|coffin|context|work)[^"]*?[:"']?\s*["']?(.{5,}?)["']?\s*$/i
    );
    const params = msgMatch ? msgMatch[1].replace(/^["']|["']$/g, "").trim() : input;
    return {
      command: "coffin",
      params,
      explanation: `Sealing your current context into COFFIN.md with the message: "${params}".`,
    };
  }

  // resurrect — wake up / restore / open / read context
  if (
    lower.includes("resurrect") ||
    lower.includes("wake") ||
    lower.includes("restore context") ||
    lower.includes("read context") ||
    lower.includes("what was i") ||
    lower.includes("where was i") ||
    lower.includes("open coffin")
  ) {
    return {
      command: "resurrect",
      params: null,
      explanation: "Rising from the dead — reading your saved COFFIN.md context.",
    };
  }

  // whisper — explain / decode / what does this error mean
  if (
    lower.includes("whisper") ||
    lower.includes("explain") ||
    lower.includes("what does") ||
    lower.includes("decode") ||
    lower.includes("error") ||
    lower.includes("what is") ||
    lower.includes("translate")
  ) {
    const params = input.replace(/^(whisper|explain|decode|translate)\s+/i, "").trim();
    return {
      command: "whisper",
      params: params || input,
      explanation: `Translating the error or message into plain English.`,
    };
  }

  // oath — commit / validate commit message
  if (
    lower.includes("oath") ||
    lower.includes("commit") ||
    lower.includes("validate") ||
    lower.includes("check my message")
  ) {
    const params = input.replace(/^(oath|commit|validate|check my message)\s+/i, "").trim();
    return {
      command: "oath",
      params: params || input,
      explanation: `Validating your commit message and committing if it passes.`,
    };
  }

  // sweep — scan / find dead code / check for dead files
  if (
    lower.includes("sweep") ||
    lower.includes("dead code") ||
    lower.includes("scan") ||
    lower.includes("find unused") ||
    lower.includes("clean")
  ) {
    return {
      command: "sweep",
      params: null,
      explanation: "Scanning for dead code, unused files, and forgotten stubs.",
    };
  }

  // exorcise — zombies / deprecated dependencies / old packages
  if (
    lower.includes("exorcise") ||
    lower.includes("zombie") ||
    lower.includes("deprecated") ||
    lower.includes("dependencies") ||
    lower.includes("old packages") ||
    lower.includes("outdated")
  ) {
    return {
      command: "exorcise",
      params: null,
      explanation: "Scanning your dependencies for zombie libraries and suggesting modern replacements.",
    };
  }

  return null;
}

// ─── Commands that require a mandatory argument ────────────────────────────────

const REQUIRES_PARAM = new Set<AetherCommand>(["coffin", "whisper", "oath"]);

// ─── Command dispatcher ────────────────────────────────────────────────────────

/**
 * Programmatically invokes the matched Commander sub-command by parsing a
 * synthetic argv array. This reuses all the existing command logic exactly
 * as-is, including their banners and exit calls.
 *
 * @param fallbackInput - the original NL input, used when the AI returns
 *   null params for a command that requires a mandatory argument.
 */
async function dispatchCommand(
  command: AetherCommand,
  params: string | null,
  fallbackInput: string
): Promise<void> {
  // Build a minimal argv that Commander will accept:
  // [ 'node', 'aether', <command>, ...args ]
  const argv: string[] = ["node", "aether", command];

  // For commands with a required argument, fall back to the full NL input
  // when the AI or local matcher couldn't extract a specific param.
  const resolvedParam = params ?? (REQUIRES_PARAM.has(command) ? fallbackInput : null);
  if (resolvedParam) argv.push(resolvedParam);

  const router = new Command();
  router.addCommand(coffinCommand);
  router.addCommand(resurrectCommand);
  router.addCommand(whisperCommand);
  router.addCommand(oathCommand);
  router.addCommand(sweepCommand);
  router.addCommand(exorciseCommand);

  // exitOverride prevents Commander from calling process.exit on --help / errors
  router.exitOverride();

  await router.parseAsync(argv);
}

// ─── Command definition ────────────────────────────────────────────────────────

export const aetherCommand = new Command("aether")
  .description("🌌 Natural Language Orchestrator — tell AETHER what you want in plain English")
  .argument("<request...>", "What you want to do (in plain English)")
  .action(async (requestParts: string[]) => {
    const input = requestParts.join(" ").trim();

    console.log(AETHER_BANNER);
    console.log(chalk.cyan(`  🌌 Processing: ${chalk.white.italic(`"${input}"`)}\n`));

    const hasApiKey =
      process.env.NEBIUS_API_KEY &&
      process.env.NEBIUS_API_KEY !== "your_nebius_api_key_here";

    let command: AetherCommand;
    let params: string | null;
    let explanation: string;

    if (hasApiKey) {
      // ── AI orchestration path ─────────────────────────────────────────────────
      console.log(chalk.cyan("  ⚡ AETHER is thinking...\n"));
      try {
        const result = await orchestrateWithAI(input);

        if (!result) {
          console.log(chalk.yellow("  ⚠️  AETHER has no API key configured. Falling back to pattern matching.\n"));
          const local = localOrchestrate(input);
          if (!local) return printNoMatch(input);
          ({ command, params, explanation } = local);
        } else {
          ({ command, params, explanation } = result);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`  ⚠️  AETHER's mind went silent (${reason}).\n`));
        console.log(chalk.gray("  Falling back to pattern matching...\n"));
        const local = localOrchestrate(input);
        if (!local) return printNoMatch(input);
        ({ command, params, explanation } = local);
      }
    } else {
      // ── Local pattern-matching path ────────────────────────────────────────────
      console.log(
        chalk.gray("  💡 No NEBIUS_API_KEY — using local pattern matching.\n") +
        chalk.gray("     Add your key to .env to enable full AI orchestration.\n\n")
      );
      const local = localOrchestrate(input);
      if (!local) return printNoMatch(input);
      ({ command, params, explanation } = local);
    }

    // ── Print AETHER's intent ──────────────────────────────────────────────────
    console.log(chalk.cyan("─".repeat(60)));
    console.log(chalk.cyan(`\n  🌌 AETHER: ${explanation}\n`));
    console.log(
      chalk.gray(`  Routing to: `) +
      chalk.cyan.bold(`aether ${command}`) +
      (params ? chalk.gray(` "${params}"`) : "")
    );
    console.log(chalk.cyan("\n─".repeat(60)) + "\n");

    // ── Execute the matched command ────────────────────────────────────────────
    await dispatchCommand(command, params, input);
  });

// ─── Default action (no subcommand — treat raw args as natural language) ───────

/**
 * Wires up AETHER as the default behavior of the root program when no
 * recognised sub-command is provided. Called from index.ts.
 */
export async function runDefaultAether(args: string[]): Promise<void> {
  const input = args.join(" ").trim();
  if (!input) return;

  // Re-use the aether command's action by synthesising argv
  const synthetic = new Command();
  synthetic.addCommand(aetherCommand);
  synthetic.exitOverride();
  try {
    await synthetic.parseAsync(["node", "aether-root", "aether", ...args]);
  } catch {
    // Commander may throw ExitError on --help; swallow it
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function printNoMatch(input: string): void {
  console.log(chalk.yellow("  ⚠️  AETHER couldn't map your request to a known tool.\n"));
  console.log(chalk.gray("  Available tools: coffin · resurrect · whisper · oath · sweep · exorcise\n"));
  console.log(chalk.gray("  Try being more specific, e.g.:"));
  console.log(chalk.gray(`    aether "save my work, I was building the auth module"`));
  console.log(chalk.gray(`    aether "explain this error: Cannot read property of undefined"`));
  console.log(chalk.gray(`    aether "check my commit message: add login flow"\n`));
  console.log(chalk.gray("  Or use a tool directly (Manual Override):"));
  console.log(chalk.gray(`    aether coffin "my message"`));
  console.log(chalk.gray(`    aether whisper "error text"\n`));
}
