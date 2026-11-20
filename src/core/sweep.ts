import type { SourceFile } from "./types";


// Tiny POSIX path helpers (no node:path so the bundle runs in a browser).
const posix = {
  dirname: (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "."),
  basename: (p: string) => p.slice(p.lastIndexOf("/") + 1),
  join: (...parts: string[]) => parts.filter(Boolean).join("/"),
  normalize: (p: string) => {
    const out: string[] = [];
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === ".." && out.length && out[out.length - 1] !== "..") out.pop();
      else out.push(seg);
    }
    return out.join("/") || ".";
  },
};

// Pure analysis: works on in-memory files, so it runs in Node (CLI) and in the browser (playground).

// ─── Types ─────────────────────────────────────────────────────────────────────

type Kind = "function" | "class" | "method" | "file";
type Confidence = "high" | "medium";

export interface DeadItem {
  name: string;
  kind: Kind;
  file: string;
  line: number;
  confidence: Confidence;
  why: string;
}

export const DECL_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".php"]);
export const USAGE_EXTS = new Set([...DECL_EXTS, ".html", ".vue", ".svelte", ".ejs", ".hbs", ".twig", ".blade.php", ".json", ".yml", ".yaml"]);
const JS_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

/** Names that frameworks call by convention — never report these as dead. */
const ENTRY_NAMES = new Set([
  "main", "handler", "default", "index", "setup", "teardown", "boot", "register", "handle", "up", "down",
  "render", "constructor", "toString", "toJSON", "rules", "authorize", "build", "definition", "run",
  "execute", "invoke", "middleware", "config", "loader", "action", "meta", "links", "GET", "POST", "PUT",
  "DELETE", "PATCH", "getServerSideProps", "getStaticProps", "generateMetadata", "App", "Page", "Layout",
]);

const isTestFile = (rel: string) => /(\.|\/)(test|spec)\.|(^|\/)(__tests__|tests?|spec|e2e)\//i.test(rel);
const isIgnoredFile = (rel: string) => /\.d\.ts$|\.min\.|\.config\.|(^|\/)(migrations?|database\/seeders?)\//i.test(rel);

// ─── Comment stripping (so commented-out calls don't count as usage) ───────────

