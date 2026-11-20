import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import * as G from "../lib/git";
import { theme, header, ok, warn, fail, note, rule, timeAgo, type ExitCode } from "../lib/ui";
import { COFFIN_JSON, type CoffinData } from "./coffin";

function loadCoffin(cwd: string): CoffinData | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, COFFIN_JSON), "utf-8")) as CoffinData;
  } catch {
    return null;
  }
}

/** Opens a file at a line in the user's editor (VS Code family first). */
function openInEditor(cwd: string, file: string, line?: number): boolean {
  const abs = path.join(cwd, file);
  if (!fs.existsSync(abs)) return false;
  const win = process.platform === "win32";
  const candidates: [string, string[]][] = [
    ["code", ["-g", `${abs}:${line ?? 1}`]],
    ["kiro", ["-g", `${abs}:${line ?? 1}`]],
  ];
  if (process.env.EDITOR) candidates.push([process.env.EDITOR, line ? [`+${line}`, abs] : [abs]]);
  for (const [bin, args] of candidates) {
    const r = spawnSync(bin, args, { stdio: "ignore", shell: win });
    if (!r.error && r.status === 0) return true;
  }
  return false;
}

export interface ResurrectOptions {
  open?: boolean;
  apply?: boolean;
}

export async function runResurrect(opts: ResurrectOptions = {}): Promise<ExitCode> {
  const cwd = process.cwd();
  header("💀", "RESURRECTION", "The dead have risen — here is where you stopped", theme.bad);

  const data = loadCoffin(cwd);
  if (!data) {
    const md = path.join(cwd, "COFFIN.md");
    if (fs.existsSync(md)) {
      warn("Only a plain COFFIN.md exists (no structured snapshot). Showing it as-is:\n");
      console.log(theme.dim(fs.readFileSync(md, "utf-8")));
      return 0;
    }
    fail("No coffin found in this directory.");
    note('Seal one first:  aether coffin "what you were doing"');
    return 1;
  }

  const sealed = new Date(data.sealedAt);
  console.log(theme.text.bold(`  Good morning. Sealed ${timeAgo(sealed)}`) + theme.dim(`  (${sealed.toLocaleString()})`));
  console.log();
  console.log(theme.dim("  Last words  ") + theme.text(`"${data.note}"`));
  console.log();
  console.log(theme.brand.bold("  Where you stopped"));
  console.log("  " + data.summary.replace(/`/g, ""));
  console.log();
  console.log(theme.ok.bold("  Do this next"));
  data.nextSteps.forEach((s, i) => console.log(`  ${theme.ok(String(i + 1) + ".")} ${s.replace(/`/g, "")}`));

  if (data.files.length) {
    console.log();
    console.log(theme.info.bold("  Files in flight"));
    data.files.slice(0, 8).forEach((f) => console.log(`  ${theme.dim("•")} ${f.file}${f.line ? theme.dim(":" + f.line) : ""} ${theme.dim("— " + f.label)}`));
  }
  if (data.resume.length) {
    console.log();
    console.log(theme.accent.bold("  Resume with"));
    data.resume.forEach((c) => console.log(`  ${theme.dim("$")} ${c}`));
  }

  // Drift check: has the repo moved since sealing?
  if (data.isGitRepo && G.isRepo(cwd)) {
    const branch = G.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const head = G.git(["rev-parse", "HEAD"]);
    console.log();
    if (branch && data.branch && branch !== data.branch) warn(`Branch changed: sealed on ${data.branch}, you are on ${branch}.`);
    if (head && data.head && head !== data.head) warn("HEAD moved since sealing (new commits, pull or rebase).");
  }

  if (opts.open) {
    console.log();
    let opened = 0;
    for (const f of data.files.filter((x) => x.status !== "D").slice(0, 6)) if (openInEditor(cwd, f.file, f.line)) opened++;
    if (opened) ok(`Reopened ${opened} file(s) at your last-edit lines.`);
    else warn("Could not launch an editor. Install the `code` CLI or set $EDITOR.");
  }

  if (opts.apply) {
    console.log();
    if (!data.stash) warn("This coffin has no stash snapshot to restore.");
    else if (!G.isRepo(cwd)) warn("Not a git repository.");
    else if (G.changedFiles().length) warn("Working tree is not clean — refusing to overwrite your current changes.");
    else if (G.git(["stash", "apply", data.stash]) === null) fail("Could not apply the stash (it may have been dropped or conflicts).");
    else ok(`Restored your uncommitted changes from stash ${data.stash.slice(0, 8)}.`);
  }

  console.log();
  rule();
  note("Now go build something hauntingly great.");
  console.log();
  return 0;
}

export const resurrectCommand = new Command("resurrect")
  .description("💀 Wake your saved context: summary, next steps, reopen files")
  .option("-o, --open", "reopen changed files at your last-edit line in your editor")
  .option("-a, --apply", "restore uncommitted changes from the coffin's stash (clean tree only)")
  .action(async (o: ResurrectOptions) => {
    process.exitCode = await runResurrect(o);
  });
