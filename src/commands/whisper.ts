import { Command } from "commander";
import { callAI } from "../services/ai";
import { theme, header, step, warn, note, rule, hasAI, noAIHint, type ExitCode } from "../lib/ui";

import { localWhisper } from "../core/whisper";
export { localWhisper };

// ─── Core ──────────────────────────────────────────────────────────────────────

export async function runWhisper(error: string, opts: { lang?: string } = {}): Promise<ExitCode> {
  header("👂", "ERROR TRANSLATOR", "From ghost-speak to human", theme.info);
  const preview = error.length > 400 ? error.slice(0, 400) + "…" : error;
  console.log(theme.dim("  Heard:"));
  preview.split("\n").slice(0, 8).forEach((l) => console.log(theme.dim.italic("    " + l)));
  console.log();

  let cause = "";
  let fix = "";
  let aiText: string | null = null;

  if (hasAI()) {
    step("The ghost is deciphering the curse…");
    try {
      const lang = opts.lang === "id" ? "Bahasa Indonesia" : "English";
      aiText = await callAI(
        `You are a calm senior developer. Translate the error into plain ${lang}. ` +
          "Reply in exactly two short parts: 'CAUSE: …' (what happened and why, in the user's likely context) " +
          "and 'FIX: …' (the most likely concrete fix; mention a code snippet only if it is short). No preamble.",
        error.slice(0, 4000),
        0.3
      );
    } catch (err) {
      warn(`AI unavailable (${err instanceof Error ? err.message : String(err)}) — using the local grimoire.`);
    }
  } else noAIHint("translating with the built-in pattern grimoire");

  if (aiText) {
    const c = aiText.match(/CAUSE:\s*([\s\S]*?)(?:\n\s*FIX:|$)/i);
    const f = aiText.match(/FIX:\s*([\s\S]*)$/i);
    cause = c ? c[1].trim() : aiText.trim();
    fix = f ? f[1].trim() : "";
  } else {
    const local = localWhisper(error);
    if (local) ({ cause, fix } = local);
  }

  rule(theme.info);
  if (!cause) {
    warn("This curse isn't in the grimoire yet.");
    note("Add NEBIUS_API_KEY to .env for AI translation of any error.");
  } else {
    console.log();
    console.log(theme.info.bold("  What happened"));
    console.log("  " + cause);
    if (fix) {
      console.log();
      console.log(theme.ok.bold("  How to fix it"));
      console.log("  " + fix);
    }
    console.log();
  }
  rule(theme.info);
  console.log();
  return cause ? 0 : 1;
}

/** Reads piped stdin (e.g. `npm run build 2>&1 | aether whisper`). */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

export const whisperCommand = new Command("whisper")
  .description("👂 Translate a cryptic error into plain language (argument or piped stdin)")
  .argument("[error...]", "the error text (or pipe it in)")
  .option("-l, --lang <code>", "language of the AI explanation: en | id", "en")
  .action(async (parts: string[], o: { lang: string }) => {
    const text = parts.join(" ").trim() || (await readStdin());
    if (!text) {
      warn('Nothing to translate. Usage: aether whisper "<error>"  or  cmd 2>&1 | aether whisper');
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runWhisper(text, { lang: o.lang });
  });
