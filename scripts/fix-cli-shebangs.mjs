#!/usr/bin/env node
// Re-prepend shebangs stripped by tsc and chmod +x compiled CLI scripts.
import { readdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';

const CLI_DIR = 'dist/cli';
const SHEBANG = '#!/usr/bin/env node\n';

let entries;
try {
  entries = readdirSync(CLI_DIR);
} catch {
  process.exit(0); // No dist/cli yet; nothing to do.
}

for (const name of entries) {
  if (!name.endsWith('.js')) continue;
  const path = join(CLI_DIR, name);
  const content = readFileSync(path, 'utf-8');
  if (!content.startsWith('#!')) {
    writeFileSync(path, SHEBANG + content, 'utf-8');
  }
  chmodSync(path, 0o755);
}
