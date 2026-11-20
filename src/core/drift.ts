import type { SourceFile } from "./types";
// Pure drift analysis: no I/O, runs in Node and in the browser.

export interface EnvFile { name: string; keys: Map<string, string> }

export function parseEnv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (!/^['"]/.test(v)) v = v.split(/\s+#/)[0].trim();
    map.set(m[1], v.replace(/^['"]|['"]$/g, ""));
  }
  return map;
}


export const BUILTIN = new Set(["NODE_ENV", "PATH", "HOME", "PWD", "USER", "SHELL", "TERM", "CI", "PORT", "HOST", "LANG", "TZ", "DEBUG"]);


// ─── Safe example generation ───────────────────────────────────────────────────

const SAFE_VALUE = /^(true|false|\d{1,5}|localhost|127\.0\.0\.1|development|production|staging|test|local|debug|info|warn|error|utf-?8|en|id|UTC)$/i;
const SECRET_KEY = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|API_?KEY|_KEY$|^KEY$|CREDENTIAL|SALT|DSN|WEBHOOK)/i;
const SECRET_VALUE = /^(sk_(live|test)_|pk_live_|ghp_|gho_|xox[bap]-|AKIA[0-9A-Z]{12}|eyJ[\w-]{10,}\.)|^[A-Za-z0-9+/=_-]{32,}$/;

/** Placeholder to put in .env.example: keeps harmless values, blanks everything else. */
export function exampleValue(key: string, value: string): string {
  if (SECRET_KEY.test(key)) return "";
  return SAFE_VALUE.test(value) ? value : "";
}


export type Issue = { level: "error" | "warn"; msg: string };

/** Compares env files (+ variables read from code) and returns de-duplicated issues. */
export function analyzeDrift(all: EnvFile[], exampleFile: EnvFile | undefined, used: Map<string, string>): { union: Set<string>; unique: Issue[] } {
  const envs = all.filter((f) => f !== exampleFile);
  const union = new Set<string>();
  all.forEach((f) => f.keys.forEach((_, k) => union.add(k)));
  used.forEach((_, k) => union.add(k));

  const issues: Issue[] = [];
  const ex = exampleFile?.keys;

  if (!exampleFile) issues.push({ level: "warn", msg: "No .env.example — new developers have nothing to copy." });
  if (ex) {
    for (const env of envs) for (const k of env.keys.keys()) if (!ex.has(k)) issues.push({ level: "error", msg: `${k} exists in ${env.name} but is missing from ${exampleFile!.name}` });
    for (const [k, file] of used) if (!ex.has(k) && !envs.some((e) => e.keys.has(k))) issues.push({ level: "error", msg: `${k} is read in ${file} but defined in no env file` });
    for (const [k, file] of used) if (!ex.has(k) && envs.some((e) => e.keys.has(k)) && !issues.some((i) => i.msg.startsWith(k + " exists"))) issues.push({ level: "warn", msg: `${k} (read in ${file}) is not documented in ${exampleFile!.name}` });
    for (const k of ex.keys()) if (!used.has(k) && !BUILTIN.has(k) && used.size) issues.push({ level: "warn", msg: `${k} is in ${exampleFile!.name} but no code reads it (stale?)` });
  }
  for (const env of envs) for (const k of union) {
    if (env.keys.has(k)) continue;
    // only complain about variables the team has agreed on: documented in the example, read in code, or (no example) present elsewhere
    const agreed = ex ? ex.has(k) || used.has(k) : true;
    if (agreed) issues.push({ level: "warn", msg: `${k} is missing from ${env.name}` });
  }
  for (const env of envs) for (const [k, v] of env.keys) if (v === "" && !SECRET_KEY.test(k)) issues.push({ level: "warn", msg: `${k} is empty in ${env.name}` });
  if (exampleFile) for (const [k, v] of exampleFile.keys) if (v && (SECRET_VALUE.test(v) || (SECRET_KEY.test(k) && v.length > 6 && !/^(your|change|xxx|<|\.\.\.|example|replace)/i.test(v)))) issues.push({ level: "error", msg: `${exampleFile.name} has what looks like a real secret in ${k} — never commit values` });

  // de-duplicate
  const seen = new Set<string>();
  const unique = issues.filter((i) => (seen.has(i.msg) ? false : (seen.add(i.msg), true)));

  return { union, unique };
}

/** Builds the new .env.example text. Secret values are always blanked. */
export function buildExample(existing: string | null, missing: string[], known: Map<string, string>, descriptions: Record<string, string> = {}): string {
  let body = existing !== null ? existing.replace(/\s*$/, "\n") : "# Copy to .env and fill in the values. Never commit real secrets.\n";
  if (missing.length) {
    body += existing !== null ? "\n# ── added by aether drift --fix ──\n" : "\n";
    for (const k of missing) {
      if (descriptions[k]) body += `# ${String(descriptions[k]).replace(/\n/g, " ")}\n`;
      body += `${k}=${exampleValue(k, known.get(k) ?? "")}\n`;
    }
  }
  return body;
}

/** Variables read in source code (process.env.X, os.getenv("X"), env("X"), $_ENV["X"] …) → first file reading it. */
export function keysUsedIn(files: SourceFile[]): Map<string, string> {
  const used = new Map<string, string>();
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]+)/g,
    /process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
    /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
    /os\.(?:getenv|environ\.get)\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /os\.environ\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
    /\benv\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /\$_(?:ENV|SERVER)\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
    /\bgetenv\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /os\.Getenv\(\s*"([A-Z][A-Z0-9_]+)"/g,
  ];
  for (const f of files) for (const re of patterns) for (const m of f.text.matchAll(re)) if (!BUILTIN.has(m[1]) && !used.has(m[1])) used.set(m[1], f.rel);
  return used;
}
