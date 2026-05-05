#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { realpathSync } from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
// Compiled location: <plugin>/dist/cli/search-conversations.js → search-cli at ../search-cli.js
const child = spawn(process.execPath, [join(dirname(__dirname), 'search-cli.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
