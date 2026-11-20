// Guards the browser surface: the bundled engines and the interactive terminal's virtual shell.
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const docs = path.join(__dirname, "..", "docs");
function load() {
  const ctx = { console, Date, Math, JSON, Object, Array, Set, Map, String, Number, RegExp, parseInt };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(docs, "engine.js"), "utf8") + ";window.AetherCore=AetherCore;", ctx);
  vm.runInContext(fs.readFileSync(path.join(docs, "terminal.js"), "utf8"), ctx);
  return ctx;
}
const text = (h) => h.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

test("engine.js is browser-safe (runs in a VM with no Node APIs) and exposes the engines", () => {
  const { AetherCore: C } = load();
  for (const k of ["localWhisper", "validateCommit", "suggestFromFiles", "analyzeDrift", "buildExample", "analyzeFiles", "localRoute", "parseManifests", "findUsages", "localAnalysis", "renderCoffinMarkdown"])
    assert.equal(typeof C[k], "function", k);
});

test("terminal: edit → coffin → resurrect round-trips inside the virtual shell", () => {
  const ctx = load(); const sh = new ctx.AetherTerm.Shell(); sh.exec("reset");
  sh.exec('echo "// wip" >> src/tax.ts');
  assert.match(text(sh.exec("git status").html), /modified:\s+src\/tax\.ts/);
  assert.match(text(sh.exec('aether coffin "fixing tax"').html), /coffin is sealed/);
  const r = text(sh.exec("aether resurrect").html);
  assert.match(r, /fixing tax/); assert.match(r, /src\/tax\.ts:\d+/);
});

test("terminal: the oath hook rejects 'fix bug' and accepts a specific commit", () => {
  const ctx = load(); const sh = new ctx.AetherTerm.Shell(); sh.exec("reset");
  sh.exec('echo "// x" >> src/tax.ts'); sh.exec("git add .");
  const bad = sh.exec('git commit -m "fix bug"');
  assert.equal(bad.reject, true); assert.match(text(bad.html), /not an acceptable sacrifice/);
  assert.match(text(sh.exec('git commit -m "fix(tax): round the calculated tax to whole rupiah"').html), /1 file changed/);
});

test("terminal: sweep, exorcise and drift run the real engines on the demo project", () => {
  const ctx = load(); const sh = new ctx.AetherTerm.Shell(); sh.exec("reset");
  assert.match(text(sh.exec("aether sweep").html), /legacyDiscount/);
  assert.match(text(sh.exec("aether exorcise").html), /moment/);
  assert.match(text(sh.exec("aether drift").html), /STRIPE_SECRET exists in \.env\.production but is missing from \.env\.example/);
  sh.exec("aether drift --fix");
  const ex = text(sh.exec("cat .env.example").html);
  assert.match(ex, /STRIPE_SECRET=\n/); assert.doesNotMatch(ex, /sk_live/);
});

test("terminal: natural language routes, and the shell never evaluates input", () => {
  const ctx = load(); const sh = new ctx.AetherTerm.Shell(); sh.exec("reset");
  assert.match(text(sh.exec('aether "scan for dead code"').html), /routing → aether sweep/);
  assert.match(text(sh.exec("foo").html), /command not found/);
  const evil = sh.exec("echo '<img src=x onerror=alert(1)>'").html;
  assert.ok(!/<img/.test(evil), "output must be HTML-escaped");
});
