import { execFileSync } from "child_process";

/**
 * Runs git WITHOUT a shell (execFileSync + argv array) so user-controlled
 * strings can never be interpreted as shell syntax.
 */
export function git(args: string[], cwd: string = process.cwd()): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    }).replace(/\s+$/, "");
  } catch {
    return null;
  }
}

export function isRepo(cwd?: string): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], cwd) === "true";
}

export function repoRoot(cwd?: string): string | null {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

export interface ChangedFile {
  status: string; // M, A, D, R, ??
  file: string;
  label: string;
  line?: number; // first changed line (best-effort "where you stopped")
}

const LABELS: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "unmerged",
  "??": "untracked",
};

export function changedFiles(cwd?: string): ChangedFile[] {
  const out = git(["status", "--porcelain=v1", "-uall"], cwd);
  if (!out) return [];
  return out
    .split("\n")
    .filter((l) => l.length > 3)
    .map((line) => {
      const xy = line.slice(0, 2);
      let file = line.slice(3).trim();
      if (file.includes(" -> ")) file = file.split(" -> ")[1];
      file = file.replace(/^"|"$/g, "");
      const status = xy.trim() === "??" ? "??" : (xy[0] !== " " ? xy[0] : xy[1]);
      return { status, file, label: LABELS[status] ?? `changed (${status})` };
    })
    .filter((f) => !isAetherArtifact(f.file));
}

/** Files AETHER itself writes — never report them as "your work". */
export function isAetherArtifact(file: string): boolean {
  return file === "COFFIN.md" || file.startsWith(".aether/");
}

export function diffHead(cwd?: string): string {
  return git(["diff", "HEAD", "--", ".", ":(exclude)COFFIN.md", ":(exclude).aether"], cwd) ?? "";
}

/**
 * Maps file → line number of the first line actually added/changed (not the hunk
 * header or its context lines), parsed from a unified diff. Deletion-only changes
 * fall back to the line where the deletion happened.
 */
export function firstChangedLines(diff: string): Map<string, number> {
  const firstAdd = new Map<string, number>();
  const firstDel = new Map<string, number>();
  let current: string | null = null;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) { current = null; inHunk = false; continue; }
    if (!inHunk && line.startsWith("+++ ")) { current = line.startsWith("+++ b/") ? line.slice(6) : null; continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { newLine = Number(h[1]); inHunk = true; continue; }
    if (!inHunk || !current) continue;
    if (line.startsWith("+")) { if (!firstAdd.has(current)) firstAdd.set(current, newLine); newLine++; }
    else if (line.startsWith("-")) { if (!firstDel.has(current)) firstDel.set(current, newLine); }
    else if (line.startsWith("\\")) { /* "\ No newline at end of file" */ }
    else newLine++;
  }
  const result = new Map<string, number>(firstAdd);
  firstDel.forEach((v, k) => { if (!result.has(k)) result.set(k, Math.max(1, v)); });
  return result;
}

/**
 * Non-destructive snapshot of tracked changes: `git stash create` builds a
 * commit object but leaves the working tree untouched; `stash store` makes
 * it reachable so git never garbage-collects it.
 */
export function snapshotStash(message: string, cwd?: string): string | null {
  const sha = git(["stash", "create", message], cwd);
  if (!sha) return null;
  git(["stash", "store", "-m", message, sha], cwd);
  return sha;
}

export function ensureLocalExclude(patterns: string[], cwd?: string): void {
  const p = git(["rev-parse", "--git-path", "info/exclude"], cwd);
  if (!p) return;
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const abs = path.isAbsolute(p) ? p : path.join(cwd ?? process.cwd(), p);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf-8") : "";
    const missing = patterns.filter((x) => !existing.split("\n").includes(x));
    if (missing.length) {
      fs.appendFileSync(abs, `${existing.endsWith("\n") || !existing ? "" : "\n"}${missing.join("\n")}\n`);
    }
  } catch {
    /* non-fatal */
  }
}
