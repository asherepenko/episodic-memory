#!/usr/bin/env node
/**
 * Lock-guarded dependency self-heal, spawned detached by the SessionStart hook
 * (via the CLI shim's background-sync path) when node_modules is missing or
 * partial. Running it detached keeps the hook non-blocking: this process does
 * the ~30-60s `npm install` in the background. Once deps are present it then
 * kicks the indexing sync, so a brand-new install has data ready in the SAME
 * session instead of needing a second session to fire the sync (#95 left this
 * gap: the hook installed deps but never went on to index). The lock inside
 * installDepsSync prevents it from racing the MCP wrapper, a foreground CLI
 * self-heal, or a concurrent `/plugin install`.
 *
 * Imports only the builtins-based install-check module, so it loads even when
 * node_modules is empty.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { findMissingDeps, installDepsSync } from '../dist/install-check.js';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Deps already present (another installer won the race): the winner chains the
// sync, so we just exit. Nothing to install, nothing to index here.
if (findMissingDeps(pluginRoot).length === 0) {
  process.exit(0);
}

if (!installDepsSync(pluginRoot)) {
  process.exit(1);
}

// Deps are now installed. Kick the indexing sync so first-install data is ready
// this session. `sync --background` forks its own detached, log-writing,
// lock-guarded worker and returns immediately — and running it as a fresh
// process loads the just-installed native better-sqlite3 binding cleanly
// (this process started before node_modules existed). Best-effort: a failed
// sync launch must never turn a successful install into a non-zero exit.
try {
  spawnSync(
    process.execPath,
    [join(pluginRoot, 'dist', 'cli', 'episodic-memory.js'), 'sync', '--background'],
    { stdio: 'ignore' },
  );
} catch {
  /* best-effort: deps are installed; the next session's hook will sync */
}

process.exit(0);
