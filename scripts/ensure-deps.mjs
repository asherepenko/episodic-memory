#!/usr/bin/env node
/**
 * Lock-guarded dependency self-heal, spawned detached by the SessionStart hook
 * (via the CLI shim's background-sync path) when node_modules is missing or
 * partial. Running it detached keeps the hook non-blocking: this process does
 * the ~30-60s `npm install` in the background, and the next session finds deps
 * present. The lock inside installDepsSync prevents it from racing the MCP
 * wrapper, a foreground CLI self-heal, or a concurrent `/plugin install`.
 *
 * Imports only the builtins-based install-check module, so it loads even when
 * node_modules is empty.
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { findMissingDeps, installDepsSync } from '../dist/install-check.js';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

if (findMissingDeps(pluginRoot).length === 0) {
  process.exit(0);
}

process.exit(installDepsSync(pluginRoot) ? 0 : 1);
