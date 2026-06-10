/**
 * Runtime self-heal for the better-sqlite3 native binding.
 *
 * The postinstall hook builds the binding at install time, but it only runs at
 * install time. When Node is upgraded *after* install, the ABI changes and the
 * existing binary stops loading with "Could not locate the bindings file" /
 * "NODE_MODULE_VERSION mismatch". The SessionStart hook still fires, sync still
 * spawns, the MCP server still boots — they just all crash on the first DB open,
 * which reads as "episodic-memory silently stopped working" (see CLAUDE.md
 * "Native-binding gotcha"). No postinstall can fix this; only the running
 * process can, by rebuilding against the Node it's actually running under.
 *
 * This module detects that specific failure and rebuilds the binding in place,
 * once per process, serialized across processes with the same PID-aware lock
 * the embedding migration uses (the SessionStart hook can fan out several
 * processes that would otherwise rebuild concurrently).
 *
 * better-sqlite3 caches its addon in a module-scoped `DEFAULT_ADDON` only on a
 * successful load (lib/database.js), so a failed load leaves the slot empty and
 * an in-process retry re-runs the filesystem lookup — meaning a freshly built
 * binary is picked up without reloading the module or restarting the process.
 */
/**
 * True when the error is a native-binding load failure (missing/ABI-mismatched
 * `.node`), as opposed to a SQL or filesystem error we should surface as-is.
 */
export declare function isNativeBindingError(err: unknown): boolean;
/**
 * Attempt to repair the native binding in place. Safe to call from multiple
 * processes: the first to grab the lock rebuilds; the rest wait for it. Returns
 * after the attempt — the caller should retry `new Database(...)` and surface
 * the error itself if the binding is still broken.
 */
export declare function healNativeBinding(): void;
