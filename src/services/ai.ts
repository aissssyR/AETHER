import OpenAI from "openai";
import nodeFetch from "node-fetch";
import { hasAI } from "../lib/ui";

// ─── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = process.env.AETHER_BASE_URL ?? "https://api.studio.nebius.com/v1/";
export const MODEL = process.env.NEBIUS_MODEL ?? "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
const TIMEOUT_MS = Number(process.env.AETHER_TIMEOUT_MS ?? 25_000);
const MAX_DIFF_CHARS = 8000;

/**
 * node-fetch v2 is used as transport: it has no internal timers, so a short-lived
 * CLI exits cleanly (the undici-based global fetch keeps libuv handles open on Windows).
 * Timeouts + zero retries guarantee we fall back to the local engine quickly.
 */
function client(): OpenAI {
  return new OpenAI({
    baseURL: BASE_URL,
    apiKey: process.env.NEBIUS_API_KEY as string,
    fetch: nodeFetch as unknown as typeof fetch,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });
}

// ─── Core call ─────────────────────────────────────────────────────────────────

/** Removes reasoning blocks some models emit (<think>…</think>). */
function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/**
 * Single-turn chat call. Returns `null` when no API key is configured;
 * THROWS on network/API errors so each command can fall back on its own.
 */
export async function callAI(system: string, user: string, temperature = 0.5): Promise<string | null> {
  if (!hasAI()) return null;
  const res = await client().chat.completions.create({
    model: MODEL,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const text = res.choices[0]?.message?.content;
  return text ? stripThinking(text) : null;
}

/** Pulls the first JSON object out of a model reply (handles fences / chatter). */
export function extractJson<T = Record<string, unknown>>(raw: string): T | null {
  const cleaned = stripThinking(raw).replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** Returns the first fenced code block of a reply, or the full reply if none. */
export function extractCodeBlocks(raw: string): string[] {
  const blocks: string[] = [];
  const re = /```[a-zA-Z0-9]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  const text = stripThinking(raw);
  while ((m = re.exec(text))) blocks.push(m[1].replace(/\s+$/, "") + "\n");
  return blocks;
}

const trunc = (s: string, n = MAX_DIFF_CHARS) => (s.length > n ? s.slice(0, n) + "\n… [truncated]" : s);

// ─── Cryostasis: context summary ───────────────────────────────────────────────

export interface ContextAnalysis {
  context_summary: string;
  next_steps: string[];
}

export async function analyzeContext(
  diff: string,
  note: string,
  meta: { branch?: string; files?: string }
): Promise<ContextAnalysis | null> {
  const system =
    "You are a senior engineer helping a developer resume work after a break. " +
    "Read the git diff and the developer's note. Reply with RAW JSON only: " +
    '{"context_summary": "2-3 sentences, second person (\\"You were…\\"), mention the file and what you were trying to achieve and where you stopped", ' +
    '"next_steps": ["3 concrete, technical next steps, most important first"]}';
  const user =
    `Developer note: "${note}"\nBranch: ${meta.branch ?? "unknown"}\nChanged files: ${meta.files ?? "n/a"}\n\n` +
    `Diff:\n${trunc(diff) || "(no diff — working tree clean)"}`;
  const raw = await callAI(system, user, 0.4);
  if (!raw) return null;
  const obj = extractJson<{ context_summary?: unknown; next_steps?: unknown }>(raw);
  if (!obj || typeof obj.context_summary !== "string") return null;
  const steps = Array.isArray(obj.next_steps)
    ? obj.next_steps.filter((s): s is string => typeof s === "string").slice(0, 5)
    : [];
  return { context_summary: obj.context_summary.trim(), next_steps: steps };
}

// ─── Oath: commit suggestions ──────────────────────────────────────────────────

export async function suggestCommitMessages(weak: string, diff: string): Promise<string[] | null> {
  const system =
    "You enforce Conventional Commits. The developer wrote a lazy commit message. Using the diff, " +
    "write exactly 3 specific, technical alternatives (type(scope): description, imperative mood, max 72 chars). " +
    'Reply with RAW JSON only: {"messages": ["…","…","…"]}';
  const raw = await callAI(system, `Lazy message: "${weak}"\n\nDiff:\n${trunc(diff) || "(no diff available)"}`, 0.7);
  if (!raw) return null;
  const obj = extractJson<{ messages?: unknown }>(raw);
  const list = Array.isArray(obj?.messages)
    ? (obj!.messages as unknown[]).filter((m): m is string => typeof m === "string" && m.trim().length > 8)
    : [];
  return list.length ? list.slice(0, 3).map((m) => m.trim().replace(/^["']|["']$/g, "")) : null;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

import { ALL_COMMANDS, type AetherCommand } from "../core/router";
export { ALL_COMMANDS };
export type { AetherCommand };

export interface OrchestratorResult {
  command: AetherCommand;
  params: string | null;
  explanation: string;
}

const NO_PARAM: AetherCommand[] = ["resurrect", "sweep", "exorcise", "drift"];

const ORCH_SYSTEM =
  "You are AETHER, a CLI orchestrator. Map the user's request to exactly ONE tool of: " +
  "coffin (save/pause my work context; params = what I was working on), " +
  "resurrect (restore/resume my saved context; params = null), " +
  "whisper (explain an error message; params = the exact error text), " +
  "oath (validate/commit with a commit message; params = the message), " +
  "sweep (find dead/unused code; params = null), " +
  "exorcise (find deprecated/zombie dependencies; params = null), " +
  "drift (compare .env files / config drift; params = null). " +
  'Reply with RAW JSON only: {"command":"…","params":"…or null","explanation":"one short sentence"}';

export async function orchestrate(input: string): Promise<OrchestratorResult | null> {
  const raw = await callAI(ORCH_SYSTEM, input, 0.1);
  if (!raw) return null;
  const obj = extractJson<Record<string, unknown>>(raw);
  if (!obj) throw new Error("model returned unparseable JSON");
  const command = String(obj.command ?? "").trim().toLowerCase() as AetherCommand;
  if (!ALL_COMMANDS.includes(command)) throw new Error(`model chose unknown tool "${command}"`);
  const p = typeof obj.params === "string" ? obj.params.trim() : "";
  const params = !p || p.toLowerCase() === "null" || NO_PARAM.includes(command) ? null : p;
  const explanation = typeof obj.explanation === "string" && obj.explanation.trim() ? obj.explanation.trim() : "Executing your request.";
  return { command, params, explanation };
}
