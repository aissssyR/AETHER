#!/usr/bin/env node
import * as dotenv from "dotenv";
dotenv.config();

import { Command } from "commander";
import { coffinCommand } from "./commands/coffin";
import { resurrectCommand } from "./commands/resurrect";
import { whisperCommand } from "./commands/whisper";
import { oathCommand } from "./commands/oath";
import { sweepCommand } from "./commands/sweep";
import { exorciseCommand } from "./commands/exorcise";
import { driftCommand } from "./commands/drift";
import { askCommand, runAether } from "./commands/aether";
import { mcpCommand } from "./commands/mcp";

const program = new Command();

program
  .name("aether")
  .description(
    "AETHER — the haunted terminal.\n\n" +
      '  Speak naturally:   aether "save my work, I was fixing the reset-token bug"\n' +
      "  Or call a ritual:  coffin · resurrect · whisper · oath · sweep · exorcise · drift"
  )
  .version("3.0.0")
  .argument("[request...]", "a request in plain English")
  .option("--dry-run", "show which ritual would run, without running it")
  .showHelpAfterError("(run `aether --help` for the list of rituals)");

[coffinCommand, resurrectCommand, whisperCommand, oathCommand, sweepCommand, exorciseCommand, driftCommand, askCommand, mcpCommand].forEach((c) => program.addCommand(c));

program.action(async (request: string[], o: { dryRun?: boolean }) => {
  if (!request.length) return program.help();
  process.exitCode = await runAether(request.join(" "), o);
});

program
  .parseAsync(process.argv)
  .then(() => process.exit(process.exitCode ?? 0)) // the HTTP client may keep handles open; exit once work is done
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
