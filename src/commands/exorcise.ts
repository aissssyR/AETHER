import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { callAI } from "../services/ai";

// ─── Spooky ASCII banner ───────────────────────────────────────────────────────
const EXORCISE_BANNER = chalk.red(`
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  ░  🧿  ZOMBIE DEPENDENCY EXORCIST  🧿  ░
  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
`);

// ─── System prompt ─────────────────────────────────────────────────────────────
const EXORCISE_SYSTEM_PROMPT =
  "You are a Zombie Exorcist. Look at these npm dependencies. " +
  "Identify any known \"zombie\" or deprecated libraries (like moment.js, lodash, request, etc.). " +
  "For each zombie, suggest a modern, lightweight alternative (like date-fns, native JS, axios) " +
  "and give a 1-sentence migration tip. " +
  "Format as plain text. Use '🧟 ZOMBIE:' to prefix each zombie library " +
  "and '✨ REPLACE WITH:' to prefix each modern alternative and migration tip. " +
  "If no zombies are found, say so clearly.";

// ─── Known zombies (local fallback) ────────────────────────────────────────────

interface ZombieEntry {
  reason: string;
  alternative: string;
  tip: string;
}

const KNOWN_ZOMBIES: Record<string, ZombieEntry> = {
  moment: {
    reason: "Huge bundle size (~300 KB), mutable API, officially in maintenance-only mode.",
    alternative: "date-fns or Temporal API (native)",
    tip: "Replace `moment(date).format('YYYY-MM-DD')` with `format(new Date(date), 'yyyy-MM-dd')` from date-fns.",
  },
  "moment-timezone": {
    reason: "Piggybacks on moment's bloat; also in maintenance mode.",
    alternative: "date-fns-tz or Intl.DateTimeFormat (native)",
    tip: "Use `formatInTimeZone(date, tz, fmt)` from date-fns-tz as a direct replacement.",
  },
  request: {
    reason: "Officially deprecated since 2020; no security patches.",
    alternative: "axios or native fetch",
    tip: "Replace `request.get(url, cb)` with `await fetch(url)` or `await axios.get(url)`.",
  },
  "request-promise": {
    reason: "Built on the deprecated `request` package.",
    alternative: "axios or native fetch",
    tip: "Drop-in swap: `await axios.get(url)` mirrors the promise-based API.",
  },
  lodash: {
    reason: "Largely superseded by native ES6+ array/object methods; adds ~70 KB.",
    alternative: "Native JS (Array.prototype, Object methods) or radash",
    tip: "Remove lodash and use native `Array.flat()`, `Object.entries()`, optional chaining, etc.",
  },
  "lodash-es": {
    reason: "Same rationale as lodash, even though it's tree-shakeable.",
    alternative: "Native JS or radash",
    tip: "Audit which lodash functions you actually use; most have native equivalents in ES2020+.",
  },
  underscore: {
    reason: "Predecessor to lodash — even more outdated; native JS covers all use cases.",
    alternative: "Native JS",
    tip: "Delete underscore and replace utilities one-by-one with native array/object methods.",
  },
  jquery: {
    reason: "DOM manipulation is now handled cleanly by native browser APIs and modern frameworks.",
    alternative: "Native DOM API or your existing framework (React, Vue, etc.)",
    tip: "Replace `$('.cls').on('click', fn)` with `document.querySelector('.cls').addEventListener('click', fn)`.",
  },
  "node-uuid": {
    reason: "Renamed and superseded by the `uuid` package.",
    alternative: "uuid or crypto.randomUUID() (native in Node 15+)",
    tip: "Replace `require('node-uuid')` with `import { v4 as uuidv4 } from 'uuid'` or `crypto.randomUUID()`.",
  },
  unirest: {
    reason: "Unmaintained HTTP client; last release was years ago.",
    alternative: "axios or native fetch",
    tip: "Port requests to `await axios({ method, url, data })` — the API maps cleanly.",
  },
  colors: {
    reason: "Maintainer intentionally broke it in Jan 2022; supply-chain incident.",
    alternative: "chalk or picocolors",
    tip: "Swap `require('colors')` for `import chalk from 'chalk'` — same string-coloring API.",
  },
  "node-sass": {
    reason: "Deprecated in favour of Dart Sass; no longer receives updates.",
    alternative: "sass (Dart Sass)",
    tip: "Run `npm uninstall node-sass && npm install --save-dev sass` — the API is identical.",
  },
  bower: {
    reason: "Retired package manager; npm/yarn/pnpm cover all use cases.",
    alternative: "npm, yarn, or pnpm",
    tip: "Delete bower.json and bower_components; install everything via npm instead.",
  },
  gulp: {
    reason: "Task runner largely replaced by npm scripts + modern bundlers.",
    alternative: "npm scripts + Vite, Webpack, or esbuild",
    tip: "Move build steps into package.json `scripts` and use a modern bundler for asset pipelines.",
  },
  grunt: {
    reason: "Predecessor to gulp — superseded by npm scripts and modern tooling.",
    alternative: "npm scripts + Vite or esbuild",
    tip: "Migrate Gruntfile tasks to package.json scripts one-by-one.",
  },
};

