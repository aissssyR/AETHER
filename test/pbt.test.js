// Property-based tests (fast-check). Each property is checked against hundreds of random inputs.
// They exercise the pure engines in dist/core — the same code the CLI, the MCP server and the web playground run.
const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { validateCommit, suggestFromFiles } = require("../dist/core/oath");
const { localWhisper } = require("../dist/core/whisper");
const { parseEnv, exampleValue, buildExample } = require("../dist/core/drift");
const { analyzeFiles } = require("../dist/core/sweep");

const RUNS = { numRuns: 400 };

test("PBT oath: validateCommit is total — never throws, always a boolean verdict", () => {
  fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 200 }), fc.boolean(), (msg, strict) => {
    const v = validateCommit(msg, strict);
    assert.equal(typeof v.passed, "boolean");
    assert.equal(typeof v.reason, "string");
    if (!v.passed) assert.ok(v.reason.length > 0, "a rejection must explain itself");
  }), RUNS);
});

test("PBT oath: the three suggestions ALWAYS pass the validator, for any changed files and any weak message", () => {
  const file = fc.record({
    file: fc.string({ unit: fc.constantFrom(..."abcXYZ019_-./ .é"), minLength: 1, maxLength: 30 }),
    status: fc.constantFrom("M", "A", "D", "??", "R"),
  });
  fc.assert(fc.property(fc.array(file, { maxLength: 6 }), fc.string({ maxLength: 40 }), (files, weak) => {
    const list = suggestFromFiles(weak, files);
    assert.equal(list.length, 3);
    for (const s of list) assert.equal(validateCommit(s).passed, true, `suggestion rejected by its own judge: ${JSON.stringify(s)}`);
  }), RUNS);
});

test("PBT oath: lazy single words are always rejected", () => {
  const lazy = ["fix", "update", "wip", "changes", "stuff", "test", "misc", "temp", "asdf"];
  fc.assert(fc.property(fc.constantFrom(...lazy), fc.constantFrom("", " ", "  "), (w, pad) => {
    assert.equal(validateCommit(pad + w + pad).passed, false);
  }));
});

test("PBT whisper: localWhisper is total on arbitrary text, and extracts the class/method from PHP errors", () => {
  fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 300 }), (s) => {
    const r = localWhisper(s);
    assert.ok(r === null || (typeof r.cause === "string" && typeof r.fix === "string"));
  }), RUNS);
  const ident = fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), minLength: 3, maxLength: 12 });
  fc.assert(fc.property(ident, ident, (cls, method) => {
    const C = cls[0].toUpperCase() + cls.slice(1);
    const r = localWhisper(`Call to undefined method App\\Models\\${C}::${method}()`);
    assert.ok(r && r.cause.includes(method) && r.cause.includes(C));
  }), RUNS);
});

test("PBT drift: parseEnv round-trips any set of simple key/value pairs", () => {
  const key = fc.string({ unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ_"), minLength: 1, maxLength: 12 });
  const val = fc.string({ unit: fc.constantFrom(..."abcdefghij0123456789:/.-@"), maxLength: 24 });
  fc.assert(fc.property(fc.dictionary(key, val), (obj) => {
    const text = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join("\n");
    const parsed = parseEnv(text);
    for (const [k, v] of Object.entries(obj)) assert.equal(parsed.get(k), v);
    assert.equal(parsed.size, Object.keys(obj).length);
  }), RUNS);
});

test("PBT drift: a secret value NEVER reaches the generated .env.example", () => {
  const secretKey = fc.constantFrom("STRIPE_SECRET", "DB_PASSWORD", "API_KEY", "APP_KEY", "GITHUB_TOKEN", "JWT_PRIVATE", "SENTRY_DSN", "WEBHOOK_URL");
  const secretVal = fc.string({ unit: fc.constantFrom(..."abcdefXYZ0123456789"), minLength: 12, maxLength: 40 }).map((s) => "sk_live_" + s);
  fc.assert(fc.property(secretKey, secretVal, (k, v) => {
    assert.equal(exampleValue(k, v), "");
    const out = buildExample(null, [k], new Map([[k, v]]));
    assert.ok(!out.includes(v), "secret leaked");
  }), RUNS);
  // even for non-secret key names, an obviously secret-looking value is blanked
  fc.assert(fc.property(fc.string({ unit: fc.constantFrom(..."abcdefXYZ0123456789"), minLength: 40, maxLength: 60 }), (v) => {
    assert.equal(exampleValue("SOMETHING_ELSE", v), "");
  }), RUNS);
});

test("PBT sweep: analyzeFiles is total, and a function referenced from another file is never reported dead", () => {
  const name = fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), minLength: 5, maxLength: 14 }).filter((n) => !["constructor", "function", "default", "export", "return"].includes(n));
  fc.assert(fc.property(name, (n) => {
    const files = [
      { rel: "src/a.ts", ext: ".ts", text: `export function ${n}() { return 1 }\n` },
      { rel: "src/b.ts", ext: ".ts", text: `import { ${n} } from "./a";\nconsole.log(${n}());\n` },
    ];
    const dead = analyzeFiles(files, null, { orphans: false }).items.filter((i) => i.name === n);
    assert.equal(dead.length, 0);
    const alone = analyzeFiles([files[0]], null, { orphans: false }).items.filter((i) => i.name === n);
    assert.equal(alone.length, 1, "an unreferenced function must be reported");
  }), RUNS);
  fc.assert(fc.property(fc.string({ unit: "binary", maxLength: 400 }), (text) => {
    analyzeFiles([{ rel: "x/y.ts", ext: ".ts", text }, { rel: "x/z.py", ext: ".py", text }, { rel: "x/q.php", ext: ".php", text }], null, {});
  }), { numRuns: 200 });
});
