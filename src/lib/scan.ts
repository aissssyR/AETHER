import * as fs from "fs";
import * as path from "path";

export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".cache",
  "coverage", "vendor", "__pycache__", ".venv", "venv", ".aether", ".kiro", "target", ".turbo",
]);

import type { SourceFile } from "../core/types";
export type { SourceFile };

/** Recursively reads text files whose extension is in `exts`. */
export function collect(
  root: string,
  exts: Set<string>,
  opts: { maxFiles?: number; maxBytes?: number } = {}
): SourceFile[] {
  const maxFiles = opts.maxFiles ?? 4000;
  const maxBytes = opts.maxBytes ?? 1_000_000;
  const out: SourceFile[] = [];

  const walk = (dir: string): void => {
    if (out.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs);
      } else if (e.isFile()) {
        const ext = extOf(e.name);
        if (!exts.has(ext)) continue;
        try {
          if (fs.statSync(abs).size > maxBytes) continue;
          out.push({
            abs,
            rel: path.relative(root, abs).replace(/\\/g, "/"),
            ext,
            text: fs.readFileSync(abs, "utf-8"),
          });
        } catch {
          /* unreadable — skip */
        }
      }
    }
  };
  walk(root);
  return out;
}

/** `.blade.php` is treated as its own extension so templates are scanned for usages. */
export function extOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".blade.php")) return ".blade.php";
  return path.extname(lower);
}

export { lineOf, escapeRegExp } from "../core/util";
