// Pure natural-language router (offline): works in Node and in the browser.

export const ALL_COMMANDS = ["coffin", "resurrect", "whisper", "oath", "sweep", "exorcise", "drift"] as const;
export type AetherCommand = (typeof ALL_COMMANDS)[number];

export interface Route { command: AetherCommand; params: string | null; explanation: string }

// ─── Offline router: weighted keyword scoring ─────────────────────────────────

const RULES: { command: AetherCommand; re: RegExp; weight: number; why: string }[] = [
  { command: "resurrect", re: /\b(resurrect|wake|resume|restore|where was i|what was i|open (the )?coffin|continue (where|from))\b/i, weight: 3, why: "Waking your saved context from the coffin." },
  { command: "coffin", re: /\b(save|seal|freeze|pause|stash|coffin|bury|going to bed|goodnight|leaving|going home|meeting)\b/i, weight: 2, why: "Freezing your working context into a coffin." },
  { command: "whisper", re: /\b(explain|decode|translate|whisper|what does|what is this|why (am i|do i|is)|error|exception|undefined|cannot|failed|traceback)\b/i, weight: 2, why: "Translating the error into plain language." },
  { command: "oath", re: /\b(commit|oath|validate)\b/i, weight: 2, why: "Judging your commit message." },
  { command: "sweep", re: /\b(dead code|unused|sweep|unreferenced|clean ?up|orphan|never called|graveyard)\b/i, weight: 3, why: "Hunting dead code across the project." },
  { command: "exorcise", re: /\b(zombie|deprecated|outdated|dependenc\w*|exorcis\w*|old packages|abandoned|unmaintained)\b/i, weight: 3, why: "Scanning dependencies for zombies." },
  { command: "drift", re: /(\.env|\benv\b|\bdrift\b|environment variables?|\bconfig(uration)?\b)/i, weight: 3, why: "Comparing environment files for drift." },
];

export function extractParams(command: AetherCommand, input: string): string | null {
  const t = input.trim();
  if (command === "coffin") {
    const rest = t.replace(/^(please\s+)?(save|seal|freeze|stash|store|pause|bury|coffin)\b(\s+(my|the))?(\s+(work|progress|context|session))?\s*[,:;—-]*\s*(i\s+was\s+)?/i, "").trim();
    return rest.length >= 3 ? rest : t;
  }
  if (command === "whisper") {
    const colon = t.indexOf(":");
    if (colon > -1 && colon < t.length - 3) return t.slice(colon + 1).trim();
    return t.replace(/^(please\s+)?(whisper|explain|decode|translate|what does)\s+(this\s+)?(error\s+)?(message\s+)?/i, "").trim() || t;
  }
  if (command === "oath") {
    const quoted = t.match(/["“'](.+?)["”']\s*$/);
    if (quoted) return quoted[1].trim();
    const colon = t.indexOf(":");
    if (colon > -1 && /\b(commit|message|oath|validate|check)\b/i.test(t.slice(0, colon))) return t.slice(colon + 1).trim();
    return t.replace(/^(please\s+)?(check|validate|judge|oath|commit)\s+(my\s+)?(commit\s+)?(message\s+)?/i, "").trim() || t;
  }
  return null;
}

export function localRoute(input: string): Route | null {
  const scores = new Map<AetherCommand, number>();
  for (const r of RULES) if (r.re.test(input)) scores.set(r.command, (scores.get(r.command) ?? 0) + r.weight + (input.match(r.re)?.length ?? 0) * 0.1);
  if (!scores.size) return null;
  const [command] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  return { command, params: extractParams(command, input), explanation: RULES.find((r) => r.command === command)!.why };
}

