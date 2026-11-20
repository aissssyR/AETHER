// Pure error grimoire: no I/O, runs in Node and in the browser.


export interface Rule {
  re: RegExp;
  say: (m: RegExpMatchArray) => { cause: string; fix: string };
}

export const RULES: Rule[] = [
  {
    re: /Call to undefined method ([\w\\]+)::(\w+)\(\)/i,
    say: (m) => {
      const cls = m[1].split("\\").pop();
      return {
        cause: `You called ${m[2]}() on ${cls}, but that class has no such method.`,
        fix: `Check for a typo, make sure the method exists on ${cls} (or its parent/trait), or add it. For Eloquent models you may want the ${m[2].replace(/^get/, "").replace(/^./, (c) => c.toLowerCase())} property instead.`,
      };
    },
  },
  { re: /Class ['"]?([\w\\]+)['"]? not found/i, say: (m) => ({ cause: `PHP can't find the class ${m[1]}.`, fix: "Check the namespace/`use` statement and run `composer dump-autoload`." }) },
  { re: /Undefined (?:variable|index|array key|offset)[: ]+['"$]?(\w+)/i, say: (m) => ({ cause: `You read "${m[1]}" before it was defined.`, fix: "Initialise it first, or guard with isset()/?? before reading." }) },
  { re: /SQLSTATE\[(\w+)\].*?(?:Table|Column) '?([\w.]+)'? (?:doesn't exist|not found)/i, say: (m) => ({ cause: `The database has no table/column "${m[2]}" (SQLSTATE ${m[1]}).`, fix: "Run your migrations and check the table/column name for typos." }) },
  { re: /Cannot read propert(?:y|ies) (?:of (?:undefined|null)|['"](\w+)['"])[^(]*(?:\(reading '(\w+)'\))?/i, say: (m) => ({ cause: `Something is null/undefined and you tried to read ${m[2] ? `"${m[2]}"` : "a property"} from it.`, fix: "Trace where the value comes from; add a null check or optional chaining (obj?.prop)." }) },
  { re: /(\w+) is not a function/i, say: (m) => ({ cause: `"${m[1]}" isn't a function at runtime — it is undefined or a different type.`, fix: "Verify the import/export name and that the value is what you think it is (console.log(typeof …))." }) },
  { re: /(\w+) is not defined/i, say: (m) => ({ cause: `"${m[1]}" was never declared or imported in this scope.`, fix: "Import it, declare it, or fix the typo." }) },
  { re: /Cannot find module ['"]([^'"]+)['"]|Module not found.*?['"]([^'"]+)['"]/i, say: (m) => ({ cause: `Node can't resolve the module "${m[1] ?? m[2]}".`, fix: "Run `npm install`, or check the package name / relative path and its casing." }) },
  { re: /ModuleNotFoundError: No module named ['"]([\w.]+)['"]/i, say: (m) => ({ cause: `Python can't import "${m[1]}".`, fix: `Activate the right virtualenv and run \`pip install ${m[1].split(".")[0]}\`.` }) },
  { re: /IndentationError|TabError/i, say: () => ({ cause: "Python found inconsistent indentation.", fix: "Use 4 spaces everywhere and don't mix tabs with spaces." }) },
  { re: /KeyError: ['"]?(\w+)/i, say: (m) => ({ cause: `The dict has no key "${m[1]}".`, fix: "Use dict.get('key') or check `in` first." }) },
  { re: /EADDRINUSE[^\d]*(\d{2,5})?|address already in use[^\d]*(\d{2,5})?/i, say: (m) => ({ cause: (m[1] ?? m[2]) ? `Port ${m[1] ?? m[2]} is already used by another process.` : "The port is already used by another process.", fix: "Stop the other process (`npx kill-port <port>`) or pick another port." }) },
  { re: /ENOENT.*?['"]([^'"]+)['"]|no such file or directory/i, say: (m) => ({ cause: `The path ${m[1] ? `"${m[1]}" ` : ""}doesn't exist.`, fix: "Check the path, the working directory, and case-sensitivity (Linux/macOS)." }) },
  { re: /EACCES|permission denied(?! \(publickey)/i, say: () => ({ cause: "The OS denied access to a file, directory or port.", fix: "Check ownership/permissions; avoid sudo with npm — fix the directory owner instead." }) },
  { re: /ECONNREFUSED.*?(\d{2,5})?/i, say: (m) => ({ cause: `Nothing is listening at ${m[1] ? "port " + m[1] : "that address"}.`, fix: "Start the service (database/API) and verify host and port in your config." }) },
  { re: /ERESOLVE|unable to resolve dependency tree/i, say: () => ({ cause: "npm found two packages whose peer-dependency ranges conflict.", fix: "Align the versions; as a last resort use `--legacy-peer-deps`." }) },
  { re: /heap out of memory/i, say: () => ({ cause: "Node ran out of heap memory.", fix: "Find the leak/huge payload, or raise the limit: NODE_OPTIONS=--max-old-space-size=4096." }) },
  { re: /Permission denied \(publickey\)/i, say: () => ({ cause: "GitHub/GitLab rejected your SSH key.", fix: "Run `ssh -T git@github.com`, check `ssh-add -l`, and that the public key is added to your account." }) },
  { re: /CONFLICT|merge conflict|Automatic merge failed/i, say: () => ({ cause: "Git couldn't merge automatically — the same lines changed on both sides.", fix: "Open the files with <<<<<<< markers, pick the right code, `git add` them, then commit/continue." }) },
  { re: /non-fast-forward|failed to push some refs/i, say: () => ({ cause: "The remote has commits you don't have locally.", fix: "`git pull --rebase`, resolve conflicts, then push again (never force-push shared branches)." }) },
  { re: /TS(\d{4}):?\s*(.*)/, say: (m) => ({ cause: `TypeScript error TS${m[1]}: ${m[2].slice(0, 100)}`, fix: "Read the expected vs. actual type in the message; fix the type or the value — avoid `any` as a shortcut." }) },
  { re: /SyntaxError|Unexpected token/i, say: () => ({ cause: "The parser hit invalid syntax.", fix: "Look at the reported line and the one before it for a missing bracket, comma or quote." }) },
  { re: /CORS|cross-origin/i, say: () => ({ cause: "The browser blocked a cross-origin request.", fix: "Send Access-Control-Allow-Origin (and handle OPTIONS preflight) from the server." }) },
  { re: /\b401\b|unauthorized/i, say: () => ({ cause: "Authentication failed.", fix: "Check the token/API key, its expiry and the Authorization header format." }) },
  { re: /\b403\b|forbidden/i, say: () => ({ cause: "You're authenticated but not allowed to do this.", fix: "Check roles/scopes/policies for the resource." }) },
  { re: /\b504\b|timed? ?out|ETIMEDOUT/i, say: () => ({ cause: "The request took too long and was cut off.", fix: "Check the downstream service, increase the timeout and add retries." }) },
  { re: /TypeError/i, say: () => ({ cause: "A value had the wrong type for the operation.", fix: "Log the value and its type just before the failing line." }) },
];

export function localWhisper(error: string): { cause: string; fix: string } | null {
  for (const r of RULES) {
    const m = error.match(r.re);
    if (m) return r.say(m);
  }
  return null;
}

