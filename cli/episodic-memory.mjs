#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { repairInstall } from './repair.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginRoot = join(__dirname, '..');

const isBackgroundSync = process.argv[2] === 'sync' && process.argv.includes('--background');

// Heal the plugin's own files before touching anything under dist/. A partial
// `/plugin install` can leave this shim present but dist/ (or hooks/, or the
// host manifest) missing, and a static import of dist/ would then abort the
// process at module-load time — before any repair could run. Hence the
// dynamic import below.
//
// Skipped for the SessionStart hook's background sync, which must stay fast and
// silent: repair logs to stderr and may clone over the network. The MCP server
// and every foreground command still heal, so a broken install is fixed by the
// next real use rather than by session startup.
if (!isBackgroundSync) {
  repairInstall(pluginRoot);
}

const { findMissingDeps, installDepsSync } = await import('../dist/install-check.js');

// `/plugin install` / `/plugin update` may not run `npm install` before the
// CLI is first invoked, leaving node_modules/ missing or partial. Probe each
// required package (not just node_modules/ existence) and self-heal (#95).
const missing = findMissingDeps(pluginRoot);
if (missing.length > 0) {
  if (isBackgroundSync) {
    // Hook-only invocation: kick off a detached, lock-guarded install so the
    // next session finds deps present, without blocking the SessionStart hook.
    // The lock prevents racing the MCP wrapper or a concurrent /plugin install.
    // Best-effort: an error here (e.g. runner missing) must never crash the hook.
    const installer = spawn(process.execPath, [join(pluginRoot, 'scripts', 'ensure-deps.mjs')], {
      detached: true,
      stdio: 'ignore',
    });
    installer.on('error', () => {});
    installer.unref();
    process.exit(0);
  }
  // Foreground invocation: install before spawning so a direct
  // `episodic-memory <cmd>` doesn't crash on a missing dependency.
  if (!installDepsSync(pluginRoot)) {
    process.exit(1);
  }
}

const child = spawn(process.execPath, [join(__dirname, '..', 'dist', 'cli', 'episodic-memory.js'), ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.on('exit', (code) => process.exit(code ?? 0));
