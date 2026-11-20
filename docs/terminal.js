/* AETHER · interactive terminal.
 * A sandboxed shell over an in-memory project. Every `aether …` ritual runs the SAME engines as the CLI
 * (bundled in engine.js). Nothing leaves the browser; state is kept in localStorage if available. */
(function () {
  var C = window.AetherCore;
  var KEY = "aether-term-v1";
  var CODE_EXTS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".php", ".html", ".vue", ".svelte", ".ejs", ".hbs", ".twig", ".json", ".yml", ".yaml"];

  var DEMO = {
    "package.json": '{\n  "name": "demo-shop",\n  "version": "1.0.0",\n  "dependencies": {\n    "express": "^4.18.0",\n    "lodash": "^4.17.21",\n    "moment": "^2.29.4"\n  }\n}\n',
    "README.md": "# demo-shop\n\nA tiny shop used to try AETHER. Edit a file, then seal a coffin.\n",
    "src/tax.ts": "export function calculateTax(amount: number) {\n  return amount * 0.11;\n}\n\nexport function formatPrice(n: number) {\n  return `Rp ${n}`;\n}\n\nfunction legacyDiscount(x: number) {\n  return x * 0.9;\n}\n",
    "src/index.ts": 'import moment from "moment";\nimport { formatPrice } from "./tax";\n\nconsole.log(formatPrice(42), moment().format("YYYY-MM-DD"));\n',
    "src/db.ts": "export const dbUrl = process.env.DB_URL;\nexport const appKey = process.env.APP_KEY;\nconsole.log(dbUrl, appKey);\n",
    "src/orphan.ts": "export const nobodyImportsMe = 1;\n",
    "src/auth/UserController.php": "<?php\nclass UserController {\n    public function resetPassword($token) {\n        return $this->verifyToken($token);\n    }\n\n    private function verifyToken($token) {\n        return true;\n    }\n\n    private function oldHelper() {\n        return null;\n    }\n}\n",
    ".env.example": "APP_KEY=\nPORT=3000\n",
    ".env.production": "APP_KEY=base64:Zm9vYmFy\nPORT=3000\nSTRIPE_SECRET=sk_live_abcdefghijklmnop\n",
    ".env.local": "APP_KEY=local\nDB_URL=postgres://localhost/dev\n"
  };

  // ───────────────────────── helpers ─────────────────────────
  var esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); };
  var sp = function (c, t) { return '<span class="' + c + '">' + esc(t) + "</span>"; };
  function hdr(icon, title, sub, c) { return "\n" + sp(c || "v", "  " + icon + "  " + title).replace("<span", '<span style="font-weight:600"') + "\n" + sp("d", "     " + sub) + "\n\n"; }
  var rule = function () { return sp("d", "  " + new Array(57).join("─")) + "\n"; };
  var okL = function (t) { return "  " + sp("g", "✔") + " " + t + "\n"; };
  var warnL = function (t) { return "  " + sp("a", "▲") + " " + esc(t) + "\n"; };
  var failL = function (t) { return "  " + sp("r", "✖") + " " + esc(t) + "\n"; };
  var noteL = function (t) { return sp("d", "  " + t) + "\n"; };
  function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }
  function extOf(n) { var l = n.toLowerCase(); if (/\.blade\.php$/.test(l)) return ".blade.php"; var m = l.match(/\.[a-z0-9]+$/); return m ? m[0] : ""; }
  function timeAgo(d) { var s = Math.max(0, Math.floor((Date.now() - d) / 1000)); if (s < 60) return s + "s ago"; var m = Math.floor(s / 60); if (m < 60) return m + "m ago"; return Math.floor(m / 60) + "h ago"; }
  function fakeSha(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return ("0000000" + h.toString(16)).slice(-7); }

  function tokenize(line) {
    var out = [], cur = "", q = null, has = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) { if (ch === q) q = null; else if (ch === "\\" && q === '"' && /["\\$]/.test(line[i + 1] || "")) { cur += line[++i]; } else cur += ch; }
      else if (ch === '"' || ch === "'") { q = ch; has = true; }
      else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; }
      else if (ch === ">") { if (cur || has) out.push(cur); cur = ""; has = false; if (line[i + 1] === ">") { out.push(">>"); i++; } else out.push(">"); }
      else cur += ch;
    }
    if (cur || has) out.push(cur);
    return out;
  }

  // ───────────────────────── shell state ─────────────────────────
  function fresh() { return { vfs: JSON.parse(JSON.stringify(DEMO)), base: JSON.parse(JSON.stringify(DEMO)), staged: {}, commits: [{ sha: fakeSha("init"), msg: "chore: initial commit" }], coffin: null, touch: {}, clock: 0 }; }
  function load() { try { var r = localStorage.getItem(KEY); if (r) { var s = JSON.parse(r); if (s && s.vfs && s.base) return s; } } catch (e) { /* storage unavailable */ } return fresh(); }
  function save(S) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

  function Shell(opts) {
    var S = load(); opts = opts || {};
    var self = this;
    self.state = function () { return S; };

    function files() { return Object.keys(S.vfs).filter(function (n) { return n !== "COFFIN.md"; }).sort().map(function (n) { return { rel: n, ext: extOf(n), text: S.vfs[n] }; }); }
    function codeFiles() { return files().filter(function (f) { return CODE_EXTS.indexOf(f.ext) >= 0; }); }

    function changes() {
      var out = [], all = {}; Object.keys(S.vfs).concat(Object.keys(S.base)).forEach(function (k) { all[k] = 1; });
      Object.keys(all).sort().forEach(function (f) {
        if (f === "COFFIN.md") return;
        var cur = S.vfs[f], b = S.base[f]; if (cur === b) return;
        var status = b === undefined ? "??" : cur === undefined ? "D" : "M", line;
        if (status === "M") { var a = b.split("\n"), c = cur.split("\n"); for (var i = 0; i < c.length; i++) if (a[i] !== c[i]) { line = i + 1; break; } }
        else if (status === "??") line = 1;
        out.push({ file: f, status: status, label: status === "M" ? "modified" : status === "D" ? "deleted" : "untracked", line: line, staged: S.staged[f] === cur });
      });
      return out;
    }

    // ── aether rituals ──
    function whisper(text) {
      var h = hdr("👂", "ERROR TRANSLATOR", "From ghost-speak to human", "c");
      h += sp("d", "  Heard:") + "\n" + sp("d", "    " + text.slice(0, 300)) + "\n\n" + rule();
      var r = C.localWhisper(text);
      if (!r) return { html: h + warnL("This curse isn't in the grimoire yet.") + noteL("The CLI can send any error to an AI model when NEBIUS_API_KEY is set.") };
      return { html: h + "\n" + sp("c", "  What happened") + "\n  " + esc(r.cause) + "\n\n" + sp("g", "  How to fix it") + "\n  " + esc(r.fix) + "\n\n" + rule() };
    }

    function oathJudge(msg) {
      var v = C.validateCommit(msg);
      if (v.passed) return { ok: true };
      var sug = C.suggestFromFiles(msg, changes().map(function (c) { return { file: c.file, status: c.status }; }));
      var h = hdr("🩸", "THE OATH", "Weak oaths are rejected by the spirits", "r");
      h += sp("r", "  👻 The Code Spirits are displeased.") + "\n" + sp("r", '     "' + msg + '" is not an acceptable sacrifice.') + "\n" + sp("d", "     Reason: " + v.reason) + "\n\n" + rule() + "\n";
      h += sp("v", "  The spirits offer these instead:") + "\n\n" + sug.map(function (s, i) { return "  " + sp("v", "[" + (i + 1) + "] ") + esc(s); }).join("\n") + "\n\n";
      h += noteL("Try one of them:  git commit -m \"" + sug[0] + "\"") ;
      return { ok: false, html: h, reject: true };
    }

    function doCommit(msg) {
      var staged = changes().filter(function (c) { return c.staged; });
      if (!staged.length) return warnL("Nothing staged. Run `git add .` first.");
      staged.forEach(function (c) { if (c.status === "D") delete S.base[c.file]; else S.base[c.file] = S.vfs[c.file]; delete S.staged[c.file]; });
      var sha = fakeSha(msg + S.commits.length); S.commits.unshift({ sha: sha, msg: msg });
      return "[main " + sp("g", sha) + "] " + esc(msg) + "\n " + staged.length + " file" + (staged.length > 1 ? "s" : "") + " changed\n";
    }

    function oath(msg) {
      var j = oathJudge(msg);
      if (j.ok) return { html: hdr("🩸", "THE OATH", "The spirits weigh your words", "g") + okL(sp("g", "The spirits accept your oath.") + sp("d", '  "' + msg + '"')) + doCommit(msg) };
      return { html: j.html, reject: true };
    }

    function sweep() {
      var fs = codeFiles(), r = C.analyzeFiles(fs, null, { pkgJson: S.vfs["package.json"], orphans: true });
      var h = hdr("🧹", "DEADCODE HUNTER", "The Graveyard Detective traces every call", "a") + noteL("Scanned " + r.scanned + " files · tracing function/class references across the whole project") + "\n";
      if (!r.items.length) return { html: h + okL(sp("g", "The graveyard is empty.")) };
      var last = ""; r.items.forEach(function (i) {
        if (i.file !== last) { h += sp("c", "  " + i.file) + "\n"; last = i.file; }
        h += "   " + sp(i.confidence === "high" ? "r" : "a", pad("[" + i.confidence + "]", 9)) + sp("d", pad("L" + i.line, 5)) + " " + (i.kind === "file" ? "orphan file" : i.kind + " " + sp("b", i.name + (i.kind === "class" ? "" : "()"))) + "\n" + sp("d", "            " + i.why) + "\n";
      });
      var hi = r.items.filter(function (i) { return i.confidence === "high"; }).length;
      return { html: h + "\n" + rule() + "  " + sp("r", String(hi)) + " high-confidence · " + sp("a", String(r.items.length - hi)) + " medium-confidence candidates\n" + noteL("high = not exported and never referenced → safe to delete.") + noteL("Static analysis is textual: dynamic calls and reflection may hide usages.") };
    }

    function exorcise(args) {
      var m = C.parseManifests(S.vfs["package.json"], S.vfs["requirements.txt"]);
      var h = hdr("🧿", "ZOMBIE DEPENDENCY EXORCIST", "Finding the undead in your manifests", "r") + noteL("Read " + m.deps.length + " dependencies from " + m.files.join(" + ")) + "\n";
      var src = codeFiles().filter(function (f) { return [".json", ".yml", ".yaml", ".html"].indexOf(f.ext) < 0; }), n = 0, used = 0;
      m.deps.forEach(function (d) {
        var z = d.eco === "npm" ? C.NPM[d.name] : C.PYPI[d.name]; if (!z) return; n++;
        var u = C.findUsages(src, d), col = z.severity === "security" ? "r" : z.severity === "deprecated" ? "a" : "c";
        h += "  🧟 " + sp("b", d.name) + sp("d", "@" + d.version) + "  " + sp(col, "[" + z.severity + "]") + "\n" + sp("d", "     " + z.reason) + "\n     " + sp("g", "✨ replace with " + z.alt) + "\n" + sp("d", "     tip: " + z.tip) + "\n";
        if (u.length) { used++; h += sp("d", "     used in " + new Set(u.map(function (x) { return x.file; })).size + " file(s):") + "\n"; u.slice(0, 4).forEach(function (x) { h += sp("d", "       " + x.file + ":" + x.line + "  " + x.text) + "\n"; }); }
        else h += sp("d", "     not imported anywhere in source — likely safe to simply uninstall") + "\n";
        h += "\n";
      });
      if (!n) return { html: h + okL(sp("g", "No zombies detected.")) };
      if (args.indexOf("--rewrite") >= 0 || args.indexOf("--apply") >= 0) h += rule() + warnL("--rewrite is performed by an AI model: use the CLI with NEBIUS_API_KEY. The browser sandbox only analyses.");
      else if (used) h += noteL("The CLI can rewrite these files for you:  aether exorcise --rewrite");
      return { html: h + rule() + "  " + sp("r", String(n)) + " zombie(s) found.\n" };
    }

    function drift(args) {
      var names = Object.keys(S.vfs).filter(function (n) { return /^\.env(\.|$)/.test(n) || /\.env$/.test(n); }), exName = ".env.example";
      var all = names.map(function (n) { return { name: n, keys: C.parseEnv(S.vfs[n]) }; });
      var ex = all.filter(function (f) { return f.name === exName; })[0];
      var used = C.keysUsedIn(codeFiles().filter(function (f) { return [".json", ".yml", ".yaml", ".html"].indexOf(f.ext) < 0; }));
      var r = C.analyzeDrift(all, ex, used), keys = Array.from(r.union).sort();
      var w = Math.max(14, Math.max.apply(null, keys.map(function (k) { return k.length; }).concat([8])) + 2);
      var h = hdr("📊", "CONFIG DRIFT DETECTOR", "Keeping every environment in agreement", "c") + noteL("Compared: " + names.join(", ") + "  ·  " + used.size + " variable(s) read in code") + "\n";
      h += "  " + sp("d", pad("VARIABLE", w) + all.map(function (f) { return pad(f.name.replace(/^\.env\.?/, "") || "env", 12); }).join("")) + "\n";
      keys.forEach(function (k) { h += "  " + pad(k, w) + all.map(function (f) { return (f.keys.has(k) ? sp("g", "●") : sp("r", "○")) + "           "; }).join("") + "\n"; });
      h += "\n";
      if (!r.unique.length) h += okL(sp("g", "No drift. Every environment agrees."));
      r.unique.forEach(function (i) { h += i.level === "error" ? failL(i.msg) : warnL(i.msg); });
      if (args.indexOf("--fix") >= 0) {
        var known = new Map(); all.forEach(function (f) { f.keys.forEach(function (v, k) { if (!known.has(k) || (!known.get(k) && v)) known.set(k, v); }); });
        var existing = ex ? ex.keys : new Map(), missing = Array.from(r.union).filter(function (k) { return !existing.has(k); }).sort();
        S.vfs[exName] = C.buildExample(S.vfs[exName] !== undefined ? S.vfs[exName] : null, missing, known);
        h += "\n" + okL(exName + " " + (missing.length ? "updated with " + missing.length + " variable(s)" : "is already complete") + "  " + sp("d", "(secret values are always blanked)")) + noteL("See it:  cat .env.example");
      } else if (r.unique.length) h += "\n" + noteL("Fix automatically:  aether drift --fix");
      return { html: h + "\n" + rule() };
    }

    function coffin(note) {
      var ch = changes(), files = ch.map(function (c) { return { file: c.file, status: c.status, label: c.label, line: c.line }; });
      files.sort(function (a, b) { return (S.touch[b.file] || 0) - (S.touch[a.file] || 0); });
      var h = hdr("⚰️", "CRYOSTASIS", "Freezing your mental + physical context", "v") + noteL("Directory: ~/demo-shop");
      h += "  " + sp("v", "›") + " Physical snapshot: " + files.length + " file(s) in flight on " + sp("c", "main") + "\n";
      files.slice(0, 6).forEach(function (f) { h += sp("d", "     " + f.file + (f.line ? ":" + f.line : "") + " — " + f.label) + "\n"; });
      h += "  " + sp("v", "›") + " Git snapshot: " + (files.length ? "in the real CLI your changes are preserved as a stash (working tree untouched)" : "nothing to preserve") + "\n";
      var a = C.localAnalysis(files, note);
      var data = { version: 1, sealedAt: new Date().toISOString(), cwd: "~/demo-shop", note: note, branch: "main", head: fakeSha("head" + S.commits.length) + "0000000000", stash: null, isGitRepo: true, files: files, summary: a.context_summary, nextSteps: a.next_steps, resume: [], source: "local" };
      S.coffin = data; S.vfs["COFFIN.md"] = C.renderCoffinMarkdown(data);
      return { html: h + "\n" + rule() + okL(sp("g", "The coffin is sealed.") + sp("d", "  → COFFIN.md")) + noteL("When you return:  aether resurrect   ·   read it:  cat COFFIN.md") + "\n", coffin: true };
    }

    function resurrect() {
      var d = S.coffin, h = hdr("💀", "RESURRECTION", "The dead have risen — here is where you stopped", "r");
      if (!d) return { html: h.replace(/\n$/, "") + failL("No coffin found in this directory.") + noteL('Seal one first:  aether coffin "what you were doing"') };
      h += "  " + sp("b", "Good morning. Sealed " + timeAgo(new Date(d.sealedAt))) + "\n\n" + sp("d", "  Last words  ") + '"' + esc(d.note) + '"\n\n' + sp("v", "  Where you stopped") + "\n  " + esc(d.summary.replace(/`/g, "")) + "\n\n" + sp("g", "  Do this next") + "\n";
      d.nextSteps.forEach(function (s, i) { h += "  " + sp("g", (i + 1) + ".") + " " + esc(s.replace(/`/g, "")) + "\n"; });
      if (d.files.length) { h += "\n" + sp("c", "  Files in flight") + "\n"; d.files.slice(0, 8).forEach(function (f) { h += "  " + sp("d", "•") + " " + f.file + sp("d", (f.line ? ":" + f.line : "") + " — " + f.label) + "\n"; }); }
      return { html: h + "\n" + rule() + noteL("Now go build something hauntingly great.") };
    }

    function aetherHelp() {
      return { html: hdr("🌌", "AETHER", "seven rituals · speak plainly or call one by name", "v") + [
        ["coffin \"<note>\"", "freeze your context"], ["resurrect", "wake it again"], ["sweep", "find dead code"], ["exorcise", "find zombie dependencies"],
        ["whisper \"<error>\"", "translate an error"], ["oath \"<message>\"", "judge a commit message"], ["drift [--fix]", "compare .env files"], ["\"<anything in English>\"", "AETHER picks the ritual"]
      ].map(function (r) { return "  " + sp("a", pad("aether " + r[0], 34)) + sp("d", r[1]); }).join("\n") + "\n" };
    }

    function aether(args) {
      if (!args.length) return aetherHelp();
      var first = args[0], rest = args.slice(1);
      if (first === "--version" || first === "-V") return { html: "3.0.0\n" };
      if (first === "--help" || first === "-h" || first === "help") return aetherHelp();
      if (first === "mcp") return { html: noteL("`aether mcp` starts an MCP server over stdio so Kiro can call these rituals as tools.") + noteL("It needs the CLI (npm link) — see the README and .kiro/settings/mcp.json.") };
      if (first === "whisper") return rest.length ? whisper(rest.join(" ")) : { html: warnL('Usage: aether whisper "<error>"') };
      if (first === "oath") { var m = rest.filter(function (a) { return a.indexOf("--") !== 0; }).join(" "); return m ? oath(m) : { html: warnL('Usage: aether oath "<commit message>"') }; }
      if (first === "sweep") return sweep();
      if (first === "exorcise") return exorcise(rest);
      if (first === "drift") return drift(rest);
      if (first === "resurrect") return resurrect();
      if (first === "coffin") return rest.length ? coffin(rest.join(" ")) : { html: warnL('Usage: aether coffin "<what you were doing>"') };
      if (first === "ask") { args = rest; if (!args.length) return aetherHelp(); }
      // natural language
      var text = args.join(" "), route = C.localRoute(text);
      var h = sp("d", "  › Offline router (the CLI uses an AI model when NEBIUS_API_KEY is set).") + "\n";
      if (!route) return { html: h + warnL("AETHER couldn't map that to a ritual.") + noteL("Rituals: " + C.ALL_COMMANDS.join(" · ")) };
      h += rule() + "  " + esc(route.explanation) + "\n  " + sp("d", "routing → ") + sp("v", "aether " + route.command) + (route.params ? sp("d", ' "' + route.params + '"') : "") + "\n" + rule();
      var p = route.params || text, r;
      switch (route.command) {
        case "coffin": r = coffin(p); break; case "resurrect": r = resurrect(); break; case "whisper": r = whisper(p); break;
        case "oath": r = oath(p); break; case "sweep": r = sweep(); break; case "exorcise": r = exorcise([]); break; default: r = drift([]);
      }
      r.html = h + r.html; return r;
    }

    // ── plain shell ──
    function ls(p) {
      p = (p || "").replace(/^\.\/?/, "").replace(/\/$/, "");
      var seen = {}, out = [];
      Object.keys(S.vfs).sort().forEach(function (f) {
        if (p && f.indexOf(p + "/") !== 0) return;
        var rest = p ? f.slice(p.length + 1) : f, seg = rest.split("/")[0], isDir = rest.indexOf("/") > 0;
        if (!seen[seg]) { seen[seg] = 1; out.push(isDir ? sp("c", seg + "/") : /^\./.test(seg) ? sp("d", seg) : esc(seg)); }
      });
      return out.length ? { html: out.join("  ") + "\n" } : { html: "ls: cannot access '" + esc(p) + "': No such file or directory\n" };
    }

    function git(args) {
      var sub = args[0];
      if (sub === "status") {
        var ch = changes(), staged = ch.filter(function (c) { return c.staged; }), un = ch.filter(function (c) { return !c.staged; });
        var h = "On branch " + sp("c", "main") + "\n";
        if (!ch.length) return { html: h + "nothing to commit, working tree clean\n" };
        if (staged.length) h += "\nChanges to be committed:\n" + staged.map(function (c) { return sp("g", "        " + pad(c.label + ":", 11) + c.file); }).join("\n") + "\n";
        if (un.length) h += "\nChanges not staged for commit:\n" + un.map(function (c) { return sp("r", "        " + pad(c.label + ":", 11) + c.file); }).join("\n") + "\n";
        return { html: h };
      }
      if (sub === "add") { var n = 0; changes().forEach(function (c) { if (!args[1] || args[1] === "." || args[1] === c.file) { S.staged[c.file] = S.vfs[c.file]; n++; } }); return { html: n ? "" : warnL("Nothing to add.") }; }
      if (sub === "log") return { html: S.commits.slice(0, 10).map(function (c) { return sp("a", c.sha) + " " + esc(c.msg); }).join("\n") + "\n" };
      if (sub === "commit") {
        var mi = args.indexOf("-m"); if (mi < 0 || !args[mi + 1]) return { html: warnL('Usage: git commit -m "<message>"') };
        var msg = args[mi + 1], bypass = args.indexOf("--no-verify") >= 0;
        if (!bypass) { var j = oathJudge(msg); if (!j.ok) return { html: j.html + noteL("The commit was blocked by the oath hook. (git commit --no-verify bypasses it.)"), reject: true }; }
        return { html: doCommit(msg) };
      }
      return { html: warnL("This sandbox supports: git status | add | commit | log") };
    }

    self.exec = function (line) {
      line = line.trim(); if (!line) return { html: "" };
      var t = tokenize(line), cmd = t[0], result;
      var rd = t.indexOf(">>") >= 0 ? t.indexOf(">>") : t.indexOf(">"), op = rd >= 0 ? t[rd] : null;
      if (cmd === "clear") return { clear: true, html: "" };
      if (cmd === "help") result = { html: sp("b", "AETHER terminal") + sp("d", " — a real shell over an in-memory project (nothing leaves your browser)") + "\n\n" +
        "  " + sp("a", 'aether "save my work, I was fixing the reset token"') + "\n  " + sp("a", "aether sweep") + sp("d", "  ·  ") + sp("a", "drift") + sp("d", "  ·  ") + sp("a", "exorcise") + sp("d", "  ·  ") + sp("a", 'whisper "<error>"') + sp("d", "  ·  ") + sp("a", 'oath "<msg>"') + "\n  " + sp("a", "git status") + sp("d", "  ·  ") + sp("a", "git add .") + sp("d", "  ·  ") + sp("a", 'git commit -m "fix bug"') + sp("d", "   ← the oath hook is installed") + "\n  " + sp("a", 'echo "// wip" >> src/tax.ts') + sp("d", "  ·  ") + sp("a", "cat <file>") + sp("d", "  ·  ") + sp("a", "ls") + sp("d", "  ·  ") + sp("a", "reset") + "\n" };
      else if (cmd === "reset") { S = fresh(); result = { html: okL("The graveyard was reset to its original state.") }; }
      else if (cmd === "pwd") result = { html: "/home/you/demo-shop\n" };
      else if (cmd === "ls") result = ls(t[1]);
      else if (cmd === "cat") { var f = (t[1] || "").replace(/^\.\//, ""); result = S.vfs[f] !== undefined ? { html: esc(S.vfs[f]) + (S.vfs[f].slice(-1) === "\n" ? "" : "\n") } : { html: "cat: " + esc(t[1] || "") + ": No such file or directory\n" }; }
      else if (cmd === "echo") {
        var parts = op ? t.slice(1, rd) : t.slice(1), text = parts.join(" ");
        if (op) { var target = (t[rd + 1] || "").replace(/^\.\//, ""); if (!target) result = { html: warnL("echo: missing file after " + op) }; else { S.vfs[target] = op === ">>" ? (S.vfs[target] || "") + (S.vfs[target] && S.vfs[target].slice(-1) !== "\n" ? "\n" : "") + text + "\n" : text + "\n"; S.touch[target] = ++S.clock; result = { html: "" }; } }
        else result = { html: esc(text) + "\n" };
      }
      else if (cmd === "git") result = git(t.slice(1));
      else if (cmd === "aether" || cmd === "luvsean") result = aether(t.slice(1));
      else result = { html: "bash: " + esc(cmd) + ": command not found" + sp("d", "   (type help)") + "\n" };
      save(S); return result;
    };

    self.complete = function (partial) {
      var words = partial.split(/\s+/), last = words[words.length - 1], first = words.length === 1;
      var cmds = ["aether", "git", "ls", "cat", "echo", "clear", "help", "reset", "pwd"], sub = ["coffin", "resurrect", "whisper", "oath", "sweep", "exorcise", "drift", "mcp", "help"];
      var pool = first ? cmds : words[0] === "aether" && words.length === 2 ? sub : words[0] === "git" && words.length === 2 ? ["status", "add", "commit", "log"] : Object.keys(S.vfs);
      var hits = pool.filter(function (x) { return x.indexOf(last) === 0; });
      return hits.length === 1 ? words.slice(0, -1).concat(hits[0]).join(" ") + (first || words.length === 2 ? " " : "") : null;
    };
  }

  // ───────────────────────── UI ─────────────────────────
  function mount(el, opts) {
    opts = opts || {};
    var shell = new Shell(), hist = [], hi = 0, busy = false, typingTimer = null;
    el.classList.add("tty");
    el.innerHTML = '<pre class="tty-out" aria-live="polite"></pre><label class="tty-line"><span class="tty-prompt" aria-hidden="true">demo-shop <b>$</b></span><input class="tty-in" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" aria-label="Terminal input. Type help for commands."></label>';
    var out = el.querySelector(".tty-out"), inp = el.querySelector(".tty-in");

    function scroll() { el.scrollTop = el.scrollHeight; }
    function print(html) { out.insertAdjacentHTML("beforeend", html); scroll(); }
    function echo(cmd) { print('<span class="tty-prompt">demo-shop <b>$</b></span> ' + esc(cmd) + "\n"); }
    function run(cmd) {
      echo(cmd); if (cmd.trim()) { hist.push(cmd); hi = hist.length; }
      var r = shell.exec(cmd);
      if (r.clear) out.innerHTML = ""; else print(r.html);
      if (r.reject && opts.onReject) opts.onReject(el);
      if (opts.onRun) opts.onRun(cmd, r);
      scroll(); return r;
    }

    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { var v = inp.value; inp.value = ""; run(v); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (hi > 0) { hi--; inp.value = hist[hi]; } }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (hi < hist.length - 1) { hi++; inp.value = hist[hi]; } else { hi = hist.length; inp.value = ""; } }
      else if (e.key === "Tab") { e.preventDefault(); var c = shell.complete(inp.value); if (c) inp.value = c; }
      else if (e.key === "l" && e.ctrlKey) { e.preventDefault(); out.innerHTML = ""; }
    });
    el.addEventListener("click", function () { if (!getSelection().toString()) inp.focus(); });

    /** Types a list of commands like a person would, running each; returns when done. */
    function macro(cmds, speed) {
      clearTimeout(typingTimer); out.innerHTML = ""; inp.value = "";
      var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches, i = 0;
      (function next() {
        if (i >= cmds.length) return;
        var cmd = cmds[i++], n = 0;
        if (reduce) { inp.value = ""; run(cmd); return next(); }
        (function typeCh() {
          if (n <= cmd.length) { inp.value = cmd.slice(0, n++); scroll(); typingTimer = setTimeout(typeCh, speed || 16); }
          else typingTimer = setTimeout(function () { inp.value = ""; run(cmd); typingTimer = setTimeout(next, 450); }, 260);
        })();
      })();
    }

    print(sp("b", "AETHER terminal") + sp("d", " — type ") + sp("a", "help") + sp("d", ". A real shell over an in-memory project; nothing leaves your browser.") + "\n");
    return { run: run, macro: macro, focus: function () { inp.focus(); }, shell: shell, el: el };
  }

  // Scripted demos used by the tabs / chips: each starts from a clean project, then types real commands.
  var EDIT = 'echo "// TODO: expire token after 15 min" >> src/auth/UserController.php';
  var COFFIN = 'aether coffin "fixing password reset token expiry"';
  var MACROS = {
    ask: [EDIT, 'aether "save my work, I was fixing the reset token"'],
    coffin: [EDIT, COFFIN],
    resurrect: [EDIT, COFFIN, "aether resurrect"],
    sweep: ["aether sweep"],
    exorcise: ["aether exorcise"],
    whisper: ['aether whisper "Call to undefined method App\\Models\\User::getAttributes()"'],
    oath: [EDIT, "git add .", 'git commit -m "fix bug"'],
    drift: ["aether drift", "aether drift --fix"]
  };
  function play(term, name) { term.shell.exec("reset"); term.macro((MACROS[name] || []).slice()); }

  window.AetherTerm = { mount: mount, Shell: Shell, DEMO: DEMO, MACROS: MACROS, play: play };
})();
