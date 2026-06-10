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
 * once per process, serialized across processes with the shared file lock from
 * `./file-lock.js` (the SessionStart hook can fan out several processes that
 * would otherwise rebuild concurrently).
 *
 * better-sqlite3 caches its addon in a module-scoped `DEFAULT_ADDON` only on a
 * successful load (lib/database.js), so a failed load leaves the slot empty and
 * an in-process retry re-runs the filesystem lookup — meaning a freshly built
 * binary is picked up without reloading the module or restarting the process.
 */
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import Database from 'better-sqlite3';
import { acquireFileLock, releaseFileLock } from './file-lock.js';
const require = createRequire(import.meta.url);
/** Rebuild at most once per process — a missing toolchain must not loop. */
let healAttempted = false;
/**
 * True when the error is a native-binding load failure (missing/ABI-mismatched
 * `.node`), as opposed to a SQL or filesystem error we should surface as-is.
 */
export function isNativeBindingError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return /could not locate the bindings file|was compiled against a different|NODE_MODULE_VERSION|ERR_DLOPEN|dlopen|invalid ELF header|not a valid Win32 application|better_sqlite3\.node/i.test(msg);
}
/** Probe whether the native binding is currently usable. */
function bindingUsable() {
    try {
        const db = new Database(':memory:');
        db.close();
        return true;
    }
    catch {
        return false;
    }
}
/**
 * The install root that owns `node_modules/better-sqlite3` — the directory
 * `npm rebuild` must run from. Returns null if better-sqlite3 can't be located.
 */
function betterSqlite3InstallRoot() {
    try {
        const pkgJson = require.resolve('better-sqlite3/package.json');
        const pkgDir = path.dirname(pkgJson); // .../node_modules/better-sqlite3
        const nodeModules = path.dirname(pkgDir); // .../node_modules
        return path.dirname(nodeModules); // install root
    }
    catch {
        return null;
    }
}
function runRebuild(installRoot, extraArgs) {
    const isWindows = process.platform === 'win32';
    const npmBin = isWindows ? 'npm.cmd' : 'npm';
    spawnSync(npmBin, ['rebuild', 'better-sqlite3', '--foreground-scripts', ...extraArgs], {
        cwd: installRoot,
        stdio: ['ignore', 'inherit', 'inherit'],
        shell: isWindows,
    });
}
/** Synchronous sleep (initDatabase and the whole DB layer are synchronous). */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/** Poll until the binding loads or the deadline passes. */
function waitForBinding(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (bindingUsable())
            return;
        sleepSync(500);
    }
}
/**
 * Attempt to repair the native binding in place. Safe to call from multiple
 * processes: the first to grab the lock rebuilds; the rest wait for it. Returns
 * after the attempt — the caller should retry `new Database(...)` and surface
 * the error itself if the binding is still broken.
 */
export function healNativeBinding() {
    if (healAttempted)
        return;
    healAttempted = true;
    const installRoot = betterSqlite3InstallRoot();
    if (!installRoot)
        return; // can't locate the package; let the caller surface it
    const lockPath = path.join(installRoot, '.episodic-native-rebuild.lock');
    const lock = acquireFileLock(lockPath);
    if (!lock) {
        // Another process is rebuilding. Wait for it rather than piling on.
        // A from-source compile can take ~30–60s, so allow generous headroom.
        console.error('episodic-memory: another process is rebuilding the native binding; waiting...');
        waitForBinding(120_000);
        return;
    }
    try {
        if (bindingUsable())
            return; // a prior holder already fixed it
        console.error(`episodic-memory: rebuilding better-sqlite3 for ${process.version} (Node was likely upgraded after install)...`);
        runRebuild(installRoot, []);
        if (bindingUsable())
            return;
        // No prebuilt binary covers this Node ABI — force a from-source compile.
        runRebuild(installRoot, ['--build-from-source']);
    }
    finally {
        releaseFileLock(lock);
    }
}
