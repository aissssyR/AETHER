import chalk from "chalk";

/** Single source of truth for AETHER's look & feel in the terminal. */
export const theme = {
  brand: chalk.hex("#a78bfa"),
  accent: chalk.hex("#fb923c"),
  ok: chalk.hex("#4ade80"),
  warn: chalk.hex("#facc15"),
  bad: chalk.hex("#f87171"),
  info: chalk.hex("#22d3ee"),
  dim: chalk.gray,
  text: chalk.white,
};

const WIDTH = 60;

export function rule(color: (s: string) => string = theme.dim): void {
  console.log(color("─".repeat(WIDTH)));
}

/** Prints a compact, consistent header for every ritual. */
export function header(icon: string, title: string, subtitle: string, color = theme.brand): void {
  console.log();
  console.log(color.bold(`  ${icon}  ${title}`));
  console.log(theme.dim(`     ${subtitle}`));
  console.log();
}

export const ok = (msg: string) => console.log(`  ${theme.ok("✔")} ${msg}`);
export const warn = (msg: string) => console.log(`  ${theme.warn("▲")} ${msg}`);
export const fail = (msg: string) => console.log(`  ${theme.bad("✖")} ${msg}`);
export const note = (msg: string) => console.log(theme.dim(`  ${msg}`));
export const step = (msg: string) => console.log(`  ${theme.brand("›")} ${msg}`);

/** True when a real AI key is configured. */
export function hasAI(): boolean {
  const key = process.env.NEBIUS_API_KEY;
  return !!key && key !== "your_nebius_api_key_here";
}

export function noAIHint(what: string): void {
  note(`No NEBIUS_API_KEY — ${what}. Add a key to .env to enable the AI layer.`);
}

/** Human readable "x ago". */
export function timeAgo(date: Date): string {
  const s = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Every command returns an exit code instead of calling process.exit(). */
export type ExitCode = 0 | 1 | 2;
