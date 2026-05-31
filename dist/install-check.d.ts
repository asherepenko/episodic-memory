export declare const REQUIRED_PACKAGES: string[];
/**
 * Return the required packages whose package.json is missing under
 * `<pluginRoot>/node_modules`. Empty array means the install looks complete.
 *
 * Probing each package's package.json — not just the directory — catches
 * partial extractions where the folder exists but the manifest hasn't been
 * written yet (#95 Bug 1).
 */
export declare function findMissingDeps(pluginRoot: string): string[];
/**
 * Self-heal a missing/partial install, serialized by a file lock so that
 * concurrent entry points (MCP wrapper, CLI shims, the SessionStart hook, and
 * any `/plugin install`-triggered install) never run two `npm install`
 * processes against the same node_modules at once. Returns true when all
 * required deps are present afterward.
 *
 * Output streams to stderr so it never corrupts stdout (MCP protocol / CLI
 * data). No-op (returns true) when deps are already present.
 */
export declare function installDepsSync(pluginRoot: string): boolean;
