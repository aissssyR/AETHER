import type { ContextAnalysis } from "../services/ai";

// Pure coffin helpers: no I/O, runs in Node and in the browser.

export interface CoffinFile {
  file: string;
  status: string;
  label: string;
  line?: number;
}

export interface CoffinData {
  version: 1;
  sealedAt: string;
  cwd: string;
  note: string;
  branch: string | null;
  head: string | null;
  stash: string | null;
  isGitRepo: boolean;
  files: CoffinFile[];
  summary: string;
  nextSteps: string[];
  resume: string[];
  source: "ai" | "local";
  model?: string;
}


export function localAnalysis(files: CoffinFile[], noteText: string): ContextAnalysis {
  const names = files.map((f) => f.file);
  const touched = files.slice(0, 3).map((f) => `\`${f.file}${f.line ? ":" + f.line : ""}\``).join(", ");
  const summary = files.length
    ? `You were working on ${touched}${files.length > 3 ? ` and ${files.length - 3} more file(s)` : ""} — "${noteText}".`
    : `No uncommitted changes were found. Your note: "${noteText}".`;

  const steps: string[] = [];
  if (files[0]) steps.push(`Reopen \`${files[0].file}\`${files[0].line ? ` at line ${files[0].line}` : ""} — that is where your last edit landed.`);
  const hasTests = names.some((n) => /\.(test|spec)\./.test(n) || /(^|\/)tests?\//.test(n));
  if (!hasTests && names.some((n) => /\.(ts|js|py|php|go|rb)$/.test(n))) steps.push("No test file was touched — add or run a test for the logic you changed.");
  else if (hasTests) steps.push("Run the test suite — you had test files in progress.");
  if (files.some((f) => f.status === "D")) steps.push("Double-check the deleted files — make sure no needed logic was lost.");
  if (files.some((f) => f.status === "??")) steps.push("Decide whether the new untracked files should be committed or ignored.");
  if (files.length > 5) steps.push(`Large change set (${files.length} files) — consider splitting it into smaller commits.`);
  steps.push("Review `git diff` and commit with a meaningful message (`aether oath`).");
  return { context_summary: summary, next_steps: steps.slice(0, 5) };
}

export function renderCoffinMarkdown(d: CoffinData): string {
  const files = d.files.length
    ? d.files.map((f) => `- \`${f.file}\`${f.line ? ` (line ${f.line})` : ""} — ${f.label}`).join("\n")
    : "_Working tree was clean._";
  const steps = d.nextSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const resume = d.resume.length ? d.resume.map((c) => `- \`${c}\``).join("\n") : "_none detected_";
  return `# ⚰️ COFFIN

> Sealed ${d.sealedAt} · branch \`${d.branch ?? "n/a"}\` · HEAD \`${d.head?.slice(0, 8) ?? "n/a"}\`

## Last words
> ${d.note}

## Where you stopped
${d.summary}

## Next steps
${steps}

## Files in flight (${d.files.length})
${files}

## Resume with
${resume}

## Snapshot
${d.stash ? `Uncommitted changes are preserved as stash \`${d.stash.slice(0, 8)}\` (restore: \`aether resurrect --apply\`).` : "No stash created (nothing to preserve)."}

---
_Analysis: ${d.source === "ai" ? `AI · ${d.model}` : "local heuristics"} · sealed with \`aether coffin\`, wake with \`aether resurrect\`_
`;
}

