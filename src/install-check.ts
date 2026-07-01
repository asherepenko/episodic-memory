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
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { acquireFileLock, releaseFileLock } from './file-lock.js';

const INSTALL_LOCK = '.episodic-memory-install.lock';

/** Cross-platform synchronous sleep (no busy-wait), for lock-wait polling. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export const REQUIRED_PACKAGES = [
  '@anthropic-ai/claude-agent-sdk',
  '@huggingface/transformers',
  'better-sqlite3',
  'sqlite-vec',
];

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

/** Human-readable marker for a present SDK whose native binary is missing. */
export const SDK_NATIVE_BINARY_MARKER = `${SDK_PACKAGE} (native CLI binary)`;

/**
 * The Claude Agent SDK doesn't contain the CLI binary it talks to — it spawns a
 * platform-specific native binary shipped as a SEPARATE optional dependency
 * (e.g. `@anthropic-ai/claude-agent-sdk-darwin-arm64`). `/plugin install` runs
 * with `--omit=optional`, so the SDK package lands but its binary package does
 * not: summaries then throw "Native CLI binary for <platform> not found" while
 * every top-level dependency check passes.
 *
 * A correct install always has exactly one sibling `claude-agent-sdk-<platform>`
 * package under `@anthropic-ai/`, so its total absence flags the gap without us
 * having to reproduce the SDK's platform→package mapping (incl. linux musl
 * variants). Only meaningful when the SDK itself is present — otherwise the SDK
 * is already reported via REQUIRED_PACKAGES and this would double-report.
 */
function sdkNativeBinaryMissing(nodeModules: string): boolean {
  const scopeDir = join(nodeModules, '@anthropic-ai');
  if (!existsSync(join(scopeDir, 'claude-agent-sdk', 'package.json'))) {
    return false;
  }
  let entries: string[];
  try {
    entries = readdirSync(scopeDir);
  } catch {
    return true;
  }
  return !entries.some(
    name =>
      name.startsWith('claude-agent-sdk-') &&
      existsSync(join(scopeDir, name, 'package.json'))
  );
}

/**
 * Return the required packages whose package.json is missing under
 * `<pluginRoot>/node_modules`. Empty array means the install looks complete.
 *
 * Probing each package's package.json — not just the directory — catches
 * partial extractions where the folder exists but the manifest hasn't been
 * written yet (#95 Bug 1).
 *
 * Also probes the SDK's optional native binary (see sdkNativeBinaryMissing):
 * reporting it as missing lets the self-heal `npm install` — which does NOT
 * pass `--omit=optional` — pull the right platform binary and restore summaries
 * for `/plugin install` users on every OS.
 */
export function findMissingDeps(pluginRoot: string): string[] {
  const nodeModules = join(pluginRoot, 'node_modules');
  if (!existsSync(nodeModules)) {
    return REQUIRED_PACKAGES.slice();
  }
  const missing = REQUIRED_PACKAGES.filter(
    pkg => !existsSync(join(nodeModules, pkg, 'package.json'))
  );
  if (!missing.includes(SDK_PACKAGE) && sdkNativeBinaryMissing(nodeModules)) {
    missing.push(SDK_NATIVE_BINARY_MARKER);
  }
  return missing;
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
export function installDepsSync(pluginRoot: string): boolean {
  if (findMissingDeps(pluginRoot).length === 0) return true;

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
    process.stderr.write(
      'episodic-memory: installing dependencies (first run only, ~30-60s)...\n'
    );
    const result = spawnSync(npmBin, ['install', '--no-audit', '--no-fund'], {
      cwd: pluginRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: isWindows,
    });
    if (result.status === 0 && findMissingDeps(pluginRoot).length === 0) {
      process.stderr.write('episodic-memory: dependencies installed.\n');
      return true;
    }
    process.stderr.write(
      `episodic-memory: dependency install failed (status=${result.status ?? 'unknown'}). ` +
      `Run manually: cd "${pluginRoot}" && npm install\n`
    );
    return false;
  } finally {
    releaseFileLock(lock);
  }
}
