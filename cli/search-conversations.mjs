#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { repairInstall } from './repair.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginRoot = join(__dirname, '..');

// Heal the plugin's own files before touching anything under dist/. A partial
// `/plugin install` can leave this shim present but dist/ (or hooks/, or the
// host manifest) missing, and a static import of dist/ would then abort the
// process at module-load time — before any repair could run. Hence the
// dynamic import below.
repairInstall(pluginRoot);

const { findMissingDeps, installDepsSync } = await import('../dist/install-check.js');

// Self-heal a missing/partial install before spawning the real entry (#95).
if (findMissingDeps(pluginRoot).length > 0 && !installDepsSync(pluginRoot)) {
  process.exit(1);
}

const child = spawn(process.execPath, [join(__dirname, '..', 'dist', 'cli', 'search-conversations.js'), ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.on('exit', (code) => process.exit(code ?? 0));
