import fs from 'fs';
import os from 'os';
import path from 'path';

// Keep sync/index tests off the real ~/.codex. Tests that need Codex
// transcripts set CODEX_HOME themselves, which overrides this.
process.env.CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'em-codex-home-'));
