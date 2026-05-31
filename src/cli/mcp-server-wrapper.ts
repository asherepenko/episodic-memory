#!/usr/bin/env node
/**
 * Cross-platform wrapper script for MCP server that ensures dependencies are installed.
 * This runs before the MCP server starts and works on Windows, macOS, and Linux.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { findMissingDeps, installDepsSync } from '../install-check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Compiled location: <plugin>/dist/cli/mcp-server-wrapper.js → plugin root is ../..
const PLUGIN_ROOT: string = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..', '..');

async function main(): Promise<void> {
  try {
    // Probe each required package's manifest — not just node_modules/ existence
    // — so a partial extraction (folder present, package.json missing) is
    // healed before launch instead of surfacing as ERR_MODULE_NOT_FOUND after
    // the server starts (#95 Bug 1). installDepsSync is lock-guarded, so it
    // can't race the SessionStart hook's install or a concurrent /plugin install.
    const missing = findMissingDeps(PLUGIN_ROOT);
    if (missing.length > 0) {
      console.error(`episodic-memory: missing/partial dependencies: ${missing.join(', ')}`);
      if (!installDepsSync(PLUGIN_ROOT)) {
        console.error('ERROR: Failed to install dependencies.');
        process.exit(1);
      }
    }

    const mcpServerPath = join(PLUGIN_ROOT, 'dist', 'mcp-server.js');

    if (!existsSync(mcpServerPath)) {
      console.error(`ERROR: MCP server not found at ${mcpServerPath}`);
      console.error('Please run: npm run build');
      process.exit(1);
    }

    const child = spawn(process.execPath, [mcpServerPath], {
      stdio: 'inherit',
      shell: false,
    });

    process.on('SIGTERM', () => child.kill('SIGTERM'));
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGHUP', () => child.kill('SIGHUP'));

    // Detect parent process death via stdin close
    process.stdin.on('end', () => {
      child.kill();
      process.exit(0);
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code || 0);
      }
    });

    child.on('error', (err) => {
      console.error(`ERROR: Failed to start MCP server: ${err.message}`);
      process.exit(1);
    });
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`);
    process.exit(1);
  }
}

main().catch((error: Error) => {
  console.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
