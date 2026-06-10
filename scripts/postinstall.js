#!/usr/bin/env node
/**
 * Cross-platform postinstall: ensure better-sqlite3's native binding actually
 * loads against the local Node version, building from source when no prebuilt
 * binary covers this Node ABI.
 *
 * Replaces the unix-only shell idiom that lived in package.json:
 *
 *   "postinstall": "npm rebuild better-sqlite3 2>/dev/null || true"
 *
 * On Windows cmd.exe that line fails — `2>/dev/null` isn't valid redirection
 * and `|| true` doesn't behave the same — which makes `npm install` exit
 * non-zero even when every dependency installed correctly. Reporter on
 * Windows 11 (#95) saw exactly this and spent time chasing a phantom failure.
 *
 * Why this got rewritten again (#xx): the previous version ran `npm rebuild`
 * once and trusted its exit status. On a bleeding-edge Node (e.g. Node 26 /
 * ABI 147) better-sqlite3's `prebuild-install` finds no matching prebuilt
 * binary and the rebuild can no-op or fail without emitting a binary — leaving
 * the package "installed" with ZERO compiled `*.node` files. The plugin then
 * looked installed but every sync/MCP call crashed with "Could not locate the
 * bindings file." The fix: don't trust exit codes — verify the binding loads,
 * and if it doesn't, force a from-source compile before giving up.
 *
 * This script still exits 0 in all cases so a build failure never bricks
 * `npm install`; it just makes a real effort and reports loudly on stderr.
 *
 * NOTE: this only runs at install time. A Node upgrade *after* install changes
 * the ABI and breaks the binding without re-running postinstall — recover with
 * `cd <plugin-dir> && npm rebuild better-sqlite3` (or reinstall the plugin).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const isWindows = process.platform === 'win32';
const npmBin = isWindows ? 'npm.cmd' : 'npm';

let lastLoadError = null;

/**
 * Real proof the native binding works: load the module and open an in-memory
 * DB. A bare require can succeed lazily on some platforms, so we also exercise
 * the addon. Returns true only when the binding is genuinely usable.
 */
function bindingLoads() {
  try {
    // Bust the require cache so a freshly-built binary is picked up on retry.
    delete require.cache[require.resolve('better-sqlite3')];
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE _probe (x)');
    db.close();
    return true;
  } catch (err) {
    lastLoadError = err;
    return false;
  }
}

function rebuild(extraArgs) {
  const args = ['rebuild', 'better-sqlite3', '--foreground-scripts', ...extraArgs];
  const result = spawnSync(npmBin, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: isWindows,
  });
  return result.status === 0;
}

// Fast path: a usable binary may already be present (prebuild fetched during
// `npm install`, or a prior postinstall built it). Don't rebuild needlessly.
if (bindingLoads()) {
  process.exit(0);
}

// First attempt: standard rebuild. Uses a matching prebuilt binary when one
// exists, otherwise falls through to better-sqlite3's node-gyp fallback.
rebuild([]);

if (!bindingLoads()) {
  // No prebuilt binary covers this Node ABI (the bleeding-edge-Node case).
  // Force a from-source compile, bypassing the prebuilt-binary lookup.
  rebuild(['--build-from-source']);
}

if (!bindingLoads()) {
  console.error(
    'episodic-memory: could not produce a working better-sqlite3 native ' +
    `binding for this Node version (${process.version}). ` +
    `Last load error: ${lastLoadError && lastLoadError.message}. ` +
    'The package files are installed but the MCP server and sync will fail ' +
    'on first use (see ~/.config/superpowers/logs/episodic-memory.log). ' +
    'A C/C++ toolchain is required to build from source: macOS → Xcode ' +
    'Command Line Tools (`xcode-select --install`); Linux → build-essential + ' +
    'python3; Windows → Visual Studio Build Tools. Then recover with: ' +
    'cd <plugin-dir> && npm rebuild better-sqlite3 --build-from-source'
  );
}

process.exit(0);
