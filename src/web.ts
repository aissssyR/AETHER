// Browser entry: bundles the SAME pure engines the CLI and the MCP server use (src/core/*).
export { localWhisper, RULES } from "./core/whisper";
export { validateCommit, suggestFromFiles } from "./core/oath";
export { parseEnv, analyzeDrift, buildExample, exampleValue, keysUsedIn } from "./core/drift";
export { analyzeFiles } from "./core/sweep";
export { localRoute, extractParams, ALL_COMMANDS } from "./core/router";
export { NPM, PYPI, parseManifests, findUsages } from "./core/exorcise";
export { localAnalysis, renderCoffinMarkdown } from "./core/coffin";
