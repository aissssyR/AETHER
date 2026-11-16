import OpenAI from "openai";
import * as dotenv from "dotenv";
import nodeFetch from "node-fetch";

// Load .env from the directory where the CLI is invoked
dotenv.config();

// ─── Config ────────────────────────────────────────────────────────────────────

const NEBIUS_BASE_URL = "https://api.studio.nebius.com/v1/";
const NEBIUS_MODEL =
  process.env.NEBIUS_MODEL ?? "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";

// Max diff characters we send to the API — avoids burning tokens on massive diffs
const MAX_DIFF_CHARS = 8000;

/**
 * Creates an OpenAI client using node-fetch v2 as the HTTP transport.
 *
 * The OpenAI SDK v4+ defaults to Node's built-in fetch (undici), which
 * registers internal timers that hold libuv handles open past process exit.
 * On Windows this triggers the "async.c assertion" error in short-lived CLIs.
 *
 * node-fetch v2 is built on http.request, has no internal timers, and lets
 * the process exit cleanly the moment all JS work is done.
 */
function makeClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: NEBIUS_BASE_URL,
    apiKey,
    // Cast required: the SDK types expect the global fetch signature, but
    // node-fetch v2 is functionally compatible for our use case.
    fetch: nodeFetch as unknown as typeof fetch,
  });
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AIAnalysisResult {
  context_summary: string;
  next_steps: string[];
  source: "ai" | "fallback"; // lets coffin.ts know which path was taken
}

// ─── Main exported function ────────────────────────────────────────────────────

/**
 * Sends the git diff to the Nebius AI API (OpenAI-compatible) and returns a
 * structured analysis: a one-sentence spooky summary + 3 actionable next steps.
 *
 * Returns `null` if the API key is missing, so the caller can fall back gracefully.
 * Throws on unexpected errors so the caller can catch and fall back as well.
 */
