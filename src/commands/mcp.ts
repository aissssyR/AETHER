import { Command } from "commander";
import * as fs from "fs";
import * as readline from "readline";
import { spawnSync } from "child_process";

/**
 * AETHER as a Model Context Protocol server (stdio, newline-delimited JSON-RPC 2.0).
 * Lets Kiro (IDE or CLI) call the rituals as tools: freeze the session, hunt dead code,
 * check config drift, translate an error — without the developer leaving the chat.
 *
 * Every tool shells out to this same CLI with an argv array (never a shell string).
 */

const VERSION = "3.0.0";
const CLI = fs.realpathSync(process.argv[1]);

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  args: (a: Record<string, unknown>) => string[];
}

const cwdProp = { type: "string", description: "Project directory (defaults to the server's working directory)" };
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const TOOLS: Tool[] = [
  {
    name: "aether_coffin",
    description: "Freeze the developer's working context (branch, files, last-edited lines, git stash snapshot, summary) into COFFIN.md. Call this when the user is stopping work.",
    inputSchema: { type: "object", properties: { note: { type: "string", description: "What the user was working on" }, cwd: cwdProp }, required: ["note"] },
    args: (a) => ["coffin", str(a.note) || "unspecified work"],
  },
  {
    name: "aether_resurrect",
    description: "Read the saved coffin: where the user stopped, what to do next, files in flight. Call this at the start of a session.",
    inputSchema: { type: "object", properties: { cwd: cwdProp } },
    args: () => ["resurrect"],
  },
  {
    name: "aether_sweep",
    description: "Find dead code: functions/classes with zero references and orphan files, with file:line and confidence.",
    inputSchema: { type: "object", properties: { path: { type: "string", description: "Optional file or directory to report on" }, cwd: cwdProp } },
    args: (a) => (str(a.path) && !str(a.path).startsWith("-") ? ["sweep", str(a.path)] : ["sweep"]),
  },
  {
    name: "aether_drift",
    description: "Compare all .env files and the variables read in code; report variables missing from .env.example.",
    inputSchema: { type: "object", properties: { fix: { type: "boolean", description: "Also write a safe .env.example (secret values blanked)" }, cwd: cwdProp } },
    args: (a) => (a.fix === true ? ["drift", "--fix"] : ["drift"]),
  },
  {
    name: "aether_exorcise",
    description: "Find zombie (deprecated/abandoned) dependencies in package.json / requirements.txt and every place they are imported.",
    inputSchema: { type: "object", properties: { online: { type: "boolean", description: "Also query the npm registry" }, cwd: cwdProp } },
    args: (a) => (a.online === true ? ["exorcise", "--online"] : ["exorcise"]),
  },
  {
    name: "aether_whisper",
    description: "Translate a cryptic error message into a plain-language cause and fix.",
    inputSchema: { type: "object", properties: { error: { type: "string", description: "The exact error text" } }, required: ["error"] },
    args: (a) => ["whisper", str(a.error)],
  },
  {
    name: "aether_oath",
    description: "Judge a commit message (validate only, never commits). Returns whether it is acceptable and three better alternatives if not.",
    inputSchema: { type: "object", properties: { message: { type: "string" }, cwd: cwdProp }, required: ["message"] },
    args: (a) => ["oath", "--no-commit", str(a.message)],
  },
];

function runTool(tool: Tool, a: Record<string, unknown>): { text: string; isError: boolean } {
  const cwd = str(a.cwd) || process.cwd();
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return { text: `Directory not found: ${cwd}`, isError: true };
  const r = spawnSync(process.execPath, [CLI, ...tool.args(a)], {
    cwd,
    encoding: "utf-8",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    input: "",
  });
  if (r.error) return { text: `Failed to run AETHER: ${r.error.message}`, isError: true };
  const text = `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "").trim();
  return { text: text || "(no output)", isError: false };
}

type Req = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

function handle(req: Req): unknown | undefined {
  const { id, method, params = {} } = req;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  const isNotification = id === undefined;

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "aether", version: VERSION },
        instructions: "AETHER rituals for developers. Use aether_resurrect at the start of a session and aether_coffin when the user stops.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return err(-32602, `Unknown tool: ${String(params.name)}`);
      const out = runTool(tool, (params.arguments ?? {}) as Record<string, unknown>);
      return ok({ content: [{ type: "text", text: out.text }], isError: out.isError });
    }
    default:
      if (isNotification || (method ?? "").startsWith("notifications/")) return undefined;
      return err(-32601, `Method not found: ${method}`);
  }
}

export function runMcp(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req: Req;
    try { req = JSON.parse(line) as Req; }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"); return; }
    try {
      const res = handle(req);
      if (res !== undefined) process.stdout.write(JSON.stringify(res) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id ?? null, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }) + "\n");
    }
  });
  return new Promise((resolve) => rl.on("close", () => resolve()));
}

export const mcpCommand = new Command("mcp")
  .description("🔌 Run AETHER as an MCP server (stdio) so Kiro can call the rituals as tools")
  .action(async () => {
    await runMcp();
  });
