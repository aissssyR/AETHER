import type { SourceFile } from "./types";
import { lineOf, escapeRegExp } from "./util";

// Pure zombie database + usage finder + manifest parser: runs in Node and in the browser.

// ─── Zombie database ───────────────────────────────────────────────────────────

export type Severity = "deprecated" | "legacy" | "security";
export interface Zombie { severity: Severity; reason: string; alt: string; tip: string }

export const NPM: Record<string, Zombie> = {
  moment: { severity: "legacy", reason: "Maintenance-only, mutable API, ~300 KB bundle.", alt: "date-fns, dayjs or native Intl/Temporal", tip: "moment(d).format('YYYY-MM-DD') → format(new Date(d), 'yyyy-MM-dd') (date-fns)." },
  "moment-timezone": { severity: "legacy", reason: "Rides on moment's maintenance mode.", alt: "date-fns-tz or Intl.DateTimeFormat", tip: "Use formatInTimeZone(date, tz, fmt)." },
  request: { severity: "deprecated", reason: "Officially deprecated since 2020 — no security patches.", alt: "native fetch or axios", tip: "request.get(url, cb) → await fetch(url)." },
  "request-promise": { severity: "deprecated", reason: "Built on the deprecated `request`.", alt: "native fetch or axios", tip: "await axios.get(url) mirrors the promise API." },
  "request-promise-native": { severity: "deprecated", reason: "Built on the deprecated `request`.", alt: "native fetch or axios", tip: "await fetch(url)." },
  "node-uuid": { severity: "deprecated", reason: "Renamed to `uuid`.", alt: "uuid or crypto.randomUUID()", tip: "crypto.randomUUID() is native in Node ≥ 14.17." },
  "node-sass": { severity: "deprecated", reason: "Deprecated in favour of Dart Sass.", alt: "sass", tip: "npm rm node-sass && npm i -D sass — API is compatible." },
  tslint: { severity: "deprecated", reason: "Deprecated in 2019 in favour of ESLint.", alt: "eslint + typescript-eslint", tip: "Run `npx tslint-to-eslint-config`." },
  "babel-eslint": { severity: "deprecated", reason: "Renamed to @babel/eslint-parser.", alt: "@babel/eslint-parser", tip: "Swap the parser name in .eslintrc." },
  bower: { severity: "deprecated", reason: "Retired package manager.", alt: "npm / pnpm / yarn", tip: "Move every dependency into package.json." },
  colors: { severity: "security", reason: "Maintainer sabotaged v1.4.1+ in Jan 2022 (supply-chain incident).", alt: "chalk or picocolors", tip: "import chalk from 'chalk' — same chaining API." },
  "faker": { severity: "security", reason: "Maintainer sabotaged the package in Jan 2022.", alt: "@faker-js/faker", tip: "Change the import to @faker-js/faker." },
  querystring: { severity: "deprecated", reason: "Legacy Node API, replaced by URLSearchParams.", alt: "URLSearchParams", tip: "new URLSearchParams(str).get('k')." },
  "left-pad": { severity: "deprecated", reason: "Native String.prototype.padStart exists.", alt: "String.prototype.padStart", tip: "str.padStart(len, ch)." },
  underscore: { severity: "legacy", reason: "Superseded by native ES6+ methods.", alt: "native JS", tip: "Replace helpers one by one with Array/Object built-ins." },
  jquery: { severity: "legacy", reason: "Native DOM APIs cover most use cases.", alt: "native DOM / your framework", tip: "$('.x').on('click', f) → document.querySelector('.x').addEventListener('click', f)." },
  lodash: { severity: "legacy", reason: "Most helpers have native ES2020 equivalents (~70 KB).", alt: "native JS or lodash-es per-method imports", tip: "Audit which helpers you use: flat(), Object.entries(), ?. and ?? replace most." },
  gulp: { severity: "legacy", reason: "Largely replaced by npm scripts + modern bundlers.", alt: "npm scripts + Vite/esbuild", tip: "Move tasks into package.json scripts." },
  grunt: { severity: "legacy", reason: "Superseded by npm scripts + bundlers.", alt: "npm scripts + Vite/esbuild", tip: "Migrate Gruntfile tasks one by one." },
};