function stripComments(text: string, ext: string): string {
  if (ext === ".py") return text.replace(/^\s*#.*$/gm, "").replace(/(\s)#[^\n"']*$/gm, "$1");
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");
}

// ─── Declaration finders ───────────────────────────────────────────────────────

interface Decl { name: string; kind: Kind; line: number; exported: boolean; isPrivate: boolean }

function findDecls(f: SourceFile): Decl[] {
  const decls: Decl[] = [];
  const lines = f.text.split("\n");
  const push = (name: string, kind: Kind, i: number, exported: boolean, isPrivate = false) => {
    if (!name || ENTRY_NAMES.has(name) || name.startsWith("__")) return;
    decls.push({ name, kind, line: i + 1, exported, isPrivate });
  };

  lines.forEach((line, i) => {
    if (JS_EXTS.has(f.ext)) {
      let m = line.match(/^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/);
      if (m) return push(m[2], "function", i, !!m[1]);
      m = line.match(/^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/);
      if (m) return push(m[2], "function", i, !!m[1]);
      m = line.match(/^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
      if (m) return push(m[2], "class", i, !!m[1]);
    } else if (f.ext === ".py") {
      if (/^\S/.test(line)) {
        const m = line.match(/^(?:async\s+)?(def|class)\s+(\w+)/);
        if (m && !m[2].startsWith("test")) {
          const prev = lines.slice(0, i).reverse().find((l) => l.trim());
          if (!prev || !prev.trim().startsWith("@")) push(m[2], m[1] === "def" ? "function" : "class", i, !m[2].startsWith("_"));
        }
      }
    } else if (f.ext === ".php") {
      const fn = line.match(/^\s*(?:(public|protected|private)\s+)?(?:static\s+)?function\s+(\w+)\s*\(/);
      if (fn) {
        const name = fn[2];
        if (/^(get|set).+Attribute$/.test(name) || /^scope[A-Z]/.test(name) || /^(test|it)[A-Z_]/.test(name)) return;
        const isMethod = /^\s+/.test(line);
        push(name, isMethod ? "method" : "function", i, fn[1] !== "private", fn[1] === "private");
      }
    }
  });
  // CommonJS / named export lists mark things as exported
  if (JS_EXTS.has(f.ext)) {
    const exportedNames = new Set<string>();
    for (const m of f.text.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(",").forEach((s) => exportedNames.add(s.trim().split(/\s+as\s+/)[0]));
    for (const m of f.text.matchAll(/(?:module\.)?exports\.(\w+)\s*=/g)) exportedNames.add(m[1]);
    const me = f.text.match(/module\.exports\s*=\s*\{([^}]*)\}/);
    if (me) me[1].split(",").forEach((s) => exportedNames.add(s.trim().split(":")[0].trim()));
    decls.forEach((d) => { if (exportedNames.has(d.name)) d.exported = true; });
  }
  return decls;
}

// ─── Import graph for orphan files (JS/TS) ─────────────────────────────────────

function findOrphans(files: SourceFile[], pkgJson?: string): DeadItem[] {
  const jsFiles = files.filter((f) => JS_EXTS.has(f.ext) && !isTestFile(f.rel) && !isIgnoredFile(f.rel));
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const imported = new Set<string>();
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".vue"];

  const resolve = (fromRel: string, spec: string): string | null => {
    const base = posix.normalize(posix.join(posix.dirname(fromRel), spec));
    const stem = base.replace(/\.(m|c)?js$/, "");
    const tries = [base, stem, ...exts.map((e) => base + e), ...exts.map((e) => stem + e), ...exts.map((e) => `${base}/index${e}`)];
    return tries.find((t) => byRel.has(t)) ?? null;
  };

  for (const f of files.filter((x) => JS_EXTS.has(x.ext) || x.ext === ".vue" || x.ext === ".svelte")) {
    const re = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]*|\.{1,2})['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.text))) {
      const r = resolve(f.rel, m[1]);
      if (r) imported.add(r);
    }
  }

  // entry points from package.json (best effort)
  const entries = new Set<string>();
  try {
    const pkg = JSON.parse(pkgJson ?? "{}") as Record<string, unknown>;
    const add = (v: unknown) => { if (typeof v === "string") entries.add(posix.normalize(v.replace(/^\.\//, "")).replace(/^dist\//, "src/").replace(/\.js$/, "")); else if (v && typeof v === "object") Object.values(v).forEach(add); };
    add(pkg.main); add(pkg.module); add(pkg.bin); add(pkg.exports);
  } catch { /* none */ }

  const entryLike = /(^|\/)(index|main|app|server|cli|worker|entry|bootstrap)\.[cm]?[jt]sx?$|(^|\/)(pages|app|routes|bin|scripts|public|stories)\//i;
  const allText = files.map((f) => f.text).join("\n");

  return jsFiles
    .filter((f) => !imported.has(f.rel) && !entryLike.test(f.rel))
    .filter((f) => ![...entries].some((e) => f.rel.replace(/\.[cm]?[jt]sx?$/, "") === e.replace(/\.[cm]?[jt]sx?$/, "")))
    .filter((f) => {
      // referenced by name from html/json/scripts? then it's alive
      const base = posix.basename(f.rel);
      const hits = allText.split(base).length - 1;
      return hits === 0;
    })
    .map((f) => ({ name: f.rel, kind: "file" as Kind, file: f.rel, line: 1, confidence: "medium" as Confidence, why: "never imported by any file" }));
}

// ─── Core analysis ─────────────────────────────────────────────────────────────

export function analyzeFiles(allFiles: SourceFile[], scopeRel: string | null, opts: { pkgJson?: string; orphans?: boolean } = {}): { items: DeadItem[]; scanned: number } {
  const files = allFiles.filter((f) => !/package-lock\.json$|\.lock$/.test(f.rel));
  const inScope = (rel: string) => !scopeRel || rel === scopeRel || rel.startsWith(scopeRel.replace(/\/$/, "") + "/");

  // Token index: identifier → total occurrences across the project (comments removed)
  const counts = new Map<string, number>();
  for (const f of files) {
    const clean = stripComments(f.text, f.ext);
    for (const m of clean.matchAll(/[A-Za-z_$][\w$]*/g)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  }

  const declFiles = files.filter((f) => DECL_EXTS.has(f.ext) && !isTestFile(f.rel) && !isIgnoredFile(f.rel));
  const allDecls = declFiles.map((f) => ({ f, decls: findDecls(f) }));
  const declCount = new Map<string, number>();
  allDecls.forEach(({ decls }) => decls.forEach((d) => declCount.set(d.name, (declCount.get(d.name) ?? 0) + 1)));

  const items: DeadItem[] = [];
  for (const { f, decls } of allDecls) {
    if (!inScope(f.rel)) continue;
    for (const d of decls) {
      const refs = (counts.get(d.name) ?? 0) - (declCount.get(d.name) ?? 0);
      if (refs > 0) continue;
      const exportedNote = d.exported ? "exported but never imported/called" : "never called";
      items.push({
        name: d.name,
        kind: d.kind,
        file: f.rel,
        line: d.line,
        confidence: d.exported && d.kind !== "method" ? "medium" : d.exported ? "medium" : "high",
        why: `${exportedNote} — 0 references in ${files.length} scanned files`,
      });
    }
  }

  for (const f of files) {
    if (inScope(f.rel) && DECL_EXTS.has(f.ext) && f.text.trim().length === 0 && !/__init__\.py$/.test(f.rel)) {
      items.push({ name: f.rel, kind: "file", file: f.rel, line: 1, confidence: "high", why: "file is empty" });
    }
  }
  if (opts.orphans !== false) {
    findOrphans(files, opts.pkgJson).filter((o) => inScope(o.file)).forEach((o) => items.push(o));
  }

  items.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { items, scanned: files.length };
}

