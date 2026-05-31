/**
 * Dependency-health probing shared by the MCP server wrapper and the CLI
 * spawn shims. Imports only Node builtins so it stays importable even when
 * `node_modules` is empty or partially extracted.
 *
 * Runtime-required packages are externalized from the MCP server bundle (see
 * the `bundle` script in package.json). The bundle inline-imports these at
 * runtime via Node's resolver, so a partial `node_modules` extraction —
 * directory exists but the package is missing its package.json — surfaces as a
 * confusing `ERR_MODULE_NOT_FOUND` *after* the wrapper has already declared
 * dependencies healthy and launched the server (#95 Bug 1). It is also the
 * failure mode behind a `/plugin install` that never ran `npm install` at all:
 * the CLI crashes on the first missing import (`@anthropic-ai/claude-agent-sdk`).
 *
 * Only the direct runtime dependencies that are externalized from the bundle
 * are probed. Transitive/optional externals are deliberately excluded:
 *   - onnxruntime-node: an optional native backend for @huggingface/transformers.
 *     It is not a direct dependency and is not always installed (transformers
 *     falls back to its wasm backend), so probing it produces false positives
 *     and a spurious reinstall on every CLI invocation.
 *   - sharp, fsevents: optional / OS-specific; missing them is not fatal.
 *   - proper-lockfile: intentionally absent — this fork backs file locks with
 *     Node builtins (see file-lock.ts).
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { acquireFileLock, releaseFileLock } from './file-lock.js';
const INSTALL_LOCK = '.episodic-memory-install.lock';
/** Cross-platform synchronous sleep (no busy-wait), for lock-wait polling. */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
export const REQUIRED_PACKAGES = [
    '@anthropic-ai/claude-agent-sdk',
    '@huggingface/transformers',
    'better-sqlite3',
    'sqlite-vec',
];
/**
 * Return the required packages whose package.json is missing under
 * `<pluginRoot>/node_modules`. Empty array means the install looks complete.
 *
 * Probing each package's package.json — not just the directory — catches
 * partial extractions where the folder exists but the manifest hasn't been
 * written yet (#95 Bug 1).
 */
export function findMissingDeps(pluginRoot) {
    const nodeModules = join(pluginRoot, 'node_modules');
    if (!existsSync(nodeModules)) {
        return REQUIRED_PACKAGES.slice();
    }
    return REQUIRED_PACKAGES.filter(pkg => !existsSync(join(nodeModules, pkg, 'package.json')));
}
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
export function installDepsSync(pluginRoot) {
    if (findMissingDeps(pluginRoot).length === 0)
        return true;
    const lockPath = join(pluginRoot, INSTALL_LOCK);
    const lock = acquireFileLock(lockPath);
    if (!lock) {
        // Another installer holds the lock. Don't race a second npm install — wait
        // for the holder to finish (deps appear), up to ~120s.
        for (let i = 0; i < 120 && findMissingDeps(pluginRoot).length > 0; i++) {
            sleepSync(1000);
        }
        return findMissingDeps(pluginRoot).length === 0;
    }
    try {
        const isWindows = process.platform === 'win32';
        const npmBin = isWindows ? 'npm.cmd' : 'npm';
        process.stderr.write('episodic-memory: installing dependencies (first run only, ~30-60s)...\n');
        const result = spawnSync(npmBin, ['install', '--no-audit', '--no-fund'], {
            cwd: pluginRoot,
            stdio: ['ignore', 'inherit', 'inherit'],
            shell: isWindows,
        });
        if (result.status === 0 && findMissingDeps(pluginRoot).length === 0) {
            process.stderr.write('episodic-memory: dependencies installed.\n');
            return true;
        }
        process.stderr.write(`episodic-memory: dependency install failed (status=${result.status ?? 'unknown'}). ` +
            `Run manually: cd "${pluginRoot}" && npm install\n`);
        return false;
    }
    finally {
        releaseFileLock(lock);
    }
}
