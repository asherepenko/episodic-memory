#!/usr/bin/env node
/**
 * Cross-platform wrapper script for MCP server that ensures dependencies are installed.
 * This runs before the MCP server starts and works on Windows, macOS, and Linux.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Compiled location: <plugin>/dist/cli/mcp-server-wrapper.js → plugin root is ../..
const PLUGIN_ROOT: string = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, '..', '..');

function runNpmInstall(): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const npmCommand = isWindows ? 'npm.cmd' : 'npm';

    console.error('Installing episodic-memory dependencies (first run only)...');
    console.error('This may take 30-60 seconds...');

    const child = spawn(npmCommand, ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd: PLUGIN_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows,
    });

    child.stdout?.on('data', (data: Buffer) => {
      // Suppress npm install output to stderr to avoid cluttering MCP logs
      process.stderr.write(data);
    });

    child.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        console.error('Dependencies installed successfully.');
        resolve();
      } else {
        console.error('ERROR: Failed to install dependencies.');
        console.error(`Please run manually: cd "${PLUGIN_ROOT}" && npm install`);
        reject(new Error(`npm install failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      console.error(`ERROR: Failed to run npm install: ${err.message}`);
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  try {
    const nodeModulesPath = join(PLUGIN_ROOT, 'node_modules');
    if (!existsSync(nodeModulesPath)) {
      await runNpmInstall();
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
