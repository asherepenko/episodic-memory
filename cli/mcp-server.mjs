#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { repairInstall } from './repair.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pluginRoot = join(__dirname, '..');

// A half-written install is the difference between this server starting and the
// host retrying a 10s connect timeout forever, so heal the plugin's own files
// before spawning the wrapper that lives under dist/. Non-destructive and
// never throws: a failed repair still lets the wrapper report its own error.
repairInstall(pluginRoot);

const child = spawn(process.execPath, [join(__dirname, '..', 'dist', 'cli', 'mcp-server-wrapper.js'), ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.on('exit', (code) => process.exit(code ?? 0));