export const PYPI: Record<string, Zombie & { module?: string }> = {
  pycrypto: { severity: "security", reason: "Unmaintained since 2013, known CVEs.", alt: "pycryptodome", tip: "pip install pycryptodome — same `Crypto` import path.", module: "Crypto" },
  nose: { severity: "deprecated", reason: "Unmaintained; breaks on Python ≥ 3.10.", alt: "pytest", tip: "pytest runs most nose tests unchanged." },
  mock: { severity: "legacy", reason: "Part of the stdlib since Python 3.3.", alt: "unittest.mock", tip: "from unittest import mock" },
  six: { severity: "legacy", reason: "Python 2 compatibility shim.", alt: "plain Python 3", tip: "Drop six.* wrappers; use native str/dict methods." },
  pytz: { severity: "legacy", reason: "zoneinfo is in the stdlib since 3.9.", alt: "zoneinfo", tip: "ZoneInfo('Europe/Paris') replaces pytz.timezone(...)." },
  simplejson: { severity: "legacy", reason: "stdlib json is fast and equivalent for most uses.", alt: "json", tip: "import json" },
  "python-jose": { severity: "security", reason: "Slow maintenance with several CVEs.", alt: "PyJWT or joserfc", tip: "jwt.decode(token, key, algorithms=['HS256'])", module: "jose" },
};

export interface Dep { name: string; version: string; eco: "npm" | "pypi" }

/** Parses package.json and requirements.txt text into a flat dependency list. */
export function parseManifests(pkgJson?: string, requirements?: string): { deps: Dep[]; files: string[]; errors: string[] } {
  const deps: Dep[] = []; const files: string[] = []; const errors: string[] = [];
  if (pkgJson !== undefined) {
    try {
      const pkg = JSON.parse(pkgJson) as Record<string, Record<string, string> | undefined>;
      for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])
        for (const [name, version] of Object.entries(pkg[k] ?? {})) deps.push({ name, version, eco: "npm" });
      files.push("package.json");
    } catch { errors.push("package.json is not valid JSON"); }
  }
  if (requirements !== undefined) {
    files.push("requirements.txt");
    for (const raw of requirements.split("\n")) {
      const line = raw.split("#")[0].trim();
      const m = line.match(/^([A-Za-z0-9_.\-]+)\s*(?:[<>=!~]=?\s*([^\s;,]+))?/);
      if (m && !line.startsWith("-")) deps.push({ name: m[1].toLowerCase(), version: m[2] ?? "*", eco: "pypi" });
    }
  }
  return { deps, files, errors };
}

// ─── Usage finder ──────────────────────────────────────────────────────────────

export interface Usage { file: string; line: number; text: string }

export function findUsages(src: SourceFile[], dep: Dep): Usage[] {
  const out: Usage[] = [];
  const mod = (PYPI[dep.name] as { module?: string } | undefined)?.module ?? dep.name.replace(/-/g, "_");
  const re = dep.eco === "npm"
    ? new RegExp(`(?:from\\s*|require\\s*\\(\\s*|import\\s*\\(?\\s*)['"]${escapeRegExp(dep.name)}(?:/[^'"]*)?['"]`, "g")
    : new RegExp(`^\\s*(?:from\\s+${escapeRegExp(mod)}(?:\\.\\w+)*\\s+import|import\\s+${escapeRegExp(mod)}\\b)`, "gm");
  for (const f of src) {
    if (dep.eco === "npm" ? ![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue"].includes(f.ext) : f.ext !== ".py") continue;
    for (const m of f.text.matchAll(re)) {
      const line = lineOf(f.text, m.index ?? 0);
      out.push({ file: f.rel, line, text: f.text.split("\n")[line - 1].trim().slice(0, 90) });
    }
  }
  return out;
}