export async function analyzeCodeWithAI(
  gitDiff: string,
  developerMessage: string
): Promise<AIAnalysisResult | null> {
  const apiKey = process.env.NEBIUS_API_KEY;

  // ── Guard: no key configured ─────────────────────────────────────────────────
  if (!apiKey || apiKey === "your_nebius_api_key_here") {
    return null;
  }

  // ── Truncate diff if it's enormous ───────────────────────────────────────────
  const truncatedDiff =
    gitDiff.length > MAX_DIFF_CHARS
      ? gitDiff.slice(0, MAX_DIFF_CHARS) + "\n\n... [diff truncated for brevity]"
      : gitDiff;

  const client = makeClient(apiKey);

  const systemPrompt = `You are a spooky but helpful senior developer ghost. Analyze this git diff. \
Return a JSON object with two keys: \
"context_summary" (a 1-sentence spooky summary of what the dev was doing) and \
"next_steps" (an array of 3 actionable, technical next steps). \
Respond with raw JSON only — no markdown fences, no extra text.`;

  const userPrompt = `Developer's note: "${developerMessage}"

Git diff:
${truncatedDiff || "(no diff — working tree is clean or not a git repo)"}`;

  const response = await client.chat.completions.create({
    model: NEBIUS_MODEL,
    temperature: 0.6,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const rawContent = response.choices[0]?.message?.content?.trim() ?? "";

  // ── Parse and validate the JSON response ─────────────────────────────────────
  const parsed = parseAIResponse(rawContent);
  return { ...parsed, source: "ai" };
}

// ─── Generic single-turn AI call (used by whisper & oath) ─────────────────────

/**
 * Sends a single prompt to the Nebius API with a custom system prompt and
 * returns the raw string response. Callers are responsible for parsing.
 *
 * Returns `null` when no API key is configured.
 */
export async function callAI(
  systemPrompt: string,
  userMessage: string,
  temperature = 0.7
): Promise<string | null> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey || apiKey === "your_nebius_api_key_here") return null;

  const client = makeClient(apiKey);

  const response = await client.chat.completions.create({
    model: NEBIUS_MODEL,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices[0]?.message?.content?.trim() ?? null;
}

// ─── Commit message suggestions (used by oath) ─────────────────────────────────

export interface CommitSuggestion {
  messages: string[]; // array of 3 conventional-commit style messages
}

/**
 * Given a short description of what the developer did, asks the AI to generate
 * three technical, conventional-commit style commit messages.
 *
 * Returns `null` when no API key is configured.
 * Returns a fallback suggestion list on parse failure.
 */
export async function suggestCommitMessages(
  weakMessage: string,
  gitDiff: string
): Promise<CommitSuggestion | null> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey || apiKey === "your_nebius_api_key_here") return null;

  const client = makeClient(apiKey);

  const truncatedDiff =
    gitDiff.length > MAX_DIFF_CHARS
      ? gitDiff.slice(0, MAX_DIFF_CHARS) + "\n... [truncated]"
      : gitDiff;

  const systemPrompt = `You are a strict but spooky senior developer ghost who enforces \
conventional commits. The developer gave a lazy commit message. \
Generate exactly 3 better, technical, conventional-commit style messages \
(e.g. "feat:", "fix:", "refactor:", "chore:"). \
Return raw JSON only: {"messages": ["...", "...", "..."]}. No markdown fences.`;

  const userPrompt = `Lazy message: "${weakMessage}"

Git diff context:
${truncatedDiff || "(no diff available)"}`;

  try {
    const response = await client.chat.completions.create({
      model: NEBIUS_MODEL,
      temperature: 0.8,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(cleaned) as { messages?: unknown };
    const messages = Array.isArray(parsed.messages)
      ? (parsed.messages as unknown[])
          .filter((m): m is string => typeof m === "string")
          .slice(0, 3)
      : [];

    while (messages.length < 3) {
      messages.push(`refactor: improve ${weakMessage.slice(0, 40)}`);
    }

    return { messages };
  } catch {
    return {
      messages: [
        `fix: resolve issue described as "${weakMessage.slice(0, 40)}"`,
        `refactor: clean up logic related to "${weakMessage.slice(0, 40)}"`,
        `chore: address "${weakMessage.slice(0, 40)}" properly`,
      ],
    };
  }
}

// ─── AETHER Natural Language Orchestrator ─────────────────────────────────────

export type AetherCommand = "coffin" | "resurrect" | "whisper" | "oath" | "sweep" | "exorcise";

export interface OrchestratorResult {
  command: AetherCommand;
  params: string | null;
  explanation: string;
}

const AETHER_SYSTEM_PROMPT =
  "You are AETHER, an intelligent CLI orchestrator. The user will give you a natural language request. " +
  "You must map this request to ONE of the following available tools: [coffin, resurrect, whisper, oath, sweep, exorcise]. " +
  "Tool parameter rules: " +
  "- coffin: params = the developer's context message (what they were working on). Required. " +
  "- resurrect: params = null always. " +
  "- whisper: params = the exact error message or text to explain. Required. " +
  "- oath: params = the commit message string to validate. Required. " +
  "- sweep: params = null always (scans current directory). " +
  "- exorcise: params = null always (reads package.json in current directory). " +
  "Return a STRICT JSON object: " +
  '{ "command": "name_of_command", "params": "extracted_params_or_null", "explanation": "1 sentence explaining what you will do" }';

/**
 * Sends a natural language request to the AI and returns a structured
 * { command, params, explanation } object for the AETHER orchestrator.
 *
 * Returns `null` when no API key is configured.
 */
export async function orchestrateWithAI(
  naturalLanguageInput: string
): Promise<OrchestratorResult | null> {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey || apiKey === "your_nebius_api_key_here") return null;

  const client = makeClient(apiKey);

  const response = await client.chat.completions.create({
    model: NEBIUS_MODEL,
    temperature: 0.2, // low temp for deterministic command routing
    messages: [
      { role: "system", content: AETHER_SYSTEM_PROMPT },
      { role: "user", content: naturalLanguageInput },
    ],
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? "";

  // Strip optional markdown fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AETHER returned unparseable JSON: ${raw.slice(0, 120)}`);
  }

  const obj = parsed as Record<string, unknown>;

  const command = typeof obj.command === "string" ? obj.command.trim().toLowerCase() : "";
  const validCommands: AetherCommand[] = ["coffin", "resurrect", "whisper", "oath", "sweep", "exorcise"];
  if (!validCommands.includes(command as AetherCommand)) {
    throw new Error(`AETHER returned an unknown command: "${command}"`);
  }

  const params =
    typeof obj.params === "string" && obj.params.trim() && obj.params.trim().toLowerCase() !== "null"
      ? obj.params.trim()
      : null;

  // These commands never take a string argument — enforce null regardless of model output
  const noParamCommands: AetherCommand[] = ["resurrect", "sweep", "exorcise"];
  const resolvedParams = noParamCommands.includes(command as AetherCommand) ? null : params;

  const explanation =
    typeof obj.explanation === "string" && obj.explanation.trim()
      ? obj.explanation.trim()
      : "Executing your request.";

  return { command: command as AetherCommand, params: resolvedParams, explanation };
}

// ─── Response parser ───────────────────────────────────────────────────────────

/**
 * Parses the LLM's JSON response. If the model wraps it in markdown fences or
 * returns malformed JSON, we try to extract whatever we can rather than hard-crash.
 */
function parseAIResponse(raw: string): Omit<AIAnalysisResult, "source"> {
  // Strip optional ```json ... ``` fences some models add despite instructions
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Model returned something unparseable — wrap it as a fallback summary
    return {
      context_summary:
        "👻 The ghost tried to speak but the message was garbled. Check your diff manually.",
      next_steps: [
        "Review the git diff output directly.",
        "Commit your changes with a clear message.",
        "Re-run `luvsean coffin` after ensuring your API key is valid.",
      ],
    };
  }

  // Runtime type validation — be defensive about what the LLM sends back
  const obj = parsed as Record<string, unknown>;

  const context_summary =
    typeof obj.context_summary === "string" && obj.context_summary.trim()
      ? obj.context_summary.trim()
      : "👻 The spirit analyzed your code but couldn't put it into words.";

  const next_steps: string[] = Array.isArray(obj.next_steps)
    ? (obj.next_steps as unknown[])
        .filter((s): s is string => typeof s === "string")
        .slice(0, 5) // cap at 5 even if the model returns more
    : [
        "Review your changes carefully.",
        "Run your tests.",
        "Commit when ready.",
      ];

  return { context_summary, next_steps };
}
