// End-to-end tests: run the compiled CLI against throw-away git repos.
// No network and no API key needed — every ritual has an offline engine.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CLI = path.join(__dirname, "..", "dist", "index.js");
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

function repo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aether-"));
  const sh = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf-8" });
  sh("init", "-q"); sh("config", "user.email", "t@t.t"); sh("config", "user.name", "t");
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  }
  sh("add", "-A"); sh("commit", "-qm", "chore: initial commit for tests", "--allow-empty");
  return { dir, sh };
}
function aether(dir, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: "utf-8", env: { ...process.env, NEBIUS_API_KEY: "" }, input: "",
  });
  return { code: r.status, out: strip(r.stdout + r.stderr) };
}

test("whisper translates the PHP undefined-method error", () => {
  const r = aether(os.tmpdir(), "whisper", "Call to undefined method App\\Models\\User::getAttributes()");
  assert.equal(r.code, 0);
  assert.match(r.out, /getAttributes\(\) on User/);
});

test("oath accepts a real conventional commit and rejects lazy ones", () => {
  const { dir } = repo();
  assert.equal(aether(dir, "oath", "--no-commit", "fix: resolve null pointer in AuthController").code, 0);
  for (const bad of ["fix bug", "update", "wip", "changes", "fix login"]) assert.equal(aether(dir, "oath", "--no-commit", bad).code, 1, bad);
});

test("oath never executes shell syntax in a message", () => {
  const { dir } = repo();
  const marker = path.join(dir, "pwned");
  aether(dir, "oath", "--no-commit", `feat(auth): add $(touch ${marker}) support for login`);
  assert.equal(fs.existsSync(marker), false);
});

test("oath suggestions always pass its own validator", () => {
  const { dir } = repo({ "src/auth/login.ts": "export const a = 1;\n" });
  fs.appendFileSync(path.join(dir, "src/auth/login.ts"), "// change\n");
  const r = aether(dir, "oath", "--no-commit", "fix bug");
  const suggestions = [...r.out.matchAll(/\[\d\] (.+)/g)].map((m) => m[1]);
  assert.equal(suggestions.length, 3);
  for (const s of suggestions) assert.equal(aether(dir, "oath", "--no-commit", s).code, 0, s);
});

test("oath hook blocks weak commits and lets good ones through", () => {
  const { dir, sh } = repo({ "a.txt": "1\n" });
  assert.equal(aether(dir, "oath", "--install-hook").code, 0);
  fs.appendFileSync(path.join(dir, "a.txt"), "2\n"); sh("add", "-A");
  assert.notEqual(sh("commit", "-m", "wip").status, 0);
  assert.equal(sh("commit", "-m", "feat(a): append a second line to the fixture").status, 0);
});

test("coffin + resurrect round-trip, with the exact edited line", () => {
  const { dir, sh } = repo({ "src/app.ts": "a\nb\nc\nd\n" });
  fs.writeFileSync(path.join(dir, "src/app.ts"), "a\nb\nc\nEDIT\nd\n");
  const c = aether(dir, "coffin", "fixing the reset token");
  assert.equal(c.code, 0);
  assert.ok(fs.existsSync(path.join(dir, "COFFIN.md")));
  assert.match(sh("stash", "list").stdout, /aether-coffin/);
  assert.equal(sh("status", "--porcelain").stdout.includes("src/app.ts"), true, "working tree must be untouched");
  assert.equal(sh("status", "--porcelain").stdout.includes("COFFIN.md"), false, "artifacts must be git-excluded");
  const r = aether(dir, "resurrect");
  assert.equal(r.code, 0);
  assert.match(r.out, /src\/app\.ts:4/);
  assert.match(r.out, /fixing the reset token/);
});

test("resurrect with no coffin exits 1", () => {
  assert.equal(aether(repo().dir, "resurrect").code, 1);
});

test("sweep finds unreferenced functions and ignores used ones", () => {
  const { dir } = repo({
    "src/a.ts": "export function used() { return 1 }\nfunction deadOne() { return 2 }\n",
    "src/main.ts": "import { used } from './a';\nconsole.log(used());\n",
  });
  const r = aether(dir, "sweep");
  assert.match(r.out, /deadOne/);
  assert.doesNotMatch(r.out, /function used\(\)/);
});

test("sweep --fail-on-dead gives CI a non-zero exit", () => {
  const { dir } = repo({ "src/a.ts": "function nobodyCallsMe() {}\n" });
  assert.equal(aether(dir, "sweep", "--fail-on-dead").code, 1);
});

test("exorcise finds moment and where it is imported", () => {
  const { dir } = repo({ "package.json": '{"dependencies":{"moment":"^2.0.0","express":"^4.0.0"}}', "src/x.js": "const m = require('moment');\n" });
  const r = aether(dir, "exorcise");
  assert.match(r.out, /moment/);
  assert.match(r.out, /src\/x\.js:1/);
  assert.doesNotMatch(r.out, /express@/);
});

test("drift flags keys missing from .env.example and --fix never copies secrets", () => {
  const { dir } = repo({ ".env.example": "PORT=3000\n", ".env.production": "PORT=3000\nSTRIPE_SECRET=sk_live_abcdefghijklmnop\n" });
  const r = aether(dir, "drift", "--ci");
  assert.equal(r.code, 1);
  assert.match(r.out, /STRIPE_SECRET exists in \.env\.production but is missing from \.env\.example/);
  aether(dir, "drift", "--fix");
  const ex = fs.readFileSync(path.join(dir, ".env.example"), "utf-8");
  assert.match(ex, /STRIPE_SECRET=\n/);
  assert.doesNotMatch(ex, /sk_live/);
});

test("natural language routing (offline router)", () => {
  const dir = os.tmpdir();
  const cases = {
    "save my work, I was building the auth flow": "coffin",
    "restore context": "resurrect",
    "explain this error: x is not a function": "whisper",
    "check my commit message: add login": "oath",
    "scan for dead code": "sweep",
    "any zombie dependencies?": "exorcise",
    "compare my env files": "drift",
  };
  for (const [q, cmd] of Object.entries(cases)) assert.match(aether(dir, q, "--dry-run").out, new RegExp(`aether ${cmd}`), q);
});

test("MCP server: handshake, tool list, a real tool call, and protocol errors", () => {
  const { dir } = repo({ "src/a.ts": "function nobodyCallsMe() {}\n" });
  const lines = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aether_sweep", arguments: { cwd: dir } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope", arguments: {} } },
    { jsonrpc: "2.0", id: 5, method: "bogus/method" },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n";
  const r = spawnSync(process.execPath, [CLI, "mcp"], { cwd: dir, encoding: "utf-8", input: lines, timeout: 60000 });
  const res = Object.fromEntries(r.stdout.trim().split("\n").map((l) => JSON.parse(l)).map((o) => [o.id, o]));
  assert.equal(Object.keys(res).length, 5, "the notification must not get a response");
  assert.equal(res[1].result.serverInfo.name, "aether");
  assert.equal(res[2].result.tools.length, 7);
  assert.match(res[3].result.content[0].text, /nobodyCallsMe/);
  assert.equal(res[4].error.code, -32602);
  assert.equal(res[5].error.code, -32601);
});
