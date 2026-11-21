import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getCodexDir } from '../src/paths.js';

describe('test environment isolation', () => {
  it('never points Codex discovery at the real ~/.codex', () => {
    const dir = getCodexDir();
    expect(dir).not.toBe(path.join(os.homedir(), '.codex'));
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });
});
