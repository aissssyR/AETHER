// Pure commit-message judgement: no I/O, runs in Node and in the browser.


const LAZY = new Set([
  "fix", "fixes", "fixed", "bug", "bugs", "update", "updates", "updated", "wip", "stuff", "things", "thing",
  "change", "changes", "changed", "misc", "temp", "tmp", "test", "tests", "asdf", "qwerty", "lol", "idk",
  "done", "commit", "work", "working", "code", "final", "minor", "tweak", "edit", "edits",
]);
const FILLER = new Set(["the", "a", "an", "of", "in", "on", "to", "some", "and", "it", "this", "that", "again", "more", "now", "my", "please", "just"]);
const TYPES = "feat|fix|refactor|docs|test|chore|perf|build|ci|style|revert";
const CONVENTIONAL = new RegExp(`^(${TYPES})(\\([\\w\\-./]+\\))?(!)?: (.+)$`, "i");
const AUTO_MESSAGE = /^(Merge |Revert "|fixup! |squash! |amend! )/;

export interface Verdict {
  passed: boolean;
  reason: string;
}

/**
 * A commit is weak when its *meaningful* words are missing — not merely when it
 * contains a word like "fix". `fix: resolve null pointer in AuthController` is a
 * great message; `fix bug` is not.
 */
export function validateCommit(message: string, strict = false): Verdict {
  const msg = message.trim().split("\n")[0].trim();
  if (AUTO_MESSAGE.test(msg)) return { passed: true, reason: "" };

  const m = msg.match(CONVENTIONAL);
  const desc = m ? m[4].trim() : msg;
  const words = desc.toLowerCase().match(/[a-z0-9_'.-]+/g) ?? [];
  const meaningful = words.filter((w) => !LAZY.has(w) && !FILLER.has(w));

  if (strict && !m) return { passed: false, reason: "Must follow Conventional Commits: type(scope): description." };
  if (desc.length < 8) return { passed: false, reason: `Only ${desc.length} characters — say what actually changed.` };
  if (words.length < 2) return { passed: false, reason: "A single word is not a commit message." };
  if (meaningful.length === 0) return { passed: false, reason: "Only filler words — nothing says what changed." };
  if (!m && meaningful.length < 2) return { passed: false, reason: "Too vague — name the thing you changed and how." };
  return { passed: true, reason: "" };
}


// ─── Local suggestions (diff-aware, no AI needed) ──────────────────────────────

const posixBase = (f: string) => f.slice(f.lastIndexOf("/") + 1);

/** Three specific, valid commit messages derived from the changed files. Pure. */
export function suggestFromFiles(weak: string, files: { file: string; status: string }[]): string[] {
  const names = files.map((f) => f.file);
  const clean = (x: string) => x.replace(/^\.+/, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const base = (f: string) => clean(posixBase(f).replace(/\.[^.]+$/, "")) || clean(posixBase(f)) || "project";
  const scopeDir = names.length ? clean(names[0].split("/").slice(0, -1).filter((p) => p !== "src").pop() ?? "") : "";
  const scope = scopeDir || (names[0] ? base(names[0]) : "core");
  let subject = [...new Set(names.slice(0, 3).map(base))].slice(0, 2).join(" and ") || "module logic";
  // Found by property-based testing: a very short name ("a") made the suggestion fail our own validator.
  if (subject.length < 10) subject += " module";

  let type = "refactor";
  if (names.length && names.every((n) => /\.(md|txt)$/i.test(n))) type = "docs";
  else if (names.length && names.every((n) => /(\.test\.|\.spec\.|(^|\/)tests?\/)/.test(n))) type = "test";
  else if (names.some((n) => /package(-lock)?\.json$|\.ya?ml$|tsconfig/.test(n))) type = "chore";
  else if (/bug|fix|error|crash|broken/i.test(weak)) type = "fix";
  else if (files.some((f) => f.status === "A" || f.status === "??")) type = "feat";

  const verbFor: Record<string, string> = { fix: "resolve issue in", feat: "add", docs: "document", test: "cover", chore: "update configuration for", refactor: "restructure" };
  return [
    `${type}(${scope}): ${verbFor[type]} ${subject}`,
    `${type === "fix" ? "refactor" : "fix"}(${scope}): handle edge cases in ${subject}`,
    `chore(${scope}): clean up ${subject} and improve readability`,
  ];
}
