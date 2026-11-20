import { Command } from "commander";
import { orchestrate } from "../services/ai";
import { localRoute, extractParams, ALL_COMMANDS, type Route, type AetherCommand } from "../core/router";
export { localRoute, extractParams, type Route };
import { runCoffin } from "./coffin";
import { runResurrect } from "./resurrect";
import { runWhisper } from "./whisper";
import { runOath } from "./oath";
import { runSweep } from "./sweep";
import { runExorcise } from "./exorcise";
import { runDrift } from "./drift";
import { theme, hasAI, step, warn, note, rule, type ExitCode } from "../lib/ui";

export const LOGO = `
   ▄▀█ █▀▀ ▀█▀ █░█ █▀▀ █▀█
   █▀█ ██▄ ░█░ █▀█ ██▄ █▀▄`;

// ─── Dispatch (direct function calls — no argv re-parsing, no shell) ──────────

export async function dispatch(route: Route, original: string): Promise<ExitCode> {
  const p = route.params ?? original;
  switch (route.command) {
    case "coffin": return runCoffin(p);
    case "resurrect": return runResurrect();
    case "whisper": return runWhisper(p);
    case "oath": return runOath(p);
    case "sweep": return runSweep(undefined);
    case "exorcise": return runExorcise(undefined);
    case "drift": return runDrift(undefined);
  }
}

function printNoMatch(): void {
  warn("AETHER couldn't map that to a ritual.");
  console.log();
  note(`Rituals: ${ALL_COMMANDS.join(" · ")}`);
  note('Try:  aether "save my work, I was fixing the password reset"');
  note('      aether "explain this error: Cannot read properties of undefined"');
  note('      aether "scan for dead code"   ·   aether "compare my env files"');
  console.log();
}

export async function runAether(input: string, opts: { dryRun?: boolean } = {}): Promise<ExitCode> {
  console.log(theme.brand(LOGO));
  console.log(theme.dim("   Speak your intent. The terminal listens.\n"));
  console.log(`  ${theme.brand("›")} ${theme.text.italic(`"${input}"`)}\n`);

  let route: Route | null = null;
  if (hasAI()) {
    step("Understanding intent…");
    try { route = await orchestrate(input); }
    catch (err) { warn(`AI router unavailable (${err instanceof Error ? err.message : String(err)}) — using the offline router.`); }
  } else note("Offline router (add NEBIUS_API_KEY for full natural-language understanding).");
  if (!route) route = localRoute(input);
  if (!route) { printNoMatch(); return 1; }

  rule(theme.brand);
  console.log(`  ${theme.text(route.explanation)}`);
  console.log(`  ${theme.dim("routing →")} ${theme.brand.bold("aether " + route.command)}${route.params ? theme.dim(` "${route.params}"`) : ""}`);
  rule(theme.brand);
  if (opts.dryRun) return 0;
  return dispatch(route, input);
}

export const askCommand = new Command("ask")
  .alias("aether")
  .description("🌌 Speak your intent in plain English — AETHER picks the ritual")
  .argument("<request...>", "what you want to do")
  .option("--dry-run", "show the chosen ritual without running it")
  .action(async (parts: string[], o: { dryRun?: boolean }) => {
    process.exitCode = await runAether(parts.join(" "), o);
  });
