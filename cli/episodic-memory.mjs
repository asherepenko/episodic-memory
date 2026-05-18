#!/usr/bin/env node
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// `/plugin install` and `/plugin update` run `npm install` asynchronously; the
// SessionStart hook can fire before deps land in node_modules/. When that
// happens during a background sync (hook-only invocation), exit silently so
// the hook does not flag a transient install race. The next SessionStart
// succeeds once deps are in place. Non-hook invocations propagate the real
// error.
const sdkPkg = join(__dirname, '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json');
const isBackgroundSync = process.argv[2] === 'sync' && process.argv.includes('--background');
if (isBackgroundSync && !existsSync(sdkPkg)) {
  process.exit(0);
}

const child = spawn(process.execPath, [join(__dirname, '..', 'dist', 'cli', 'episodic-memory.js'), ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.on('exit', (code) => process.exit(code ?? 0));