// ─── Package.json reader ────────────────────────────────────────────────────────

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readPackageJson(dir: string): { data: PackageJson; filePath: string } | null {
  const filePath = path.join(dir, "package.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as PackageJson;
    return { data, filePath };
  } catch {
    return null;
  }
}

function extractDeps(pkg: PackageJson): Record<string, string> {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
}

// ─── Local fallback scan ────────────────────────────────────────────────────────

function localExorcise(deps: Record<string, string>): void {
  const zombiesFound: string[] = [];

  for (const [name] of Object.entries(deps)) {
    const zombie = KNOWN_ZOMBIES[name.toLowerCase()];
    if (zombie) {
      zombiesFound.push(name);
      console.log(chalk.red(`\n   🧟 ZOMBIE: ${name}@${deps[name]}`));
      console.log(chalk.red.dim(`   Reason: ${zombie.reason}`));
      console.log(chalk.greenBright(`   ✨ REPLACE WITH: ${zombie.alternative}`));
      console.log(chalk.greenBright.dim(`   Migration tip: ${zombie.tip}`));
    }
  }

  if (zombiesFound.length === 0) {
    console.log(chalk.greenBright("   ✅ No known zombies detected in your dependencies!\n"));
    console.log(chalk.gray("   Add your NEBIUS_API_KEY to .env for a deeper AI-powered audit.\n"));
  } else {
    console.log(
      chalk.red(`\n\n   ☠️  ${zombiesFound.length} zombie(s) found. Exorcise them before they eat your bundle.\n`)
    );
  }
}

// ─── Report printer ─────────────────────────────────────────────────────────────

function printAIReport(report: string): void {
  const lines = report.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      console.log();
      continue;
    }
    if (trimmed.startsWith("🧟") || trimmed.toUpperCase().includes("ZOMBIE:")) {
      console.log(chalk.red(`   ${trimmed}`));
    } else if (trimmed.startsWith("✨") || trimmed.toUpperCase().includes("REPLACE WITH:")) {
      console.log(chalk.greenBright(`   ${trimmed}`));
    } else {
      console.log(chalk.gray.dim(`   ${trimmed}`));
    }
  }
}

// ─── Command definition ─────────────────────────────────────────────────────────

export const exorciseCommand = new Command("exorcise")
  .description("🧿 Exorcise zombie dependencies — find deprecated libs and their modern replacements")
  .argument("[dir]", "Directory containing package.json (defaults to current directory)")
  .action(async (dir: string | undefined) => {
    const cwd = process.cwd();
    const targetDir = dir ? path.resolve(cwd, dir) : cwd;

    console.log(EXORCISE_BANNER);

    // ── Read package.json ───────────────────────────────────────────────────────
    const result = readPackageJson(targetDir);
    if (!result) {
      console.log(chalk.red(`❌ No package.json found in: ${targetDir}\n`));
      console.log(chalk.gray("   Run this command from the root of a Node.js project.\n"));
      process.exit(1);
    }

    const { data: pkg, filePath } = result;
    const deps = extractDeps(pkg);
    const depCount = Object.keys(deps).length;

    console.log(chalk.gray(`📦 Found ${depCount} dependencies in: ${path.relative(cwd, filePath) || "package.json"}\n`));

    if (depCount === 0) {
      console.log(chalk.gray("   No dependencies found — nothing to exorcise.\n"));
      process.exit(0);
    }

    // ── Build context string for AI ─────────────────────────────────────────────
    const depList = Object.entries(deps)
      .map(([name, version]) => `  "${name}": "${version}"`)
      .join("\n");

    const context = `package.json dependencies:\n{\n${depList}\n}`;

    const hasApiKey =
      process.env.NEBIUS_API_KEY &&
      process.env.NEBIUS_API_KEY !== "your_nebius_api_key_here";

    console.log(chalk.red("─".repeat(52)));

    if (hasApiKey) {
      // ── AI path ───────────────────────────────────────────────────────────────
      console.log(chalk.red("\n👻 The Zombie Exorcist is scanning for the undead...\n"));
      try {
        const report = await callAI(EXORCISE_SYSTEM_PROMPT, context, 0.4);

        if (report) {
          console.log(chalk.red.bold("\n💀 EXORCISM REPORT:\n"));
          printAIReport(report);
        } else {
          console.log(chalk.yellow("⚠️  The exorcist found nothing to report. Running local scan.\n"));
          localExorcise(deps);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow(`⚠️  The exorcist went silent (${reason}). Running local scan.\n`));
        localExorcise(deps);
      }
    } else {
      // ── Local fallback path ────────────────────────────────────────────────────
      console.log(
        chalk.gray("💡 No NEBIUS_API_KEY — running local zombie database scan.\n") +
        chalk.gray("   Add your key to .env for a full AI-powered exorcism.\n")
      );
      localExorcise(deps);
    }

    console.log();
    console.log(chalk.red("─".repeat(52)));
    console.log(chalk.gray.dim("\n🕯️  The ritual is complete. May your dependencies rest in peace.\n"));

    process.exit(0);
  });
