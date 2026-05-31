#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { findMissingDeps, installDepsSync } from '../dist/install-check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginRoot = join(__dirname, '..');

// Self-heal a missing/partial install before spawning the real entry (#95).
if (findMissingDeps(pluginRoot).length > 0 && !installDepsSync(pluginRoot)) {
  process.exit(1);
}

const child = spawn(process.execPath, [join(__dirname, '..', 'dist', 'cli', 'index-conversations.js'), ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.on('exit', (code) => process.exit(code ?? 0));
