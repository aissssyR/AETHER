#!/usr/bin/env node

import * as dotenv from "dotenv";
dotenv.config(); // load .env before anything else reads process.env

import { Command } from "commander";
import { coffinCommand } from "./commands/coffin";
import { resurrectCommand } from "./commands/resurrect";
import { whisperCommand } from "./commands/whisper";
import { oathCommand } from "./commands/oath";
import { sweepCommand } from "./commands/sweep";
import { exorciseCommand } from "./commands/exorcise";
import { aetherCommand, runDefaultAether } from "./commands/aether";

const program = new Command();

program
  .name("aether")
  .description(
    "🌌 AETHER — Intelligent Terminal Operating Environment\n\n" +
    "  Speak naturally:  aether \"save my work, I was building the auth flow\"\n" +
    "  Manual override:  aether coffin | resurrect | whisper | oath | sweep | exorcise"
  )
  .version("2.0.0");

// ─── Natural Language Orchestrator (the star of the show) ─────────────────────
program.addCommand(aetherCommand);

// ─── Manual Override commands (for advanced users) ────────────────────────────
program.addCommand(coffinCommand);
program.addCommand(resurrectCommand);
program.addCommand(whisperCommand);
program.addCommand(oathCommand);
program.addCommand(sweepCommand);
program.addCommand(exorciseCommand);

// ─── Default behaviour: treat unrecognised input as a natural language request ─
//
// When the user runs `aether "save my work"` without the explicit `aether`
// sub-command prefix, Commander won't match any registered command. We catch
// that case here and pipe the raw args straight into AETHER's NLO.
//
// Commander fires the default action before its own error handling, so we
// only reach this if no sub-command matched.
program.action(async () => {
  // Grab everything after the binary name that isn't a flag
  const rawArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));

  if (rawArgs.length === 0) {
    // No args at all — print help
    program.help();
    return;
  }

  await runDefaultAether(rawArgs);
});

program.parseAsync(process.argv).catch((err) => {
  // Commander's exitOverride throws an object with code 'commander.helpDisplayed'
  // for --help; swallow it. Re-throw anything unexpected.
  const code = (err as { code?: string }).code;
  if (code !== "commander.helpDisplayed" && code !== "commander.version") {
    console.error(err);
    process.exit(1);
  }
});
